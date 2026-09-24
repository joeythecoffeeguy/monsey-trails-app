import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hashAdminNotificationCapability,
  ownsAdminNotificationDevice,
  parseAdminNotificationRegistration,
  publicNotificationHealth,
} from "./admin-notification-security";

const capability = "A".repeat(43);
const keys = { p256dh: "B".repeat(43), auth: "C".repeat(22) };

test("registration only accepts allowlisted push providers", () => {
  assert.ok(parseAdminNotificationRegistration({
    capability,
    subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/own", keys },
  }));
  assert.equal(parseAdminNotificationRegistration({
    capability,
    subscription: { endpoint: "https://push.attacker.example/collect", keys },
  }), null);
});

test("test delivery ownership requires both current subject and browser capability", () => {
  const row = { adminSubject: "admin-a", capabilityHash: hashAdminNotificationCapability(capability) };
  assert.equal(ownsAdminNotificationDevice(row, "admin-a", capability), true);
  assert.equal(ownsAdminNotificationDevice(row, "admin-b", capability), false);
  assert.equal(ownsAdminNotificationDevice(row, "admin-a", "D".repeat(43)), false);
});

test("health projection cannot expose device credentials or passenger identity", () => {
  const payload = publicNotificationHealth({
    passengerAlerts: { total: 3, failures: 1 },
    departureReminders: { total: 2, invalidDevices: 1 },
    webStopSubscriptions: 4,
    adminTestDevices: { registered: 1 },
    background: { ready: false, detail: "not configured" },
    // Runtime aggregate queries never pass rows, but ensure excess top-level
    // input is excluded by the explicit public projection.
    ...({ endpoint: "secret", deviceId: "passenger", p256dh: "secret" } as object),
  });
  const encoded = JSON.stringify(payload);
  assert.doesNotMatch(encoded, /endpoint|deviceId|p256dh|secret/);
});