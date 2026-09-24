// @ts-nocheck -- This library intentionally does not include Node types in its public build.
import assert from "node:assert/strict";
import test from "node:test";

import {
  addServiceDays,
  getNewYorkServiceDate,
  getScheduledDepartureInstant,
  getUpcomingScheduleRuns,
} from "./schedule-time";

test("gets the New York service date independently of the host timezone", () => {
  assert.equal(getNewYorkServiceDate(new Date("2025-01-15T04:59:59.999Z")), "2025-01-14");
  assert.equal(getNewYorkServiceDate(new Date("2025-01-15T05:00:00.000Z")), "2025-01-15");
  assert.equal(getNewYorkServiceDate(new Date("2025-07-15T03:59:59.999Z")), "2025-07-14");
  assert.equal(getNewYorkServiceDate(new Date("2025-07-15T04:00:00.000Z")), "2025-07-15");
});

test("parses both published wall-clock formats in New York", () => {
  assert.equal(
    getScheduledDepartureInstant("2025-01-15", "06:15")?.toISOString(),
    "2025-01-15T11:15:00.000Z",
  );
  assert.equal(
    getScheduledDepartureInstant("2025-07-15", "06:15:27")?.toISOString(),
    "2025-07-15T10:15:27.000Z",
  );
});

test("supports extended overnight hours without changing the service identity", () => {
  assert.equal(
    getScheduledDepartureInstant("2026-09-19", "24:15:00")?.toISOString(),
    "2026-09-20T04:15:00.000Z",
  );
  assert.equal(getScheduledDepartureInstant("2026-09-19", "48:00:00"), null);
});

test("honors explicit ISO offsets", () => {
  assert.equal(
    getScheduledDepartureInstant("2025-11-02", "01:30:00-04:00")?.toISOString(),
    "2025-11-02T05:30:00.000Z",
  );
  assert.equal(
    getScheduledDepartureInstant("2025-11-02", "2025-11-02T01:30:00-05:00")?.toISOString(),
    "2025-11-02T06:30:00.000Z",
  );
  assert.equal(
    getScheduledDepartureInstant("2025-01-15", "2025-01-15T12:00Z")?.toISOString(),
    "2025-01-15T12:00:00.000Z",
  );
});

test("uses the later fall-back instant and rejects a missing spring instant", () => {
  assert.equal(
    getScheduledDepartureInstant("2025-11-02", "01:30:00")?.toISOString(),
    "2025-11-02T06:30:00.000Z",
  );
  assert.equal(getScheduledDepartureInstant("2025-03-09", "02:30:00"), null);
  assert.equal(
    getScheduledDepartureInstant("2025-03-09", "03:30:00")?.toISOString(),
    "2025-03-09T07:30:00.000Z",
  );
});

test("rejects malformed dates and times", () => {
  for (const [date, time] of [
    ["2025-02-29", "06:15:00"],
    ["2024-02-29x", "06:15:00"],
    ["2025-01-15", "6:15:00"],
    ["2025-01-15", "48:00:00"],
    ["2025-01-15", "12:60:00"],
    ["2025-01-15", "12:00:60"],
    ["2025-01-15", "12:00:00.000"],
    ["2025-01-15", "2025-02-30T12:00:00Z"],
    ["2025-01-15", "12:00:00+24:00"],
  ]) {
    assert.equal(getScheduledDepartureInstant(date, time), null, `${date} ${time}`);
  }
});

test("past service dates have no runs and future dates retain every run", () => {
  const runs = [
    { scheduledTime: "bad", id: 1 },
    { scheduledTime: "06:15:00", id: 2 },
  ];
  const now = new Date("2025-01-11T05:01:00.000Z");

  assert.deepEqual(getUpcomingScheduleRuns(runs, "2025-01-10", now), []);
  assert.equal(getUpcomingScheduleRuns(runs, "2025-01-12", now), runs);
});

test("today keeps only valid departures strictly after now", () => {
  const runs = [
    { id: "passed", scheduledTime: "22:59:59" },
    { id: "cutoff", scheduledTime: "23:00:00" },
    { id: "next", scheduledTime: "23:00:01" },
    { id: "fallback", scheduledTime: "", firstPickupTime: "23:30:00" },
    { id: "invalid", scheduledTime: "tomorrow", firstPickupTime: "23:45:00" },
  ];
  const snapshot = JSON.stringify(runs);
  const upcoming = getUpcomingScheduleRuns(
    runs,
    "2025-01-10",
    new Date("2025-01-11T04:00:00.000Z"),
  );

  assert.deepEqual(upcoming.map((run) => run.id), ["next", "fallback"]);
  assert.equal(JSON.stringify(runs), snapshot);
  assert.notEqual(upcoming, runs);
});

test("the last Friday departure disappears after New York midnight", () => {
  const runs = [{ scheduledTime: "23:59:00" }];
  assert.deepEqual(
    getUpcomingScheduleRuns(runs, "2025-01-10", new Date("2025-01-11T05:00:01.000Z")),
    [],
  );
});

test("adds service days with UTC calendar arithmetic", () => {
  assert.equal(addServiceDays("2025-03-08", 1), "2025-03-09");
  assert.equal(addServiceDays("2025-03-09", 1), "2025-03-10");
  assert.equal(addServiceDays("2025-11-02", 1), "2025-11-03");
  assert.equal(addServiceDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addServiceDays("2025-01-01", -1), "2024-12-31");
  assert.throws(() => addServiceDays("2025-02-29", 1), RangeError);
  assert.throws(() => addServiceDays("2025-01-01", 1.5), RangeError);
});