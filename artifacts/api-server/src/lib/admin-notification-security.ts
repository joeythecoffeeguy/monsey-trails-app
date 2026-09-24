import { createHash } from "node:crypto";
import { isSupportedPushEndpoint } from "../routes/push-endpoint";

const capabilityPattern = /^[A-Za-z0-9_-]{32,180}$/;
const keyPattern = /^[A-Za-z0-9_-]{16,180}$/;

export function hashAdminNotificationCapability(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function parseAdminNotificationRegistration(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const candidate = body as {
    capability?: unknown;
    subscription?: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  };
  const capability = candidate.capability;
  const endpoint = candidate.subscription?.endpoint;
  const p256dh = candidate.subscription?.keys?.p256dh;
  const auth = candidate.subscription?.keys?.auth;
  if (typeof capability !== "string" || !capabilityPattern.test(capability)
    || !isSupportedPushEndpoint(endpoint)
    || typeof p256dh !== "string" || !keyPattern.test(p256dh)
    || typeof auth !== "string" || !keyPattern.test(auth)) return null;
  return {
    capabilityHash: hashAdminNotificationCapability(capability),
    endpoint: endpoint as string,
    p256dh,
    auth,
  };
}

export function parseAdminNotificationCapability(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const capability = (body as { capability?: unknown }).capability;
  return typeof capability === "string" && capabilityPattern.test(capability)
    ? capability : null;
}

export function ownsAdminNotificationDevice(
  row: { adminSubject: string; capabilityHash: string },
  adminSubject: string,
  capability: string,
) {
  return row.adminSubject === adminSubject
    && row.capabilityHash === hashAdminNotificationCapability(capability);
}

/** Explicit projection prevents credentials and passenger identity leaking. */
export function publicNotificationHealth(input: {
  passengerAlerts: object;
  departureReminders: object;
  webStopSubscriptions: number;
  adminTestDevices: object;
  background: { ready: boolean; detail: string };
}) {
  return {
    passengerAlerts: input.passengerAlerts,
    departureReminders: input.departureReminders,
    webStopSubscriptions: input.webStopSubscriptions,
    adminTestDevices: input.adminTestDevices,
    background: input.background,
    semantics: "Accepted means the push provider accepted the request; it does not mean the device displayed or the user read it.",
  };
}