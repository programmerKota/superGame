export const DEFAULT_LOCATION = Object.freeze({
  latitude: 35.681236,
  longitude: 139.767125,
  label: "東京駅",
});

export const MODE_LABELS = Object.freeze({
  walk: "徒歩",
  car: "車",
  train: "電車",
});

export const MODE_SHORTCUTS = Object.freeze({
  Digit1: "walk",
  Digit2: "car",
  Digit3: "train",
});

export const STORAGE_KEYS = Object.freeze({
  lastLocation: "supergame:last-location",
});
