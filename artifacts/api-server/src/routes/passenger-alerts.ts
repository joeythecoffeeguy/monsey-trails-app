import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  adminDisplaySettingsTable,
  db,
  liveTripsTable,
  passengerAlertsTable,
  type LiveTripRow,
} from "@workspace/db";
import { locationVisibility, passengerLocationFields } from "../lib/trip-privacy";
import { officialAssignmentPriority } from "../lib/official-run-assignment";
import { reconcilePersistedJourneyStopIds, resolveOfficialAssignment, resolveOfficialRunAlias } from "./schedule";
import { activeServiceDisruptions } from "../lib/service-disruptions";
import {
  deliverApproachingPickupAlerts,
  evaluateTransferRealtimeSubscriptions,
  expirePassengerRealtimeSubscriptions,
} from "../lib/passenger-realtime";
import { refreshPassengerLiveActivitiesForTrip } from "../lib/passenger-live-activities";

export const PASSENGER_LANGUAGES = ["en", "yi", "he"] as const;
export type PassengerLanguage = typeof PASSENGER_LANGUAGES[number];
export const LEAD_TIMES = ["time-15m", "time-5m", "time-2m", "arriving-now", "distance-0.5mi"] as const;
export type LeadTime = typeof LEAD_TIMES[number];
export const FINAL_DESTINATION_STOP_ID = "final-destination";
/** "Arriving now" means the coach is within one tenth of a direct mile (about 530 feet) of the stop. */
export const ARRIVING_NOW_DISTANCE_MILES = 0.1;

const router: IRouter = Router();
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
const expoTokenPattern = /^(Expo|ExponentPushToken)\[?[A-Za-z0-9+/_=-]+\]?$/;
const officialRunKeyPattern = /^\d{4}-\d{2}-\d{2}\|[123]\|\d{1,2}\|\d{1,2}\|[^|]{1,80}$/;

export function isExpoPushToken(token: unknown): token is string {
  return typeof token === "string" && expoTokenPattern.test(token) && token.length <= 255;
}

export function alertThresholdReached(
  alert: { leadTime: LeadTime },
  input: { etaSeconds?: number | null; remainingDistanceMiles?: number | null },
) {
  const validEta = typeof input.etaSeconds === "number"
    && Number.isFinite(input.etaSeconds) && input.etaSeconds >= 0;
  const validDistance = typeof input.remainingDistanceMiles === "number"
    && Number.isFinite(input.remainingDistanceMiles) && input.remainingDistanceMiles >= 0;
  switch (alert.leadTime) {
    case "time-15m": return validEta && input.etaSeconds! <= 15 * 60;
    case "time-5m": return validEta && input.etaSeconds! <= 5 * 60;
    case "time-2m": return validEta && input.etaSeconds! <= 2 * 60;
    case "arriving-now": return validDistance && input.remainingDistanceMiles! <= ARRIVING_NOW_DISTANCE_MILES;
    case "distance-0.5mi": return validDistance && input.remainingDistanceMiles! <= 0.5;
  }
}

export function alertHasExpired(
  trip: Pick<LiveTripRow, "status" | "retiredAt" | "intermediateStops" | "passengerPairingCode"
    | "destinationAddress" | "destinationLat" | "destinationLng" | "eta">,
  alert: { selectedStopId: string; expiresAt: Date | null },
  now = Date.now(),
) {
  return Boolean(trip.retiredAt)
    || trip.status !== "running"
    || Boolean(alert.expiresAt && alert.expiresAt.getTime() <= now)
    || !upcomingStopsForTrip(trip).some((stop) => stop.id === alert.selectedStopId);
}

export function upcomingStopsForTrip(row: Pick<LiveTripRow, "status" | "intermediateStops"
  | "destinationAddress" | "destinationLat" | "destinationLng" | "eta">) {
  const stops = row.intermediateStops.map((stop) => ({
    id: stop.id, label: stop.address, eta: stop.eta ?? null, lat: stop.lat, lng: stop.lng,
  }));
  if (row.status === "running" && row.destinationLat !== null && row.destinationLng !== null
      && row.destinationAddress) {
    stops.push({
      id: FINAL_DESTINATION_STOP_ID,
      label: row.destinationAddress,
      eta: row.eta?.toISOString() ?? null,
      lat: row.destinationLat,
      lng: row.destinationLng,
    });
  }
  return stops;
}

export type PassengerJourneyProgressItem = {
  id: string;
  address: string;
  lat: number;
  lng: number;
  eta: string | null;
  status: "completed" | "current" | "upcoming" | "final";
  /** Official semantic for completion wording; absent on legacy payloads. */
  kind?: "pickup" | "dropoff" | "destination";
  completedAt?: string;
};

/**
 * Reconstruct the rider-visible journey without persisting arrival history.  The
 * driver endpoint deliberately removes arrived stops; stable official IDs let us
 * infer the prefix that has been completed.  If persisted stops cannot be
 * identified as an ordered suffix, return no progress rather than guessing.
 */
export function derivePassengerJourneyProgress(
  officialStops: Array<{ id: string; address: string; lat: number; lng: number; kind?: "pickup" | "dropoff" | "destination" }>,
  remainingStops: Array<{ id: string; address: string; lat: number; lng: number; eta?: string | null; kind?: "pickup" | "dropoff" | "destination" }>,
  destination: { id: string; address: string; lat: number; lng: number; kind?: "pickup" | "dropoff" | "destination" },
  options: { completed?: boolean; eta?: string | null } = {},
): PassengerJourneyProgressItem[] {
  const reconciled = reconcilePersistedJourneyStopIds(
    officialStops.map(stop => ({ ...stop, label: stop.address })),
    remainingStops,
  );
  const ids = remainingStops.map(stop => stop.id);
  const first = ids.length ? reconciled.findIndex(stop => stop.id === ids[0]) : -1;
  if (ids.length && first < 0) return [];
  if (ids.some((id, index) => reconciled[first + index]?.id !== id)) return [];
  const all = [...reconciled.map(stop => ({ ...stop, address: stop.address ?? stop.label })), destination];
  const remainingStart = options.completed ? all.length : first < 0 ? reconciled.length : first;
  return all.map((stop, index) => {
    const persisted = remainingStops.find(candidate => candidate.id === stop.id);
    const isFinal = index === all.length - 1;
    const status = options.completed
      ? "completed" as const
      : index < remainingStart
        ? "completed" as const
        : index === remainingStart
          ? isFinal ? "final" as const : "current" as const
          : isFinal ? "final" as const : "upcoming" as const;
    return {
      id: stop.id,
      address: stop.address,
      lat: stop.lat,
      lng: stop.lng,
      eta: persisted?.eta ?? (isFinal ? options.eta ?? null : null),
      status,
      ...(stop.kind ? { kind: stop.kind } : {}),
    };
  });
}

function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radians = (value: number) => value * Math.PI / 180;
  const lat = radians(b.lat - a.lat);
  const lng = radians(b.lng - a.lng);
  const h = Math.sin(lat / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function snapshot(row: LiveTripRow) {
  const privacy = passengerLocationFields(row);
  const [displaySettings] = await db.select({ announcements: adminDisplaySettingsTable.announcements })
    .from(adminDisplaySettingsTable)
    .where(eq(adminDisplaySettingsTable.busNumber, row.pairingCode)).limit(1);
  let journeyProgress: PassengerJourneyProgressItem[] = [];
  if (row.officialRunKey) {
    try {
      const official = await resolveOfficialAssignment(row.officialRunKey);
      const reconciled = reconcilePersistedJourneyStopIds(
        official.intermediateStops.map(stop => ({ ...stop, label: stop.address })),
        row.intermediateStops,
      );
      journeyProgress = derivePassengerJourneyProgress(
        official.intermediateStops,
        row.intermediateStops,
        official.destination,
        { completed: row.status === "completed", eta: row.eta?.toISOString() ?? null },
      );
      // An ID reconciliation that changed the sequence is unsafe for public
      // progress. Keep the legacy upcoming list, but never mislabel stops.
      if (reconciled.length !== official.intermediateStops.length) journeyProgress = [];
    } catch {
      journeyProgress = [];
    }
  }
  return {
    operatorPairingCode: row.pairingCode,
    passengerCode: row.passengerPairingCode,
    language: PASSENGER_LANGUAGES.includes(row.passengerLanguage as PassengerLanguage)
      ? row.passengerLanguage
      : "en",
    active: row.status === "running" && !row.retiredAt,
    announcements: (displaySettings?.announcements ?? row.announcements).filter(item => item.active),
    status: row.status,
    currentLocation: row.currentLat === null || row.currentLng === null
      ? null
      : { lat: row.currentLat, lng: row.currentLng },
    upcomingStops: upcomingStopsForTrip(row).map(({ id, label, eta }) => ({
      id, label, eta: privacy.locationVisibility === "live" ? eta : null,
    })),
    journeyProgress,
    disruptions: row.officialRunKey ? await activeServiceDisruptions(row.officialRunKey, new Date(), row.pairingCode) : [],
    eta: row.eta?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    ...privacy,
  };
}

async function findPassenger(code: string) {
  const [row] = await db.select().from(liveTripsTable)
    .where(eq(liveTripsTable.passengerPairingCode, code)).limit(1);
  return row ?? null;
}

router.get("/passenger/public-run/:runKey", async (req, res): Promise<void> => {
  const runKey = String(req.params.runKey);
  if (!officialRunKeyPattern.test(runKey)) {
    res.status(400).json({ error: "Choose a valid published departure." });
    return;
  }
  const alias = await resolveOfficialRunAlias(runKey);
  const [row] = await db.select().from(liveTripsTable).where(and(
    inArray(liveTripsTable.officialRunKey, alias.keys),
    isNull(liveTripsTable.retiredAt),
  )).orderBy(desc(officialAssignmentPriority), desc(liveTripsTable.updatedAt)).limit(1);
  if (!row) {
    res.json({ assigned: false, coachNumber: null, trip: null });
    return;
  }
  const publicRow = alias.physicalDepartureAt
    ? { ...row, scheduledDepartureAt: alias.physicalDepartureAt }
    : row;
  res.json({ assigned: true, coachNumber: row.pairingCode, trip: await snapshot(publicRow) });
});

router.post("/passenger/pair", async (req, res): Promise<void> => {
  const passengerCode = typeof req.body?.passengerCode === "string" ? req.body.passengerCode.trim() : "";
  if (!/^\d{4}$/.test(passengerCode)) {
    res.status(400).json({ error: "Enter a valid four-digit passenger code." });
    return;
  }
  const row = await findPassenger(passengerCode);
  if (!row || row.retiredAt) {
    res.status(404).json({ error: "That passenger code is invalid or has expired." });
    return;
  }
  await db.update(liveTripsTable).set({ passengerLastSeenAt: new Date() })
    .where(eq(liveTripsTable.pairingCode, row.pairingCode));
  res.json({ session: { operatorPairingCode: row.pairingCode, passengerCode }, trip: await snapshot(row) });
});

router.post("/passenger/snapshot", async (req, res): Promise<void> => {
  const passengerCode = typeof req.body?.passengerCode === "string" ? req.body.passengerCode.trim() : "";
  const row = await findPassenger(passengerCode);
  if (!row || row.retiredAt) {
    res.status(404).json({ error: "That passenger session is no longer active." });
    return;
  }
  await db.update(liveTripsTable).set({ passengerLastSeenAt: new Date() })
    .where(eq(liveTripsTable.pairingCode, row.pairingCode));
  res.json({ trip: await snapshot(row) });
});

router.put("/passenger/alerts", async (req, res): Promise<void> => {
  const passengerCode = typeof req.body?.passengerCode === "string" ? req.body.passengerCode.trim() : "";
  const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId.trim() : "";
  const token = req.body?.expoPushToken;
  const selectedStopId = typeof req.body?.selectedStopId === "string" ? req.body.selectedStopId.trim() : "";
  const leadTime = req.body?.leadTime as LeadTime;
  const soundEnabled = req.body?.soundEnabled === undefined ? true : req.body.soundEnabled;
  const row = await findPassenger(passengerCode);
  if (!row || row.retiredAt || row.status !== "running") {
    res.status(409).json({ error: "Alerts require an active running trip." });
    return;
  }
  if (!deviceId || deviceId.length > 160 || !isExpoPushToken(token)
      || !LEAD_TIMES.includes(leadTime) || typeof soundEnabled !== "boolean"
      || !upcomingStopsForTrip(row).some((stop) => stop.id === selectedStopId)) {
    res.status(400).json({ error: "Choose an upcoming stop, valid lead time, sound preference, device, and Expo push token." });
    return;
  }
  const [existing] = await db.select().from(passengerAlertsTable).where(and(
    eq(passengerAlertsTable.operatorPairingCode, row.pairingCode),
    eq(passengerAlertsTable.passengerCode, passengerCode),
    eq(passengerAlertsTable.deviceId, deviceId),
  )).limit(1);
  // Idempotent restore: the app re-sends the persisted selection on every launch to make sure a
  // registration still exists. If it is the exact same stop/lead-time as an alert that already
  // left "pending" (sent, delivered, or expired), that is a relaunch replay, not a new request
  // from the passenger — leave its state alone instead of rearming a one-shot alert that already
  // fired. A genuinely new selection (different stop or lead time) still arms normally below.
  if (existing && existing.state !== "pending"
      && existing.selectedStopId === selectedStopId && existing.leadTime === leadTime) {
    res.json({
      alert: { id: existing.id, selectedStopId: existing.selectedStopId, leadTime: existing.leadTime, soundEnabled: existing.soundEnabled, state: existing.state },
    });
    return;
  }
  const values = {
    expoPushToken: token,
    selectedStopId,
    leadTime,
    soundEnabled,
    state: "pending" as const,
    deliveredAt: null,
    expiresAt: null,
    lastError: null,
    updatedAt: new Date(),
  };
  const [saved] = existing
    ? await db.update(passengerAlertsTable).set(values).where(eq(passengerAlertsTable.id, existing.id)).returning()
    : await db.insert(passengerAlertsTable).values({
      id: randomUUID(), operatorPairingCode: row.pairingCode, passengerCode, deviceId, ...values,
    }).returning();
  res.json({
    alert: { id: saved.id, selectedStopId: saved.selectedStopId, leadTime: saved.leadTime, soundEnabled: saved.soundEnabled, state: saved.state },
  });
});

router.delete("/passenger/alerts", async (req, res): Promise<void> => {
  const passengerCode = typeof req.body?.passengerCode === "string" ? req.body.passengerCode.trim() : "";
  const deviceId = typeof req.body?.deviceId === "string" ? req.body.deviceId.trim() : "";
  if (!passengerCode || !deviceId) {
    res.status(400).json({ error: "Passenger code and device are required." });
    return;
  }
  await db.delete(passengerAlertsTable).where(and(
    eq(passengerAlertsTable.passengerCode, passengerCode),
    eq(passengerAlertsTable.deviceId, deviceId),
  ));
  res.status(204).end();
});

const SENDING_LEASE_MS = 30_000;
const EXPO_PUSH_TIMEOUT_MS = 8_000;

export async function reclaimStalePassengerAlerts(operatorPairingCode: string) {
  const staleBefore = new Date(Date.now() - SENDING_LEASE_MS);
  const stale = await db.select().from(passengerAlertsTable).where(and(
    eq(passengerAlertsTable.operatorPairingCode, operatorPairingCode),
    eq(passengerAlertsTable.state, "sending"),
  ));
  const staleIds = stale.filter((alert) => alert.updatedAt.getTime() <= staleBefore.getTime()).map((alert) => alert.id);
  if (staleIds.length) await db.update(passengerAlertsTable)
    .set({ state: "pending", lastError: "Delivery attempt timed out and was requeued", updatedAt: new Date() })
    .where(inArray(passengerAlertsTable.id, staleIds));
  return staleIds.length;
}

export async function expirePassengerAlerts(operatorPairingCode: string, row: LiveTripRow) {
  const alerts = await db.select().from(passengerAlertsTable).where(and(
    eq(passengerAlertsTable.operatorPairingCode, operatorPairingCode),
    inArray(passengerAlertsTable.state, ["pending", "sending"]),
  ));
  const expired = alerts.filter((alert) => alertHasExpired(row, alert));
  if (expired.length) await db.update(passengerAlertsTable)
    .set({ state: "expired", expiresAt: new Date(), updatedAt: new Date() })
    .where(and(
      inArray(passengerAlertsTable.id, expired.map((alert) => alert.id)),
      inArray(passengerAlertsTable.state, ["pending", "sending"]),
    ));
  return expired.length;
}

const messages: Record<PassengerLanguage, (stop: string) => string> = {
  en: (stop) => `Approaching ${stop}`,
  yi: (stop) => `מ׳קומט צו ${stop}`,
  he: (stop) => `מתקרבים ל${stop}`,
};

export function passengerAlertPushPayload(
  alert: { expoPushToken: string; soundEnabled: boolean },
  stop: { id: string; label: string },
  language: PassengerLanguage,
) {
  return {
    to: alert.expoPushToken,
    title: messages[language](stop.label),
    body: stop.label,
    sound: alert.soundEnabled ? "default" : null,
    channelId: alert.soundEnabled ? "passenger-alerts" : "passenger-alerts-quiet",
    data: { screen: "stop-alert", stopId: stop.id },
  };
}

export async function deliverPassengerAlerts(operatorPairingCode: string, row: LiveTripRow, log: { error: (obj: unknown, message: string) => void }) {
  void refreshPassengerLiveActivitiesForTrip(row)
    .catch(() => log.error({ pairingCode: row.pairingCode }, "passenger Live Activity update failed"));
  await expirePassengerAlerts(operatorPairingCode, row);
  await expirePassengerRealtimeSubscriptions(operatorPairingCode, row);
  await reclaimStalePassengerAlerts(operatorPairingCode);
  if (locationVisibility(row) !== "live" || row.status !== "running" || row.currentLat === null || row.currentLng === null) return;
  const realtimeStops = upcomingStopsForTrip(row).map(({ id, label, eta }) => ({ id, label, eta }));
  await deliverApproachingPickupAlerts(operatorPairingCode, row, realtimeStops, log);
  await evaluateTransferRealtimeSubscriptions(operatorPairingCode, row, log);
  const alerts = await db.select().from(passengerAlertsTable).where(and(
    eq(passengerAlertsTable.operatorPairingCode, operatorPairingCode),
    eq(passengerAlertsTable.state, "pending"),
  ));
  for (const alert of alerts) {
    if (alertHasExpired(row, alert)) continue;
    const stop = upcomingStopsForTrip(row).find((candidate) => candidate.id === alert.selectedStopId);
    if (!stop) continue;
    const etaSeconds = stop.eta ? (new Date(stop.eta).getTime() - Date.now()) / 1000 : null;
    const directDistanceMiles = milesBetween(
      { lat: row.currentLat, lng: row.currentLng },
      { lat: stop.lat, lng: stop.lng },
    );
    if (!alertThresholdReached(alert, { etaSeconds, remainingDistanceMiles: directDistanceMiles })) continue;
    const [claimed] = await db.update(passengerAlertsTable).set({ state: "sending", updatedAt: new Date() })
      .where(and(eq(passengerAlertsTable.id, alert.id), eq(passengerAlertsTable.state, "pending"))).returning();
    if (!claimed) continue;
    try {
      const language = PASSENGER_LANGUAGES.includes(row.passengerLanguage as PassengerLanguage)
        ? row.passengerLanguage as PassengerLanguage : "en";
      const response = await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(passengerAlertPushPayload(alert, stop, language)),
        signal: AbortSignal.timeout(EXPO_PUSH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Expo Push API returned ${response.status}`);
      const ticket = await response.json() as { data?: { status?: string } };
      if (ticket.data?.status !== "ok") throw new Error("Expo Push ticket was not accepted");
      await db.update(passengerAlertsTable).set({ state: "delivered", deliveredAt: new Date(), updatedAt: new Date() })
        .where(and(eq(passengerAlertsTable.id, alert.id), eq(passengerAlertsTable.state, "sending")));
    } catch (error) {
      await db.update(passengerAlertsTable).set({ state: "pending", lastError: "Expo delivery failed", updatedAt: new Date() })
        .where(and(eq(passengerAlertsTable.id, alert.id), eq(passengerAlertsTable.state, "sending")));
      log.error({ err: error, alertId: alert.id }, "passenger alert delivery failed");
    }
  }
}

export default router;