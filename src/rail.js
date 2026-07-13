const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

const RAIL_FILTER = "rail|light_rail|subway|tram|narrow_gauge";
const CONNECT_DISTANCE_METERS = 45;
const EARTH_RADIUS_METERS = 6_371_008.8;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

export function distanceMeters(a, b) {
  const latitude1 = toRadians(a.latitude);
  const latitude2 = toRadians(b.latitude);
  const latitudeDelta = latitude2 - latitude1;
  const longitudeDelta = toRadians(b.longitude - a.longitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1) *
      Math.cos(latitude2) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    2 *
    EARTH_RADIUS_METERS *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function normalizeWay(element) {
  const points = element.geometry?.map(({ lat, lon }) => ({
    latitude: lat,
    longitude: lon,
  }));

  if (!points || points.length < 2) {
    return null;
  }

  return {
    id: element.id,
    points,
    tags: element.tags ?? {},
  };
}

function nearestPointDistance(way, origin) {
  return way.points.reduce(
    (best, point) => Math.min(best, distanceMeters(point, origin)),
    Number.POSITIVE_INFINITY,
  );
}

function endpoints(way) {
  return {
    start: way.points[0],
    end: way.points[way.points.length - 1],
  };
}

function connectWays(seed, candidates) {
  const route = [...seed.points];
  const used = new Set([seed.id]);

  for (let iteration = 0; iteration < 80; iteration += 1) {
    let best = null;

    for (const way of candidates) {
      if (used.has(way.id)) continue;

      const routeStart = route[0];
      const routeEnd = route[route.length - 1];
      const { start, end } = endpoints(way);
      const matches = [
        { distance: distanceMeters(routeEnd, start), placement: "append" },
        { distance: distanceMeters(routeEnd, end), placement: "append-reverse" },
        { distance: distanceMeters(routeStart, end), placement: "prepend" },
        { distance: distanceMeters(routeStart, start), placement: "prepend-reverse" },
      ];

      for (const match of matches) {
        if (
          match.distance <= CONNECT_DISTANCE_METERS &&
          (!best || match.distance < best.distance)
        ) {
          best = { ...match, way };
        }
      }
    }

    if (!best) break;

    const points = [...best.way.points];
    if (best.placement.endsWith("reverse")) points.reverse();

    if (best.placement.startsWith("append")) {
      route.push(...points.slice(1));
    } else {
      route.unshift(...points.slice(0, -1));
    }

    used.add(best.way.id);
  }

  return route;
}

function buildQuery(latitude, longitude, radiusMeters) {
  return `
[out:json][timeout:25];
way(around:${Math.round(radiusMeters)},${latitude},${longitude})
  ["railway"~"^(${RAIL_FILTER})$"];
out tags geom;
  `.trim();
}

async function requestOverpass(query, signal) {
  let lastError;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({ data: query }),
        signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (error.name === "AbortError") throw error;
      lastError = error;
    }
  }

  throw new Error(
    `線路データを取得できませんでした${lastError ? `: ${lastError.message}` : ""}`,
  );
}

export async function loadNearestRailRoute(
  latitude,
  longitude,
  { radiusMeters = 18_000, signal } = {},
) {
  const origin = { latitude, longitude };
  const payload = await requestOverpass(
    buildQuery(latitude, longitude, radiusMeters),
    signal,
  );

  const ways = (payload.elements ?? []).map(normalizeWay).filter(Boolean);
  if (!ways.length) {
    throw new Error("周辺に利用できる線路が見つかりませんでした");
  }

  ways.sort(
    (a, b) =>
      nearestPointDistance(a, origin) - nearestPointDistance(b, origin),
  );

  const seed = ways[0];
  const points = connectWays(seed, ways);
  if (points.length < 2) {
    throw new Error("走行可能な線路形状を構築できませんでした");
  }

  const name =
    seed.tags.name ||
    seed.tags["name:ja"] ||
    seed.tags.operator ||
    "名称不明の線路";

  return {
    name,
    points,
    source: "OpenStreetMap / Overpass",
  };
}
