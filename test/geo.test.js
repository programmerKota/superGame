import assert from "node:assert/strict";
import test from "node:test";
import {
  bearingRadians,
  distanceMeters,
  interpolateCoordinate,
} from "../src/geo.js";

test("distanceMeters returns zero for the same coordinate", () => {
  const point = { latitude: 35.681236, longitude: 139.767125 };
  assert.equal(distanceMeters(point, point), 0);
});

test("distanceMeters produces a plausible distance for one degree of latitude", () => {
  const distance = distanceMeters(
    { latitude: 0, longitude: 0 },
    { latitude: 1, longitude: 0 },
  );

  assert.ok(distance > 110_000);
  assert.ok(distance < 112_000);
});

test("bearingRadians points north for increasing latitude", () => {
  const bearing = bearingRadians(
    { latitude: 35, longitude: 139 },
    { latitude: 36, longitude: 139 },
  );

  assert.ok(Math.abs(bearing) < 1e-12);
});

test("interpolateCoordinate returns the midpoint", () => {
  assert.deepEqual(
    interpolateCoordinate(
      { latitude: 10, longitude: 20 },
      { latitude: 14, longitude: 28 },
      0.5,
    ),
    { latitude: 12, longitude: 24 },
  );
});
