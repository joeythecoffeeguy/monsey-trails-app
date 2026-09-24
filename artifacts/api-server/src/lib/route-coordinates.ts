export type RouteCoordinate = { lat: number; lng: number };

function milesBetween(a: RouteCoordinate, b: RouteCoordinate) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latDistance = radians(b.lat - a.lat);
  const lngDistance = radians(b.lng - a.lng);
  const haversine = Math.sin(latDistance / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lngDistance / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function isMonseyTrailsServiceCoordinate(point: RouteCoordinate) {
  return Number.isFinite(point.lat)
    && Number.isFinite(point.lng)
    && point.lat >= 38
    && point.lat <= 43.5
    && point.lng >= -76.5
    && point.lng <= -71;
}

export function repairMissingWesternLongitude(
  point: RouteCoordinate,
  anchors: RouteCoordinate[],
): RouteCoordinate {
  if (point.lng <= 0 || anchors.length === 0) return point;
  const repaired = { ...point, lng: -point.lng };
  const originalDistance = Math.min(...anchors.map(anchor => milesBetween(point, anchor)));
  const repairedDistance = Math.min(...anchors.map(anchor => milesBetween(repaired, anchor)));
  return originalDistance > 1_000 && repairedDistance <= 150 ? repaired : point;
}