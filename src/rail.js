import { distanceMeters } from "./geo.js";

const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

const RAIL_FILTER = "rail|light_rail|subway|tram|narrow_gauge";
const CONNECT_DISTANCE_METERS = 45;
const MAX_CONNECTED_WAYS = 80;

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

function getEndpoints(way) {
  return {
    start: way.points[0],
    end: way.points.at(-1),
  };
}

function getConnectionCandidates(route, way) {
  const routeStart = route[0];
  const routeEnd = route.at(-1);
  const { start, end } = getEndpoints(way);

  return [
    { distance: distanceMeters(routeEnd, start), placement: "append" },
    {
      distance: distanceMeters(routeEnd, end),
      placement: "append-reverse",
    },
    { distance: distanceMeters(routeStart, end), placement: "prepend" },
    {
      distance: distanceMeters(routeStart, start),
      placement: "prepend-reverse",
    },
  ];
}

function findBestConnection(route, candidates, usedWayIds) {
  let bestConnection = null;

  for (const way of candidates) {
    if (usedWayIds.has(way.id)) continue;

    for (const candidate of getConnectionCandidates(route, way)) {
      const isCloser =
        !bestConnection || candidate.distance < bestConnection.distance;

      if (candidate.distance <= CONNECT_DISTANCE_METERS && isCloser) {
        bestConnection = { ...candidate, way };
      }
    }
  }

  return bestConnection;
}

function connectWays(seed, candidates) {
  const route = [...seed.points];
  const usedWayIds = new Set([seed.id]);

  for (let count = 1; count < MAX_CONNECTED_WAYS; count += 1) {
    const connection = findBestConnection(route, candidates, usedWayIds);
    if (!connection) break;

    const points = [...connection.way.points];
    if (connection.placement.endsWith("reverse")) {
      points.reverse();
    }

    if (connection.placement.startsWith("append")) {
      route.push(...points.slice(1));
    } else {
      route.unshift(...points.slice(0, -1));
    }

    usedWayIds.add(connection.way.id);
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

  const details = lastError ? `: ${lastError.message}` : "";
  throw new Error(`線路データを取得できませんでした${details}`);
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

  return {
    name:
      seed.tags["name:ja"] ||
      seed.tags.name ||
      seed.tags.operator ||
      "名称不明の線路",
    points,
    source: "OpenStreetMap / Overpass",
  };
}
