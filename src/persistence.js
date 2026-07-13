import { DEFAULT_LOCATION, STORAGE_KEYS } from "./config.js";

function isValidLocation(value) {
  return (
    Number.isFinite(value?.latitude) &&
    Number.isFinite(value?.longitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}

export function loadLastLocation(storage = localStorage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEYS.lastLocation));
    return isValidLocation(parsed) ? parsed : DEFAULT_LOCATION;
  } catch {
    return DEFAULT_LOCATION;
  }
}

export function saveLastLocation(location, storage = localStorage) {
  if (!isValidLocation(location)) return;

  storage.setItem(
    STORAGE_KEYS.lastLocation,
    JSON.stringify({
      latitude: location.latitude,
      longitude: location.longitude,
      label: location.label ?? "保存地点",
    }),
  );
}
