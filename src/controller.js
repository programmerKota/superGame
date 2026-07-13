import {
  Cartesian3,
  Cartographic,
  Matrix4,
  Math as CesiumMath,
  Transforms,
  sampleTerrainMostDetailed,
} from "cesium";
import { distanceMeters } from "./rail.js";

const MODES = new Set(["walk", "car", "train"]);
const EYE_HEIGHT = {
  walk: 1.72,
  car: 1.55,
  train: 3.2,
};

const scratchOrigin = new Cartesian3();
const scratchLocal = new Cartesian3();
const scratchWorld = new Cartesian3();
const scratchNext = new Cartesian3();

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function approach(value, target, amount) {
  if (value < target) return Math.min(value + amount, target);
  if (value > target) return Math.max(value - amount, target);
  return target;
}

function bearingRadians(a, b) {
  const latitude1 = CesiumMath.toRadians(a.latitude);
  const latitude2 = CesiumMath.toRadians(b.latitude);
  const longitudeDelta = CesiumMath.toRadians(b.longitude - a.longitude);
  const y = Math.sin(longitudeDelta) * Math.cos(latitude2);
  const x =
    Math.cos(latitude1) * Math.sin(latitude2) -
    Math.sin(latitude1) *
      Math.cos(latitude2) *
      Math.cos(longitudeDelta);

  return Math.atan2(y, x);
}

function nearestPointIndex(points, position) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  points.forEach((point, index) => {
    const distance = distanceMeters(point, position);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
}

export class WorldController {
  constructor(viewer, { onStatus = () => {}, onModeChange = () => {} } = {}) {
    this.viewer = viewer;
    this.onStatus = onStatus;
    this.onModeChange = onModeChange;

    this.mode = "walk";
    this.latitude = 35.681236;
    this.longitude = 139.767125;
    this.groundHeight = 0;
    this.heading = 0;
    this.pitch = -0.12;

    this.jumpOffset = 0;
    this.verticalVelocity = 0;
    this.jumpLatch = false;

    this.carSpeed = 0;
    this.trainSpeed = 0;
    this.trainRoute = null;
    this.trainDistance = 0;

    this.keys = new Set();
    this.lastGroundUpdate = 0;
    this.disposed = false;

    this.viewer.scene.screenSpaceCameraController.enableInputs = false;
    this.#bindInput();
  }

  #bindInput() {
    this.onKeyDown = (event) => {
      if (
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          event.code,
        )
      ) {
        event.preventDefault();
      }
      this.keys.add(event.code);
    };

    this.onKeyUp = (event) => {
      this.keys.delete(event.code);
    };

    this.onMouseMove = (event) => {
      if (document.pointerLockElement !== this.viewer.canvas) return;

      if (this.mode !== "train") {
        this.heading = CesiumMath.zeroToTwoPi(
          this.heading + event.movementX * 0.0021,
        );
      }

      this.pitch = clamp(
        this.pitch - event.movementY * 0.0018,
        -1.42,
        1.05,
      );
    };

    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp);
    document.addEventListener("mousemove", this.onMouseMove);
  }

  dispose() {
    this.disposed = true;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    document.removeEventListener("mousemove", this.onMouseMove);
  }

  async teleport(latitude, longitude, { heading = this.heading } = {}) {
    this.latitude = latitude;
    this.longitude = longitude;
    this.heading = heading;
    this.jumpOffset = 0;
    this.verticalVelocity = 0;
    this.carSpeed = 0;
    this.trainSpeed = 0;
    this.trainRoute = null;

    const cartographic = Cartographic.fromDegrees(longitude, latitude);
    let sampledHeight = this.viewer.scene.globe.getHeight(cartographic);

    try {
      const [sampled] = await sampleTerrainMostDetailed(
        this.viewer.terrainProvider,
        [cartographic],
      );
      sampledHeight = sampled.height;
    } catch (error) {
      console.debug("Detailed terrain sampling is unavailable.", error);
    }

    this.groundHeight = Number.isFinite(sampledHeight) ? sampledHeight : 0;
    this.#syncCamera();
  }

  setMode(mode) {
    if (!MODES.has(mode)) {
      throw new Error(`Unknown movement mode: ${mode}`);
    }

    if (mode === "train" && !this.trainRoute) {
      throw new Error("電車モードには線路データが必要です");
    }

    this.mode = mode;
    this.jumpOffset = 0;
    this.verticalVelocity = 0;

    if (mode !== "car") this.carSpeed = 0;
    if (mode !== "train") this.trainSpeed = 0;

    this.onModeChange(mode);
    this.#syncCamera();
  }

  setRailRoute(route) {
    const cumulative = [0];

    for (let index = 1; index < route.points.length; index += 1) {
      cumulative.push(
        cumulative[index - 1] +
          distanceMeters(route.points[index - 1], route.points[index]),
      );
    }

    const nearestIndex = nearestPointIndex(route.points, {
      latitude: this.latitude,
      longitude: this.longitude,
    });

    this.trainRoute = {
      ...route,
      cumulative,
      lengthMeters: cumulative[cumulative.length - 1],
    };
    this.trainDistance = cumulative[nearestIndex];
    this.trainSpeed = 0;
    this.#placeTrain();
  }

  update(deltaSeconds) {
    if (this.disposed) return;

    const delta = clamp(deltaSeconds, 0, 0.05);
    if (this.mode === "walk") this.#updateWalk(delta);
    if (this.mode === "car") this.#updateCar(delta);
    if (this.mode === "train") this.#updateTrain(delta);

    this.#refreshGroundHeight();
    this.#syncCamera();
  }

  #updateWalk(delta) {
    const forward =
      Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) -
      Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"));
    const strafe =
      Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) -
      Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));

    const magnitude = Math.hypot(forward, strafe);
    if (magnitude > 0) {
      const speed = this.keys.has("ShiftLeft") ? 10.5 : 5.2;
      const normalizedForward = forward / magnitude;
      const normalizedStrafe = strafe / magnitude;
      const east =
        (normalizedForward * Math.sin(this.heading) +
          normalizedStrafe * Math.cos(this.heading)) *
        speed *
        delta;
      const north =
        (normalizedForward * Math.cos(this.heading) -
          normalizedStrafe * Math.sin(this.heading)) *
        speed *
        delta;

      this.#moveAcrossGround(east, north);
    }

    const jumpPressed = this.keys.has("Space");
    if (jumpPressed && !this.jumpLatch && this.jumpOffset <= 0.001) {
      this.verticalVelocity = 5.3;
      this.jumpLatch = true;
    }
    if (!jumpPressed) this.jumpLatch = false;

    this.verticalVelocity -= 15.5 * delta;
    this.jumpOffset += this.verticalVelocity * delta;

    if (this.jumpOffset < 0) {
      this.jumpOffset = 0;
      this.verticalVelocity = 0;
    }
  }

  #updateCar(delta) {
    const throttle =
      Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) -
      Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"));
    const steering =
      Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) -
      Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));

    const maximumForwardSpeed = this.keys.has("ShiftLeft") ? 55 : 38;
    const targetSpeed =
      throttle > 0 ? maximumForwardSpeed : throttle < 0 ? -12 : 0;

    if (throttle !== 0) {
      const changingDirection =
        Math.sign(this.carSpeed) !== 0 &&
        Math.sign(this.carSpeed) !== Math.sign(targetSpeed);
      const acceleration = changingDirection ? 18 : 8.5;
      this.carSpeed = approach(
        this.carSpeed,
        targetSpeed,
        acceleration * delta,
      );
    } else {
      this.carSpeed = approach(this.carSpeed, 0, 3.2 * delta);
    }

    if (this.keys.has("Space")) {
      this.carSpeed = approach(this.carSpeed, 0, 28 * delta);
    }

    const speedRatio = clamp(
      Math.abs(this.carSpeed) / maximumForwardSpeed,
      0,
      1,
    );
    const directionSign = this.carSpeed < 0 ? -1 : 1;
    this.heading = CesiumMath.zeroToTwoPi(
      this.heading + steering * directionSign * (0.32 + speedRatio) * delta,
    );

    const distance = this.carSpeed * delta;
    this.#moveAcrossGround(
      Math.sin(this.heading) * distance,
      Math.cos(this.heading) * distance,
    );
  }

  #updateTrain(delta) {
    if (!this.trainRoute) return;

    const throttle =
      Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) -
      Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"));

    if (throttle !== 0) {
      const target = throttle > 0 ? 70 : -28;
      this.trainSpeed = approach(this.trainSpeed, target, 1.6 * delta);
    } else {
      this.trainSpeed = approach(this.trainSpeed, 0, 0.18 * delta);
    }

    if (this.keys.has("Space")) {
      this.trainSpeed = approach(this.trainSpeed, 0, 12 * delta);
    }

    this.trainDistance = clamp(
      this.trainDistance + this.trainSpeed * delta,
      0,
      this.trainRoute.lengthMeters,
    );

    if (
      this.trainDistance === 0 ||
      this.trainDistance === this.trainRoute.lengthMeters
    ) {
      this.trainSpeed = 0;
    }

    this.#placeTrain();
  }

  #placeTrain() {
    if (!this.trainRoute) return;

    const { points, cumulative } = this.trainRoute;
    let segment = 0;

    while (
      segment < cumulative.length - 2 &&
      cumulative[segment + 1] < this.trainDistance
    ) {
      segment += 1;
    }

    const startDistance = cumulative[segment];
    const endDistance = cumulative[segment + 1];
    const segmentLength = Math.max(0.001, endDistance - startDistance);
    const amount = clamp(
      (this.trainDistance - startDistance) / segmentLength,
      0,
      1,
    );
    const start = points[segment];
    const end = points[segment + 1];

    this.latitude =
      start.latitude + (end.latitude - start.latitude) * amount;
    this.longitude =
      start.longitude + (end.longitude - start.longitude) * amount;
    this.heading =
      this.trainSpeed >= 0
        ? bearingRadians(start, end)
        : bearingRadians(end, start);
  }

  #moveAcrossGround(eastMeters, northMeters) {
    Cartesian3.fromDegrees(
      this.longitude,
      this.latitude,
      this.groundHeight,
      undefined,
      scratchOrigin,
    );

    const transform = Transforms.eastNorthUpToFixedFrame(scratchOrigin);
    scratchLocal.x = eastMeters;
    scratchLocal.y = northMeters;
    scratchLocal.z = 0;

    Matrix4.multiplyByPointAsVector(transform, scratchLocal, scratchWorld);
    Cartesian3.add(scratchOrigin, scratchWorld, scratchNext);

    const next = Cartographic.fromCartesian(scratchNext);
    this.longitude = CesiumMath.toDegrees(next.longitude);
    this.latitude = CesiumMath.toDegrees(next.latitude);
  }

  #refreshGroundHeight() {
    const now = performance.now();
    if (now - this.lastGroundUpdate < 80) return;
    this.lastGroundUpdate = now;

    const cartographic = Cartographic.fromDegrees(
      this.longitude,
      this.latitude,
    );
    const height = this.viewer.scene.globe.getHeight(cartographic);

    if (Number.isFinite(height)) {
      this.groundHeight = height;
    }
  }

  #syncCamera() {
    const destination = Cartesian3.fromDegrees(
      this.longitude,
      this.latitude,
      this.groundHeight + EYE_HEIGHT[this.mode] + this.jumpOffset,
    );

    this.viewer.camera.setView({
      destination,
      orientation: {
        heading: this.heading,
        pitch: this.pitch,
        roll: 0,
      },
    });
  }

  getState() {
    const speedMetersPerSecond =
      this.mode === "car"
        ? this.carSpeed
        : this.mode === "train"
          ? this.trainSpeed
          : 0;

    return {
      mode: this.mode,
      latitude: this.latitude,
      longitude: this.longitude,
      altitude:
        this.groundHeight + EYE_HEIGHT[this.mode] + this.jumpOffset,
      speedKmh: Math.abs(speedMetersPerSecond) * 3.6,
      routeName: this.trainRoute?.name ?? null,
      routeProgress:
        this.trainRoute && this.trainRoute.lengthMeters > 0
          ? this.trainDistance / this.trainRoute.lengthMeters
          : null,
    };
  }
}
