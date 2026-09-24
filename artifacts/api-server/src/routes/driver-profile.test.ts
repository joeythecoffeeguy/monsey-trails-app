import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeProfile } from "./driver-profile";

test("validates complete driver profiles and normalizes US and international phone numbers", () => {
  assert.deepEqual(normalizeProfile({ username: " Driver.One ", unitNumber: " 102 ", phoneNumber: "(845) 555-0123" }),
    { username: "Driver.One", unitNumber: "102", phoneNumber: "+18455550123" });
  assert.equal(normalizeProfile({ username: "Driver-2", unitNumber: "2", phoneNumber: "+44 20 7946 0123" }).phoneNumber, "+442079460123");
  for (const bad of [
    {}, { username: "ab", unitNumber: "2", phoneNumber: "8455550123" },
    { username: "driver", unitNumber: "", phoneNumber: "8455550123" },
    { username: "driver", unitNumber: "2", phoneNumber: "123" },
    { username: "driver<script>", unitNumber: "2", phoneNumber: "8455550123" },
  ]) assert.throws(() => normalizeProfile(bad));
});