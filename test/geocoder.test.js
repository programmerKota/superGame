import assert from "node:assert/strict";
import test from "node:test";
import { resolveLocation } from "../src/geocoder.js";

test("resolveLocation parses comma-separated coordinates", async () => {
  const location = await resolveLocation("35.681236,139.767125");

  assert.deepEqual(location, {
    latitude: 35.681236,
    longitude: 139.767125,
    label: "35.681236, 139.767125",
  });
});

test("resolveLocation parses Japanese comma-separated coordinates", async () => {
  const location = await resolveLocation("35.681236、139.767125");

  assert.equal(location.latitude, 35.681236);
  assert.equal(location.longitude, 139.767125);
});

test("resolveLocation rejects out-of-range coordinates", async () => {
  await assert.rejects(
    () => resolveLocation("91,139"),
    /緯度・経度の値が正しくありません/,
  );
});

test("resolveLocation rejects an empty query", async () => {
  await assert.rejects(
    () => resolveLocation("   "),
    /地名または座標を入力してください/,
  );
});
