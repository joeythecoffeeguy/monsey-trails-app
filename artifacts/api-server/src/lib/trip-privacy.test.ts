import assert from "node:assert/strict";
import { test } from "node:test";
import { isPassengerAccess, locationVisibility, ownsTrip, passengerLocationFields } from "./trip-privacy";
import { scheduledDepartureInstant } from "../routes/schedule";

const row = {
  status: "running", ownerSubject: "driver-a", retiredAt: null, completedAt: null,
  officialRunKey: "2026-07-01|1|2|5|123",
  scheduledDepartureAt: scheduledDepartureInstant("2026-07-01", "07:30:00"),
  locationUpdatedAt: new Date("2026-07-01T12:29:30Z"),
};
test("a running trip stays private until its published departure", () => {
  assert.equal(row.scheduledDepartureAt?.toISOString(), "2026-07-01T11:30:00.000Z");
  assert.equal(locationVisibility(row, Date.parse("2026-07-01T11:29:59.999Z")), "before_departure");
  assert.equal(locationVisibility(row, Date.parse("2026-07-01T11:30:00.000Z")), "live");
  assert.equal(locationVisibility({ ...row, status: "ready" }, Date.parse("2026-07-01T11:29:59.999Z")), "before_departure");
  assert.equal(scheduledDepartureInstant("2026-01-01", "07:30:00")?.toISOString(), "2026-01-01T12:30:00.000Z");
  assert.equal(scheduledDepartureInstant("2026-03-08", "02:30:00"), null);
  assert.equal(scheduledDepartureInstant("2026-11-01", "01:30:00")?.toISOString(), "2026-11-01T06:30:00.000Z");
});

test("final arrival, stop, logout and unknown schedules fail closed with explicit clearing fields", () => {
  const now = Date.parse("2026-07-01T12:30:00Z");
  assert.equal(locationVisibility({ ...row, completedAt: new Date(now) }, now), "ended");
  assert.equal(locationVisibility({ ...row, status: "stopped" }, now), "ended");
  assert.equal(locationVisibility({ ...row, retiredAt: new Date(now), ownerSubject: null }, now), "ended");
  assert.equal(locationVisibility({ ...row, scheduledDepartureAt: null }, now), "unavailable");
  assert.equal(locationVisibility({ ...row, officialRunKey: null }, now), "unavailable");
  assert.equal(locationVisibility({ ...row, ownerSubject: null }, now), "unavailable");
  const hidden = passengerLocationFields({ ...row, scheduledDepartureAt: null }, now);
  for (const field of ["currentLocation", "origin", "speedMph", "bearing", "eta", "remainingDistanceMiles"] as const) {
    assert.equal(hidden[field], null);
  }
  assert.deepEqual(hidden.routeGeometry, []);
  assert.equal(hidden.locationUpdatedAt, null);
});

test("passenger viewer cannot bypass operator reads or mutations", () => {
  assert.equal(isPassengerAccess("GET", "/", undefined), false);
  assert.equal(isPassengerAccess("GET", "/", "passenger"), true);
  assert.equal(isPassengerAccess("GET", "/navigation", "passenger"), false);
  for (const path of ["/start", "/stop", "/arrive", "/location", "/logout", "/qr-invite"]) {
    assert.equal(isPassengerAccess("POST", path, "passenger"), false);
  }
  assert.equal(isPassengerAccess("PUT", "/route-plan", "passenger"), false);
  assert.equal(isPassengerAccess("PATCH", "/display-settings", "passenger"), false);
  assert.equal(isPassengerAccess("PUT", "/passenger-status", "passenger"), true);
  assert.equal(ownsTrip("driver-a", "driver-a"), true);
  assert.equal(ownsTrip("driver-a", "driver-b"), false);
  assert.equal(ownsTrip("driver-a", null), false);
  assert.equal(ownsTrip(null, "driver-a"), false);
});
