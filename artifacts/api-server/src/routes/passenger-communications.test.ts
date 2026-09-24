import assert from "node:assert/strict";
import test from "node:test";
import {
  coachTargetsForRuns,
  communicationPublicationStatus,
  isSingleRouteDateRunGroup,
} from "./passenger-communications";
import { adminRoleHasAnyCapability } from "../middlewares/admin-role-policy";

const now = new Date("2026-04-20T14:00:00.000Z");

test("communication publication status separates scheduled, published, and expired windows", () => {
  assert.equal(communicationPublicationStatus({
    startsAt: new Date("2026-04-20T15:00:00.000Z"),
    expiresAt: new Date("2026-04-20T17:00:00.000Z"),
    clearedAt: null,
  }, now), "scheduled");
  assert.equal(communicationPublicationStatus({
    startsAt: new Date("2026-04-20T13:00:00.000Z"),
    expiresAt: new Date("2026-04-20T17:00:00.000Z"),
    clearedAt: null,
  }, now), "published");
  assert.equal(communicationPublicationStatus({
    startsAt: new Date("2026-04-20T11:00:00.000Z"),
    expiresAt: new Date("2026-04-20T14:00:00.000Z"),
    clearedAt: null,
  }, now), "expired");
});

test("withdrawn is distinct from expiry and wins regardless of the publication window", () => {
  assert.equal(communicationPublicationStatus({
    startsAt: new Date("2026-04-20T15:00:00.000Z"),
    expiresAt: new Date("2026-04-20T17:00:00.000Z"),
    clearedAt: new Date("2026-04-20T13:30:00.000Z"),
  }, now), "withdrawn");
});

test("a route group is bounded to one route and service date", () => {
  assert.equal(isSingleRouteDateRunGroup([
    "2026-04-20|1|3|2|08:00",
    "2026-04-20|1|3|2|09:00",
  ]), true);
  assert.equal(isSingleRouteDateRunGroup([
    "2026-04-20|1|3|2|08:00",
    "2026-04-21|1|3|2|09:00",
  ]), false);
  assert.equal(isSingleRouteDateRunGroup([
    "2026-04-20|1|3|2|08:00",
    "2026-04-20|1|2|3|09:00",
  ]), false);
});

test("selected coaches affect only the matching runs in a route group", () => {
  const result = coachTargetsForRuns([
    { run: "first", assignedCoaches: ["101", "102"] },
    { run: "second", assignedCoaches: ["201"] },
    { run: "third", assignedCoaches: [] },
  ], ["102", "201"]);
  assert.deepEqual(result.affectedRuns.map(run => [run.run, run.selectedCoaches]), [
    ["first", ["102"]],
    ["second", ["201"]],
  ]);
  assert.deepEqual(result.unresolvedCoaches, []);
});

test("passenger notice policy allows dispatcher, content, and admin without broadening role capabilities", () => {
  const scoped = ["dispatch", "content"] as const;
  assert.equal(adminRoleHasAnyCapability("admin", scoped), true);
  assert.equal(adminRoleHasAnyCapability("dispatcher", scoped), true);
  assert.equal(adminRoleHasAnyCapability("content", scoped), true);
  assert.equal(adminRoleHasAnyCapability("dispatcher", ["content"]), false);
  assert.equal(adminRoleHasAnyCapability("content", ["dispatch"]), false);
  assert.equal(adminRoleHasAnyCapability("dispatcher", ["identity"]), false);
});