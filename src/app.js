import { MODE_LABELS, MODE_SHORTCUTS } from "./config.js";
import { WorldController } from "./controller.js";
import { resolveLocation } from "./geocoder.js";
import { loadLastLocation, saveLastLocation } from "./persistence.js";
import { loadNearestRailRoute } from "./rail.js";
import { GameUi } from "./ui.js";
import { createWorld } from "./world.js";

const HUD_REFRESH_INTERVAL_MS = 100;
const POSITION_SAVE_INTERVAL_MS = 5_000;

export class GameApp {
  constructor({ ui = new GameUi() } = {}) {
    this.ui = ui;
    this.viewer = null;
    this.controller = null;
    this.frameRequest = null;
    this.previousFrameTime = 0;
    this.lastHudRefresh = 0;
    this.lastPositionSave = 0;
    this.railRequest = null;
  }

  async start() {
    const { viewer, capabilities } = await createWorld("game", (message) =>
      this.ui.setStatus(message),
    );

    this.viewer = viewer;
    this.controller = new WorldController(viewer, {
      onModeChange: (mode) => this.ui.setActiveMode(mode),
    });

    this.#configureCanvas();
    this.#bindEvents();

    const initialLocation = loadLastLocation();
    await this.#travelTo(initialLocation, { persist: false });

    this.ui.setActiveMode("walk");
    this.ui.setStatus(this.#buildReadyMessage(capabilities));
    this.previousFrameTime = performance.now();
    this.frameRequest = requestAnimationFrame((time) => this.#tick(time));
  }

  destroy() {
    this.railRequest?.abort();
    this.controller?.dispose();
    this.viewer?.destroy();

    if (this.frameRequest !== null) {
      cancelAnimationFrame(this.frameRequest);
    }
  }

  #configureCanvas() {
    const canvas = this.viewer.canvas;
    canvas.tabIndex = 0;
    canvas.setAttribute(
      "aria-label",
      "現実世界3Dビュー。クリックすると一人称操作を開始します。",
    );
  }

  #bindEvents() {
    this.ui.onStart(() => {
      this.ui.setOverlayVisible(false);
      this.#requestPointerControl();
    });

    this.ui.onModeSelect((mode) => this.#activateMode(mode));
    this.ui.onPresetSelect((location) => this.#travelTo(location));
    this.ui.onLocationSubmit((query) => this.#searchAndTravel(query));

    this.viewer.canvas.addEventListener("click", () => {
      if (document.pointerLockElement !== this.viewer.canvas) {
        this.#requestPointerControl();
      }
    });

    document.addEventListener("pointerlockchange", () => {
      const isPlaying = document.pointerLockElement === this.viewer.canvas;
      this.ui.setPlaying(isPlaying);

      if (!isPlaying) {
        this.ui.setStatus("操作停止中：画面をクリックすると再開します");
      }
    });

    window.addEventListener("keydown", (event) => {
      if (event.repeat || this.#isTextInput(event.target)) return;

      const mode = MODE_SHORTCUTS[event.code];
      if (mode) this.#activateMode(mode);
    });
  }

  #isTextInput(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  }

  async #requestPointerControl() {
    if (document.pointerLockElement === this.viewer.canvas) return;

    try {
      await this.viewer.canvas.requestPointerLock?.();
    } catch (error) {
      console.warn("Pointer lock could not be acquired.", error);
      this.ui.setStatus("マウス操作を開始できませんでした", "error");
    }
  }

  async #activateMode(mode) {
    if (!MODE_LABELS[mode]) return;

    if (mode === "train") {
      await this.#activateTrainMode();
      return;
    }

    this.railRequest?.abort();
    this.controller.setMode(mode);

    this.ui.setStatus(
      mode === "walk"
        ? "徒歩モード：WASDで移動、Spaceでジャンプ"
        : "車モード：W/Sで加減速、A/Dで操舵、Spaceでブレーキ",
    );
    this.#requestPointerControl();
  }

  async #activateTrainMode() {
    this.railRequest?.abort();
    this.railRequest = new AbortController();

    const state = this.controller.getState();
    this.ui.setStatus("周辺の実在線路を取得しています…");

    try {
      const route = await loadNearestRailRoute(state.latitude, state.longitude, {
        signal: this.railRequest.signal,
      });

      this.controller.setRailRoute(route);
      this.controller.setMode("train");
      this.ui.setStatus(
        `電車モード：${route.name}（W/Sで加減速、Spaceで制動）`,
      );
      this.#requestPointerControl();
    } catch (error) {
      if (error.name === "AbortError") return;

      console.error(error);
      this.ui.setStatus(error.message, "error");
    } finally {
      this.railRequest = null;
    }
  }

  async #searchAndTravel(query) {
    this.ui.setStatus("場所を検索しています…");

    try {
      const location = await resolveLocation(query);
      await this.#travelTo(location);
      this.ui.clearLocationInput();
    } catch (error) {
      console.error(error);
      this.ui.setStatus(error.message, "error");
    }
  }

  async #travelTo(location, { persist = true } = {}) {
    document.exitPointerLock?.();
    this.railRequest?.abort();
    this.ui.setStatus(`${location.label ?? "指定地点"}へ移動しています…`);

    await this.controller.teleport(location.latitude, location.longitude);

    if (persist) {
      saveLastLocation(location);
    }

    this.ui.setStatus(`${location.label ?? "指定地点"}に到着しました`);
  }

  #buildReadyMessage(capabilities) {
    const dataSources = [
      "OpenStreetMap画像",
      capabilities.terrain ? "実在地形" : "平面地形",
      capabilities.buildings ? "3D建物" : "建物なし",
    ];

    return `準備完了：${dataSources.join(" / ")}`;
  }

  #tick(now) {
    const deltaSeconds = Math.min((now - this.previousFrameTime) / 1_000, 0.05);
    this.previousFrameTime = now;

    this.controller.update(deltaSeconds);

    if (now - this.lastHudRefresh >= HUD_REFRESH_INTERVAL_MS) {
      const state = this.controller.getState();
      this.ui.updateTelemetry({
        ...state,
        modeLabel: MODE_LABELS[state.mode],
      });
      this.lastHudRefresh = now;
    }

    if (now - this.lastPositionSave >= POSITION_SAVE_INTERVAL_MS) {
      const state = this.controller.getState();
      saveLastLocation({
        latitude: state.latitude,
        longitude: state.longitude,
        label: "前回終了地点",
      });
      this.lastPositionSave = now;
    }

    this.frameRequest = requestAnimationFrame((time) => this.#tick(time));
  }
}
