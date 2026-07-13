const COORDINATE_PATTERN =
  /^\s*(-?\d+(?:\.\d+)?)\s*[,、 ]\s*(-?\d+(?:\.\d+)?)\s*$/;

function validateCoordinates(latitude, longitude) {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("緯度・経度の値が正しくありません");
  }
}

export async function resolveLocation(rawQuery, { signal } = {}) {
  const query = String(rawQuery ?? "").trim();
  if (!query) {
    throw new Error("地名または座標を入力してください");
  }

  const coordinates = query.match(COORDINATE_PATTERN);
  if (coordinates) {
    const latitude = Number(coordinates[1]);
    const longitude = Number(coordinates[2]);
    validateCoordinates(latitude, longitude);
    return { latitude, longitude, label: `${latitude}, ${longitude}` };
  }

  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  url.searchParams.set("lang", "ja");

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal,
  });

  if (!response.ok) {
    throw new Error("地名検索サービスに接続できませんでした");
  }

  const payload = await response.json();
  const feature = payload.features?.[0];
  const coordinatesFromService = feature?.geometry?.coordinates;

  if (!Array.isArray(coordinatesFromService)) {
    throw new Error("その場所を見つけられませんでした");
  }

  const [longitude, latitude] = coordinatesFromService;
  validateCoordinates(latitude, longitude);

  const properties = feature.properties ?? {};
  const label =
    [
      properties.name,
      properties.city,
      properties.state,
      properties.country,
    ]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(" / ") || query;

  return { latitude, longitude, label };
}
