import assert from "node:assert/strict";
import test from "node:test";
import { deriveOperationsExceptions } from "./admin-operations";

const now = new Date("2026-01-15T15:00:00.000Z");
const base = {
  busNumber: "42",
  driverName: "A Driver",
  direction: "Monsey → Manhattan",
  scheduledDepartureAt: new Date("2026-01-15T14:50:00.000Z"),
  currentLat: null,
  currentLng: null,
  locationUpdatedAt: null,
  passengerLastSeenAt: null,
  officialRunKey: "2026-01-15|1|2|3|run-1",
};

test("derives only evidence-backed active trip exceptions", () => {
  const exceptions = deriveOperationsExceptions([
    { ...base, status: "ready" },
    {
      ...base,
      busNumber: "43",
      status: "running",
      currentLat: 41.1,
      currentLng: -74.1,
      locationUpdatedAt: new Date("2026-01-15T14:57:00.000Z"),
      passengerLastSeenAt: new Date("2026-01-15T14:58:00.000Z"),
    },
  ], now, () => 0);

  assert.deepEqual(exceptions.map(item => item.type).sort(), [
    "disconnected_display",
    "late_departure",
    "stale_gps",
  ]);
  assert.equal(exceptions.find(item => item.type === "stale_gps")?.lastSeenAt, "2026-01-15T14:57:00.000Z");
});

test("does not report a display disconnect without a recorded last seen", () => {
  const exceptions = deriveOperationsExceptions([
    { ...base, status: "running", scheduledDepartureAt: null },
  ], now, () => 0);

  assert.equal(exceptions.some(item => item.type === "disconnected_display"), false);
  assert.equal(exceptions.some(item => item.type === "missing_gps"), true);
});

test("includes structured disruptions only for matching active trips", () => {
  const exceptions = deriveOperationsExceptions(
    [{ ...base, status: "ready", scheduledDepartureAt: now }],
    now,
    () => 1,
    [{
      id: "notice-1",
      officialRunKey: base.officialRunKey,
      type: "cancellation",
      message: "Trip cancelled by dispatch.",
      delayMinutes: null,
      stopName: null,
      startsAt: "2026-01-15T14:00:00.000Z",
      expiresAt: "2026-01-15T16:00:00.000Z",
      createdAt: "2026-01-15T14:00:00.000Z",
      updatedAt: "2026-01-15T14:30:00.000Z",
    }],
  );

  assert.equal(exceptions.length, 1);
  assert.equal(exceptions[0]?.type, "active_disruption");
  assert.equal(exceptions[0]?.severity, "critical");
});