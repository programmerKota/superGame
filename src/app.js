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
    this.geocodeRequest = null;
    this.listeners = new AbortController();
    this.hasEnteredWorld = false;
    this.activeTransitions = 0;
    this.destroyed = false;
  }

  async start() {
    const { viewer, capabilities } = await createWorld("game", (message) =>
      this.ui.setStatus(message),
    );

    if (this.destroyed) {
      viewer.destroy();
      return;
    }

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
    if (this.destroyed) return;
    this.destroyed = true;

    this.railRequest?.abort();
    this.geocodeRequest?.abort();
    this.listeners.abort();
    this.controller?.dispose();
    this.viewer?.destroy();

    if (this.frameRequest !== null) {
      cancelAnimationFrame(this.frameRequest);
      this.frameRequest = null;
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
    const options = { signal: this.listeners.signal };

    this.ui.onStart(() => {
      this.hasEnteredWorld = true;
      this.ui.setOverlayVisible(false);
      void this.#requestPointerControl();
    }, options);

    this.ui.onModeSelect((mode) => {
      void this.#activateMode(mode);
    }, options);

    this.ui.onPresetSelect((location) => {
      void this.#travelTo(location).catch((error) => this.#reportError(error));
    }, options);

    this.ui.onLocationSubmit((query) => {
      void this.#searchAndTravel(query);
    }, options);

    this.viewer.canvas.addEventListener(
      "click",
      () => {
        if (
          this.hasEnteredWorld &&
          document.pointerLockElement !== this.viewer.canvas
        ) {
          void this.#requestPointerControl();
        }
      },
      options,
    );

    document.addEventListener(
      "pointerlockchange",
      () => {
        const isPlaying = document.pointerLockElement === this.viewer.canvas;
        this.ui.setPlaying(isPlaying);

        if (
          this.hasEnteredWorld &&
          !isPlaying &&
          this.activeTransitions === 0
        ) {
          this.ui.setStatus("操作停止中：画面をクリックすると再開します");
        }
      },
      options,
    );

    window.addEventListener(
      "keydown",
      (event) => {
        if (
          !this.hasEnteredWorld ||
          event.repeat ||
          this.#isTextInput(event.target)
        ) {
          return;
        }

        const mode = MODE_SHORTCUTS[event.code];
        if (mode) void this.#activateMode(mode);
      },
      options,
    );
  }

  #isTextInput(target) {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable === true
    );
  }

  async #requestPointerControl() {
    if (
      this.destroyed ||
      document.pointerLockElement === this.viewer.canvas
    ) {
      return;
    }

    try {
      await this.viewer.canvas.requestPointerLock?.();
    } catch (error) {
      console.warn("Pointer lock could not be acquired.", error);
      this.ui.setStatus("マウス操作を開始できませんでした", "error");
    }
  }

  async #activateMode(mode) {
    if (!this.hasEnteredWorld || !MODE_LABELS[mode]) return;

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
    void this.#requestPointerControl();
  }

  async #activateTrainMode() {
    this.railRequest?.abort();
    const request = new AbortController();
    this.railRequest = request;

    const state = this.controller.getState();
    this.ui.setStatus("周辺の実在線路を取得しています…");

    try {
      const route = await loadNearestRailRoute(state.latitude, state.longitude, {
        signal: request.signal,
      });

      if (request.signal.aborted || this.destroyed) return;

      this.controller.setRailRoute(route);
      this.controller.setMode("train");
      this.ui.setStatus(
        `電車モード：${route.name}（W/Sで加減速、Spaceで制動）`,
      );
      void this.#requestPointerControl();
    } catch (error) {
      if (error.name !== "AbortError") {
        this.#reportError(error);
      }
    } finally {
      if (this.railRequest === request) {
        this.railRequest = null;
      }
    }
  }

  async #searchAndTravel(query) {
    this.geocodeRequest?.abort();
    const request = new AbortController();
    this.geocodeRequest = request;
    this.ui.setStatus("場所を検索しています…");

    try {
      const location = await resolveLocation(query, {
        signal: request.signal,
      });

      if (request.signal.aborted || this.destroyed) return;

      const completed = await this.#travelTo(location, {
        abortGeocode: false,
      });

      if (completed) {
        this.ui.clearLocationInput();
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        this.#reportError(error);
      }
    } finally {
      if (this.geocodeRequest === request) {
        this.geocodeRequest = null;
      }
    }
  }

  async #travelTo(
    location,
    { persist = true, abortGeocode = true } = {},
  ) {
    this.activeTransitions += 1;
    document.exitPointerLock?.();
    this.railRequest?.abort();
    if (abortGeocode) this.geocodeRequest?.abort();
    this.ui.setStatus(`${location.label ?? "指定地点"}へ移動しています…`);

    try {
      const completed = await this.controller.teleport(
        location.latitude,
        location.longitude,
      );

      if (!completed) return false;

      if (persist) {
        saveLastLocation(location);
      }

      this.ui.setStatus(`${location.label ?? "指定地点"}に到着しました`);
      return true;
    } finally {
      this.activeTransitions = Math.max(0, this.activeTransitions - 1);
    }
  }

  #reportError(error) {
    console.error(error);
    this.ui.setStatus(
      error?.message ?? "予期しないエラーが発生しました",
      "error",
    );
  }

  #buildReadyMessage(capabilities) {
    const dataSources = [
      "OpenStreetMap画像",
      capabilities.terrain ? "実在地形" : "標高なし地形",
      capabilities.buildings ? "3D建物" : "建物なし",
    ];

    return `準備完了：${dataSources.join(" / ")}`;
  }

  #tick(now) {
    if (this.destroyed) return;

    const deltaSeconds = Math.min(
      (now - this.previousFrameTime) / 1_000,
      0.05,
    );
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
