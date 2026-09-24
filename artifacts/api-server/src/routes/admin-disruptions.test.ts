import assert from "node:assert/strict";
import test from "node:test";
import { normalizedDisruptionInput } from "./admin-disruptions";

const runKey = "2026-09-22|1|2|3|700";

test("service disruption input enforces structured fields and plain text", () => {
  const valid = normalizedDisruptionInput({
    officialRunKey: runKey,
    type: "delay",
    message: "Heavy traffic near the bridge.",
    delayMinutes: 20,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
  assert.ok("data" in valid);
  if (!("data" in valid) || !valid.data) throw new Error("Expected valid disruption input");
  assert.equal(valid.data.delayMinutes, 20);
  assert.equal(valid.data.stopName, null);

  assert.ok("error" in normalizedDisruptionInput({
    officialRunKey: runKey,
    type: "detour",
    message: "<strong>Use another road</strong>",
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  }));
  assert.ok("error" in normalizedDisruptionInput({
    officialRunKey: runKey,
    type: "skipped_stop",
    message: "This stop will not be served.",
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  }));
});

test("service disruption input rejects expired and excessively long notices", () => {
  assert.ok("error" in normalizedDisruptionInput({
    officialRunKey: runKey,
    type: "cancellation",
    message: "Trip cancelled.",
    expiresAt: new Date(Date.now() - 1_000).toISOString(),
  }));
  assert.ok("error" in normalizedDisruptionInput({
    officialRunKey: runKey,
    type: "detour",
    message: "Temporary detour.",
    expiresAt: new Date(Date.now() + 31 * 24 * 60 * 60_000).toISOString(),
  }));
});