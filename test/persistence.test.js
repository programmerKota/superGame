import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_LOCATION, STORAGE_KEYS } from "../src/config.js";
import { loadLastLocation, saveLastLocation } from "../src/persistence.js";

function createMemoryStorage(initialValue = null) {
  const values = new Map();
  if (initialValue !== null) {
    values.set(STORAGE_KEYS.lastLocation, initialValue);
  }

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("loadLastLocation returns the default when storage is empty", () => {
  assert.deepEqual(loadLastLocation(createMemoryStorage()), DEFAULT_LOCATION);
});

test("saveLastLocation stores a normalized location", () => {
  const storage = createMemoryStorage();
  const location = {
    latitude: 35.681236,
    longitude: 139.767125,
    label: "東京駅",
    ignored: true,
  };

  saveLastLocation(location, storage);

  assert.deepEqual(loadLastLocation(storage), {
    latitude: 35.681236,
    longitude: 139.767125,
    label: "東京駅",
  });
});

test("loadLastLocation ignores malformed stored data", () => {
  const storage = createMemoryStorage('{"latitude":999,"longitude":0}');
  assert.deepEqual(loadLastLocation(storage), DEFAULT_LOCATION);
});
