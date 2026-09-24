import type { LiveTripRow } from "@workspace/db";

export type LocationVisibility = "before_departure" | "live" | "ended" | "unavailable";
type PrivacyRow = Pick<LiveTripRow, "status" | "retiredAt" | "ownerSubject" | "officialRunKey" | "scheduledDepartureAt" | "completedAt">;

export function locationVisibility(row: PrivacyRow, now = Date.now()): LocationVisibility {
  if (row.retiredAt || row.completedAt || row.status === "stopped") return "ended";
  if (!row.ownerSubject || !row.officialRunKey || !row.scheduledDepartureAt
    || !Number.isFinite(row.scheduledDepartureAt.getTime())) return "unavailable";
  if (now < row.scheduledDepartureAt.getTime()) return "before_departure";
  return row.status === "running" ? "live" : "unavailable";
}

// Always send explicit clearing values: clients may merge snapshots into cached state.
export function passengerLocationFields(row: PrivacyRow & Pick<LiveTripRow, "locationUpdatedAt">, now = Date.now()) {
  const visibility = locationVisibility(row, now);
  return {
    locationVisibility: visibility,
    scheduledDepartureAt: row.scheduledDepartureAt?.toISOString() ?? null,
    locationUpdatedAt: visibility === "live" ? row.locationUpdatedAt?.toISOString() ?? null : null,
    ...(visibility === "live" ? {} : {
      origin: null, currentLocation: null, speedMph: null, bearing: null,
      routeGeometry: [], totalDistanceMiles: null, remainingDistanceMiles: null, eta: null,
    }),
  };
}

export function isPassengerAccess(method: string, path: string, viewer: unknown) {
  if (viewer !== "passenger") return false;
  return (method === "GET" && ["/", "/push-public-key", "/route-geometry"].includes(path))
    || (method === "PUT" && ["/passenger-status", "/display-settings-receipt", "/push-subscription"].includes(path))
    || (method === "DELETE" && /^\/push-subscription\/[^/]+$/.test(path));
}

export function ownsTrip(ownerSubject: string | null, subject: string | null) {
  return Boolean(subject && ownerSubject === subject);
}