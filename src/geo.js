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

export function bearingRadians(a, b) {
  const latitude1 = toRadians(a.latitude);
  const latitude2 = toRadians(b.latitude);
  const longitudeDelta = toRadians(b.longitude - a.longitude);
  const y = Math.sin(longitudeDelta) * Math.cos(latitude2);
  const x =
    Math.cos(latitude1) * Math.sin(latitude2) -
    Math.sin(latitude1) *
      Math.cos(latitude2) *
      Math.cos(longitudeDelta);

  return Math.atan2(y, x);
}

export function interpolateCoordinate(a, b, amount) {
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * amount,
    longitude: a.longitude + (b.longitude - a.longitude) * amount,
  };
}
