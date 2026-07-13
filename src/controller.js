import {
  Cartesian3,
  Cartographic,
  Matrix4,
  Math as CesiumMath,
  Transforms,
  sampleTerrainMostDetailed,
} from "cesium";
import {
  bearingRadians,
  distanceMeters,
  interpolateCoordinate,
} from "./geo.js";
import { InputState } from "./input.js";

const MODES = new Set(["walk", "car", "train"]);
const EYE_HEIGHT_METERS = Object.freeze({
  walk: 1.72,
  car: 1.55,
  train: 3.2,
});

const LOOK_SENSITIVITY = Object.freeze({
  horizontal: 0.0021,
  vertical: 0.0018,
});

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

function axisValue(input, positiveCodes, negativeCodes) {
  return (
    Number(input.isPressed(...positiveCodes)) -
    Number(input.isPressed(...negativeCodes))
  );
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

function buildCumulativeDistances(points) {
  const cumulative = [0];

  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(
      cumulative[index - 1] + distanceMeters(points[index - 1], points[index]),
    );
  }

  return cumulative;
}

export class WorldController {
  constructor(viewer, { onModeChange = () => {} } = {}) {
    this.viewer = viewer;
    this.onModeChange = onModeChange;
    this.input = new InputState(viewer.canvas);

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

    this.lastGroundUpdate = 0;
    this.disposed = false;

    this.viewer.scene.screenSpaceCameraController.enableInputs = false;
  }

  dispose() {
    this.disposed = true;
    this.input.dispose();
  }

  async teleport(latitude, longitude, { heading = this.heading } = {}) {
    this.latitude = latitude;
    this.longitude = longitude;
    this.heading = heading;
    this.trainRoute = null;
    this.#resetMotion();

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
    if (!Array.isArray(route?.points) || route.points.length < 2) {
      throw new Error("線路データが不正です");
    }

    const cumulative = buildCumulativeDistances(route.points);
    const lengthMeters = cumulative.at(-1);

    if (!Number.isFinite(lengthMeters) || lengthMeters <= 0) {
      throw new Error("線路の長さを計算できませんでした");
    }

    const nearestIndex = nearestPointIndex(route.points, {
      latitude: this.latitude,
      longitude: this.longitude,
    });

    this.trainRoute = {
      ...route,
      cumulative,
      lengthMeters,
    };
    this.trainDistance = cumulative[nearestIndex];
    this.trainSpeed = 0;
    this.#placeTrain();
  }

  update(deltaSeconds) {
    if (this.disposed) return;

    const delta = clamp(deltaSeconds, 0, 0.05);
    this.#updateLook();

    switch (this.mode) {
      case "walk":
        this.#updateWalk(delta);
        break;
      case "car":
        this.#updateCar(delta);
        break;
      case "train":
        this.#updateTrain(delta);
        break;
      default:
        break;
    }

    this.#refreshGroundHeight();
    this.#syncCamera();
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
        this.groundHeight + EYE_HEIGHT_METERS[this.mode] + this.jumpOffset,
      speedKmh: Math.abs(speedMetersPerSecond) * 3.6,
      routeName: this.trainRoute?.name ?? null,
      routeProgress:
        this.trainRoute && this.trainRoute.lengthMeters > 0
          ? this.trainDistance / this.trainRoute.lengthMeters
          : null,
    };
  }

  #resetMotion() {
    this.input.clear();
    this.jumpOffset = 0;
    this.verticalVelocity = 0;
    this.jumpLatch = false;
    this.carSpeed = 0;
    this.trainSpeed = 0;
    this.trainDistance = 0;
  }

  #updateLook() {
    const look = this.input.consumeLookDelta();

    if (this.mode !== "train") {
      this.heading = CesiumMath.zeroToTwoPi(
        this.heading + look.x * LOOK_SENSITIVITY.horizontal,
      );
    }

    this.pitch = clamp(
      this.pitch - look.y * LOOK_SENSITIVITY.vertical,
      -1.42,
      1.05,
    );
  }

  #updateWalk(delta) {
    const forward = axisValue(
      this.input,
      ["KeyW", "ArrowUp"],
      ["KeyS", "ArrowDown"],
    );
    const strafe = axisValue(
      this.input,
      ["KeyD", "ArrowRight"],
      ["KeyA", "ArrowLeft"],
    );

    const magnitude = Math.hypot(forward, strafe);
    if (magnitude > 0) {
      const isRunning = this.input.isPressed("ShiftLeft", "ShiftRight");
      const speed = isRunning ? 10.5 : 5.2;
      const normalizedForward = forward / magnitude;
      const normalizedStrafe = strafe / magnitude;
      const distance = speed * delta;

      const east =
        (normalizedForward * Math.sin(this.heading) +
          normalizedStrafe * Math.cos(this.heading)) *
        distance;
      const north =
        (normalizedForward * Math.cos(this.heading) -
          normalizedStrafe * Math.sin(this.heading)) *
        distance;

      this.#moveAcrossGround(east, north);
    }

    this.#updateJump(delta);
  }

  #updateJump(delta) {
    const jumpPressed = this.input.isPressed("Space");

    if (jumpPressed && !this.jumpLatch && this.jumpOffset <= 0.001) {
      this.verticalVelocity = 5.3;
      this.jumpLatch = true;
    }

    if (!jumpPressed) {
      this.jumpLatch = false;
    }

    this.verticalVelocity -= 15.5 * delta;
    this.jumpOffset += this.verticalVelocity * delta;

    if (this.jumpOffset < 0) {
      this.jumpOffset = 0;
      this.verticalVelocity = 0;
    }
  }

  #updateCar(delta) {
    const throttle = axisValue(
      this.input,
      ["KeyW", "ArrowUp"],
      ["KeyS", "ArrowDown"],
    );
    const steering = axisValue(
      this.input,
      ["KeyD", "ArrowRight"],
      ["KeyA", "ArrowLeft"],
    );

    const isFastMode = this.input.isPressed("ShiftLeft", "ShiftRight");
    const maximumForwardSpeed = isFastMode ? 55 : 38;
    const targetSpeed =
      throttle > 0 ? maximumForwardSpeed : throttle < 0 ? -12 : 0;

    if (throttle !== 0) {
      const isChangingDirection =
        Math.sign(this.carSpeed) !== 0 &&
        Math.sign(this.carSpeed) !== Math.sign(targetSpeed);
      const acceleration = isChangingDirection ? 18 : 8.5;
      this.carSpeed = approach(
        this.carSpeed,
        targetSpeed,
        acceleration * delta,
      );
    } else {
      this.carSpeed = approach(this.carSpeed, 0, 3.2 * delta);
    }

    if (this.input.isPressed("Space")) {
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

    const throttle = axisValue(
      this.input,
      ["KeyW", "ArrowUp"],
      ["KeyS", "ArrowDown"],
    );

    if (throttle !== 0) {
      const targetSpeed = throttle > 0 ? 70 : -28;
      this.trainSpeed = approach(
        this.trainSpeed,
        targetSpeed,
        1.6 * delta,
      );
    } else {
      this.trainSpeed = approach(this.trainSpeed, 0, 0.18 * delta);
    }

    if (this.input.isPressed("Space")) {
      this.trainSpeed = approach(this.trainSpeed, 0, 12 * delta);
    }

    this.trainDistance = clamp(
      this.trainDistance + this.trainSpeed * delta,
      0,
      this.trainRoute.lengthMeters,
    );

    const isAtRouteEnd =
      this.trainDistance === 0 ||
      this.trainDistance === this.trainRoute.lengthMeters;

    if (isAtRouteEnd) {
      this.trainSpeed = 0;
    }

    this.#placeTrain();
  }

  #placeTrain() {
    if (!this.trainRoute) return;

    const { points, cumulative } = this.trainRoute;
    let segmentIndex = 0;

    while (
      segmentIndex < cumulative.length - 2 &&
      cumulative[segmentIndex + 1] < this.trainDistance
    ) {
      segmentIndex += 1;
    }

    const startDistance = cumulative[segmentIndex];
    const endDistance = cumulative[segmentIndex + 1];
    const segmentLength = Math.max(0.001, endDistance - startDistance);
    const amount = clamp(
      (this.trainDistance - startDistance) / segmentLength,
      0,
      1,
    );
    const start = points[segmentIndex];
    const end = points[segmentIndex + 1];
    const position = interpolateCoordinate(start, end, amount);

    this.latitude = position.latitude;
    this.longitude = position.longitude;
    this.heading = CesiumMath.zeroToTwoPi(
      this.trainSpeed >= 0
        ? bearingRadians(start, end)
        : bearingRadians(end, start),
    );
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
      this.groundHeight + EYE_HEIGHT_METERS[this.mode] + this.jumpOffset,
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
}
