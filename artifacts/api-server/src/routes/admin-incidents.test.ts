import assert from "node:assert/strict";
import test from "node:test";
import { missingIncidentEvidence, nextIncidentStatus } from "./admin-incidents";

test("incident lifecycle advances only from persisted consequential evidence", () => {
  assert.equal(nextIncidentStatus("identified", "progress_note"), "identified");
  assert.equal(nextIncidentStatus("identified", "replacement_confirmed"), "replacement_confirmed");
  assert.equal(nextIncidentStatus("replacement_confirmed", "driver_instruction_confirmed"), "instructions_sent");
  assert.equal(nextIncidentStatus("instructions_sent", "passenger_notice_confirmed"), "passenger_notice_published");
  assert.equal(nextIncidentStatus("passenger_notice_published", "driver_instruction_confirmed"), "passenger_notice_published");
  assert.equal(nextIncidentStatus("resolved", "driver_instruction_confirmed"), "resolved");
});

test("resolution accepts documented not-needed steps without fake evidence", () => {
  assert.deepEqual(missingIncidentEvidence([]), ["replacement", "driver instruction", "passenger notice"]);
  assert.deepEqual(
    missingIncidentEvidence(["replacement_confirmed", "progress_note", "driver_instruction_confirmed"]),
    ["passenger notice"],
  );
  assert.deepEqual(missingIncidentEvidence([
    "replacement_confirmed",
    "driver_instruction_confirmed",
    "passenger_notice_confirmed",
  ]), []);
  assert.deepEqual(missingIncidentEvidence([
    "replacement_not_needed",
    "driver_instruction_confirmed",
    "passenger_notice_not_needed",
  ]), []);
});

test("incident router is protected by dispatch capability before body parsing", async () => {
  const source = await import("node:fs/promises").then(fs => fs.readFile(
    new URL("./admin-incidents.ts", import.meta.url),
    "utf8",
  ));
  const authorization = source.indexOf('router.use("/admin/incidents", requireAdminCapability("dispatch"))');
  const parser = source.indexOf('router.use("/admin/incidents", json())');
  assert.ok(authorization >= 0, "incident routes require live dispatch authorization");
  assert.ok(parser > authorization, "authorization must run before parsing mutation bodies");
});