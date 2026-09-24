import { createPrivateKey, createSign } from "node:crypto";
import { connect, type ClientHttp2Session } from "node:http2";
import { and, asc, eq, gt, isNull, lte, or } from "drizzle-orm";
import {
  db,
  liveTripsTable,
  passengerLiveActivitiesTable,
  type LiveTripRow,
  type PassengerLiveActivityProps,
  type PassengerLiveActivityRow,
} from "@workspace/db";
import { locationVisibility } from "./trip-privacy";
import { resolveVerifiedOfficialRun } from "../routes/schedule";
import { logger } from "./logger";

export const PASSENGER_LIVE_ACTIVITY_NAME = "PassengerTripActivity";
export const APNS_TOPIC = "app.replit.monseytrailspassenger.push-type.liveactivity";
export const APNS_BUNDLE_ID = "app.replit.monseytrailspassenger";
export const LIVE_ACTIVITY_GPS_MAX_AGE_MS = 90_000;
export const APNS_REQUEST_TIMEOUT_MS = 8_000;
export const TOKENLESS_TERMINAL_GRACE_MS = 24 * 60 * 60_000;
export const LIVE_ACTIVITY_TICK_BATCH_SIZE = 500;

export function isExpiredTokenlessTerminalActivity(
  activity: Pick<PassengerLiveActivityRow, "active" | "phase" | "pushToken" | "endedAt" | "updatedAt">,
  now = Date.now(),
) {
  const terminalAt = activity.endedAt ?? activity.updatedAt;
  return activity.active
    && activity.phase === "ended"
    && activity.pushToken === null
    && now - terminalAt.getTime() >= TOKENLESS_TERMINAL_GRACE_MS;
}

export async function processPassengerLiveActivityBatches<T extends { id: string }>(
  loadBatch: (afterId: string | null, limit: number) => Promise<T[]>,
  processBatch: (batch: T[]) => Promise<void>,
) {
  let afterId: string | null = null;
  let processed = 0;
  while (true) {
    const batch = await loadBatch(afterId, LIVE_ACTIVITY_TICK_BATCH_SIZE);
    if (batch.length === 0) break;
    await processBatch(batch);
    processed += batch.length;
    afterId = batch[batch.length - 1]!.id;
    if (batch.length < LIVE_ACTIVITY_TICK_BATCH_SIZE) break;
  }
  return processed;
}

export function isLiveActivityPushToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Fa-f0-9]{64,200}$/.test(value);
}

function normalizeApnsPrivateKey(value: string) {
  const text = value.replace(/\\n/g, "\n").trim();
  const match = text.match(/^-----BEGIN PRIVATE KEY-----([\sA-Za-z0-9+/=]+)-----END PRIVATE KEY-----$/);
  if (!match) return text;
  const body = match[1].replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return text;
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----`;
}

export function apnsConfigurationAvailable(env: NodeJS.ProcessEnv = process.env) {
  if (!env.APNS_TEAM_ID?.trim() || !env.APNS_KEY_ID?.trim() || !env.APNS_PRIVATE_KEY?.trim()
      || (env.APNS_BUNDLE_ID && env.APNS_BUNDLE_ID !== APNS_BUNDLE_ID)
      || APNS_TOPIC !== `${APNS_BUNDLE_ID}.push-type.liveactivity`
      || (env.APNS_ENVIRONMENT !== "production" && env.APNS_ENVIRONMENT !== "sandbox")) return false;
  try {
    const key = createPrivateKey(normalizeApnsPrivateKey(env.APNS_PRIVATE_KEY));
    return key.asymmetricKeyType === "ec"
      && key.asymmetricKeyDetails?.namedCurve === "prime256v1";
  } catch {
    return false;
  }
}

function apnsHost() {
  return process.env.APNS_ENVIRONMENT === "production"
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";
}

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function createApnsJwt() {
  const teamId = process.env.APNS_TEAM_ID!.trim();
  const keyId = process.env.APNS_KEY_ID!.trim();
  const privateKey = normalizeApnsPrivateKey(process.env.APNS_PRIVATE_KEY!);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
  const unsigned = `${header}.${claims}`;
  const signer = createSign("SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `${unsigned}.${signature}`;
}

type ApnsEvent = "update" | "end";

export function buildApnsLiveActivityPayload(
  props: PassengerLiveActivityProps,
  now = Date.now(),
  event: ApnsEvent = props.phase === "ended" ? "end" : "update",
) {
  const timestamp = Math.floor(now / 1000);
  return {
    aps: {
      timestamp,
      event,
      "content-state": {
        name: PASSENGER_LIVE_ACTIVITY_NAME,
        props: JSON.stringify(props),
      },
      "stale-date": timestamp + 90,
    },
  };
}

function sendHttp2Request(
  session: ClientHttp2Session,
  path: string,
  payload: unknown,
) {
  return new Promise<{ status: number; reason: string }>((resolve, reject) => {
    const request = session.request({
      ":method": "POST",
      ":path": path,
      authorization: `bearer ${createApnsJwt()}`,
      "apns-topic": APNS_TOPIC,
      "apns-push-type": "liveactivity",
      "apns-priority": "10",
      "content-type": "application/json",
    });
    let responseStatus = 0;
    let responseBody = "";
    request.on("response", headers => {
      responseStatus = Number(headers[":status"] ?? 0);
    });
    request.setEncoding("utf8");
    request.on("data", chunk => { responseBody += chunk; });
    request.on("error", reject);
    request.setTimeout(APNS_REQUEST_TIMEOUT_MS, () => {
      request.close();
      reject(new Error("APNs request timed out"));
    });
    request.on("end", () => {
      let reason = "";
      try {
        reason = (JSON.parse(responseBody) as { reason?: string }).reason ?? "";
      } catch {
        // APNs may return an empty body for successful requests.
      }
      resolve({ status: responseStatus, reason });
    });
    request.end(JSON.stringify(payload));
  });
}

async function sendApns(
  token: string,
  props: PassengerLiveActivityProps,
  event?: ApnsEvent,
) {
  if (!apnsConfigurationAvailable()) throw new Error("APNs is not configured for the required bundle.");
  const session = connect(apnsHost());
  session.on("error", () => {
    // Request errors surface on the stream; a session-level listener prevents
    // transient socket errors from escaping as unhandled events.
  });
  try {
    const result = await sendHttp2Request(
      session,
      `/3/device/${token}`,
      buildApnsLiveActivityPayload(props, Date.now(), event),
    );
    if (result.status < 200 || result.status >= 300) {
      const invalidToken = result.status === 410 || result.reason === "BadDeviceToken"
        || result.reason === "Unregistered";
      throw Object.assign(new Error(`APNs returned ${result.status}${result.reason ? ` (${result.reason})` : ""}`), {
        invalidToken,
      });
    }
  } finally {
    session.close();
  }
}

export function liveActivityPropsForTrip(
  activity: Pick<PassengerLiveActivityRow,
    "pickupStopId" | "dropoffStopId" | "pickupStopName" | "dropoffStopName" | "dropoffStopLat"
      | "dropoffStopLng" | "lineName" | "coachNumber">,
  trip: LiveTripRow,
  now = Date.now(),
): PassengerLiveActivityProps {
  const stops = trip.intermediateStops;
  const pickupStillUpcoming = stops.some(stop => stop.id === activity.pickupStopId);
  const dropoffIsDestination = trip.destinationLat !== null && trip.destinationLng !== null
    && Math.abs(trip.destinationLat - activity.dropoffStopLat) < 0.00002
    && Math.abs(trip.destinationLng - activity.dropoffStopLng) < 0.00002;
  const dropoffStillUpcoming = stops.some(stop => stop.id === activity.dropoffStopId) || dropoffIsDestination;
  const phase: PassengerLiveActivityProps["phase"] = trip.retiredAt || trip.completedAt
      || trip.status === "stopped" || !dropoffStillUpcoming
    ? "ended"
    : pickupStillUpcoming ? "pickup" : "onboard";
  const stopId = phase === "pickup" ? activity.pickupStopId : activity.dropoffStopId;
  const stopName = phase === "pickup" ? activity.pickupStopName : activity.dropoffStopName;
  const stop = stops.find(item => item.id === stopId);
  const gpsIsFresh = locationVisibility(trip, now) === "live"
    && trip.locationUpdatedAt !== null
    && now - trip.locationUpdatedAt.getTime() <= LIVE_ACTIVITY_GPS_MAX_AGE_MS
    && now >= trip.locationUpdatedAt.getTime();
  const stopEta = stop?.eta
    ? new Date(stop.eta).getTime()
    : phase === "onboard" && dropoffIsDestination && trip.eta
      ? trip.eta.getTime()
      : NaN;
  const etaIsFresh = gpsIsFresh && Number.isFinite(stopEta) && stopEta >= now - 30_000;
  const phaseWhenUnavailable = phase === "ended" ? "ended" : "unavailable";
  const propsPhase = gpsIsFresh ? phase : phaseWhenUnavailable;
  let etaLabel = "ETA unavailable";
  if (propsPhase === "ended") etaLabel = "Trip ended";
  else if (etaIsFresh) {
    const minutes = Math.max(0, Math.ceil((stopEta - now) / 60_000));
    etaLabel = minutes === 0 ? "Arriving now" : `${minutes} min`;
  }
  const tripStatus = phase === "ended" ? "Trip ended"
    : propsPhase === "unavailable" ? "Live location unavailable"
      : phase === "pickup" ? "Heading to pickup" : "On the way";
  return {
    phase: propsPhase,
    lineName: activity.lineName,
    stopName: phase === "ended" ? activity.dropoffStopName : stopName,
    etaLabel,
    coachNumber: activity.coachNumber,
    status: tripStatus,
    updatedAt: new Date(now).toISOString(),
  };
}

export function verifiedLiveActivityStops<T extends { id: string; kind: "pickup" | "dropoff" }>(
  stops: T[],
  pickupStopId: string,
  dropoffStopId: string,
) {
  const pickupIndex = stops.findIndex(stop => stop.id === pickupStopId && stop.kind === "pickup");
  const dropoffIndex = stops.findIndex(stop => stop.id === dropoffStopId && stop.kind === "dropoff");
  return pickupIndex >= 0 && dropoffIndex > pickupIndex
    ? { pickup: stops[pickupIndex], dropoff: stops[dropoffIndex] }
    : null;
}

async function sendActivityNow(activity: PassengerLiveActivityRow, props: PassengerLiveActivityProps) {
  const [current] = await db.select().from(passengerLiveActivitiesTable).where(and(
    eq(passengerLiveActivitiesTable.id, activity.id),
    eq(passengerLiveActivitiesTable.active, true),
  )).limit(1);
  if (!current) return false;
  activity = current;
  if (activity.phase === "ended" && props.phase !== "ended") {
    props = activity.lastProps ?? {
      phase: "ended",
      lineName: activity.lineName,
      stopName: activity.dropoffStopName,
      etaLabel: "Trip ended",
      coachNumber: activity.coachNumber,
      status: "Trip ended",
      updatedAt: new Date().toISOString(),
    };
  }
  if (!activity.pushToken) {
    const now = new Date();
    await db.update(passengerLiveActivitiesTable).set(props.phase === "ended"
      ? {
        lastProps: props,
        phase: "ended",
        endedAt: activity.endedAt ?? (activity.phase === "ended" ? activity.updatedAt : now),
        ...(activity.phase === "ended" ? {} : { updatedAt: now }),
      }
      : { phase: props.phase, updatedAt: now })
      .where(eq(passengerLiveActivitiesTable.id, activity.id));
    return false;
  }
  const event = props.phase === "ended" ? "end" : "update";
  if (event === "end") {
    const now = new Date();
    await db.update(passengerLiveActivitiesTable).set({
      lastProps: props,
      phase: "ended",
      endedAt: activity.endedAt ?? (activity.phase === "ended" ? activity.updatedAt : now),
      updatedAt: now,
    }).where(eq(passengerLiveActivitiesTable.id, activity.id));
  }
  try {
    await sendApns(activity.pushToken, props, event);
    await db.update(passengerLiveActivitiesTable).set({
      lastProps: props, lastSentAt: new Date(), phase: props.phase, updatedAt: new Date(),
    }).where(eq(passengerLiveActivitiesTable.id, activity.id));
    if (event === "end") {
      await db.update(passengerLiveActivitiesTable).set({ active: false, updatedAt: new Date() })
        .where(eq(passengerLiveActivitiesTable.id, activity.id));
    }
    return true;
  } catch (error) {
    const invalidToken = Boolean((error as { invalidToken?: boolean }).invalidToken);
    if (invalidToken) {
      await db.update(passengerLiveActivitiesTable).set({
        pushToken: null, active: props.phase === "ended" ? false : activity.active, updatedAt: new Date(),
      }).where(and(
        eq(passengerLiveActivitiesTable.id, activity.id),
        eq(passengerLiveActivitiesTable.pushToken, activity.pushToken),
      ));
    }
    // Never include APNs tokens, JWTs, or key material in logs.
    logger.warn({ activityId: activity.id, invalidToken }, "passenger Live Activity APNs delivery failed");
    return false;
  }
}

const activitySendTails = new Map<string, Promise<boolean>>();
function sendActivity(activity: PassengerLiveActivityRow, props: PassengerLiveActivityProps) {
  const prior = activitySendTails.get(activity.id) ?? Promise.resolve(false);
  const task = prior.catch(() => false).then(() => sendActivityNow(activity, props));
  activitySendTails.set(activity.id, task);
  void task.then(
    () => { if (activitySendTails.get(activity.id) === task) activitySendTails.delete(activity.id); },
    () => { if (activitySendTails.get(activity.id) === task) activitySendTails.delete(activity.id); },
  );
  return task;
}

async function activeBoundTrip(activity: PassengerLiveActivityRow) {
  const [trip] = await db.select().from(liveTripsTable).where(and(
    eq(liveTripsTable.pairingCode, activity.operatorPairingCode),
    eq(liveTripsTable.passengerPairingCode, activity.passengerCode),
    eq(liveTripsTable.officialRunKey, activity.officialRunKey),
    isNull(liveTripsTable.retiredAt),
  )).limit(1);
  return trip ?? null;
}

export async function refreshPassengerLiveActivitiesForTrip(
  trip: LiveTripRow
) {
  const activities = await db.select().from(passengerLiveActivitiesTable).where(and(
    eq(passengerLiveActivitiesTable.operatorPairingCode, trip.pairingCode),
    eq(passengerLiveActivitiesTable.active, true),
  ));
  await Promise.all(activities.map(async activity => {
    const [latestActivity] = await db.select().from(passengerLiveActivitiesTable).where(and(
      eq(passengerLiveActivitiesTable.id, activity.id),
      eq(passengerLiveActivitiesTable.active, true),
    )).limit(1);
    if (!latestActivity) return;
    if (latestActivity.phase === "ended" && !latestActivity.pushToken) return;
    if (latestActivity.phase === "ended") {
      const props = latestActivity.lastProps ?? {
        phase: "ended" as const,
        lineName: latestActivity.lineName,
        stopName: latestActivity.dropoffStopName,
        etaLabel: "Trip ended",
        coachNumber: latestActivity.coachNumber,
        status: "Trip ended",
        updatedAt: new Date().toISOString(),
      };
      await sendActivity(latestActivity, { ...props, phase: "ended", etaLabel: "Trip ended", status: "Trip ended", updatedAt: new Date().toISOString() });
      return;
    }
    const currentlyBoundTrip = await activeBoundTrip(latestActivity);
    if (!currentlyBoundTrip || trip.retiredAt || trip.passengerPairingCode !== latestActivity.passengerCode
        || trip.officialRunKey !== latestActivity.officialRunKey) {
      // End using the last safe state: do not reveal a later passenger's route.
      const props = latestActivity.lastProps ?? {
        phase: "ended" as const,
        lineName: latestActivity.lineName,
        stopName: latestActivity.dropoffStopName,
        etaLabel: "Trip ended",
        coachNumber: latestActivity.coachNumber,
        status: "Trip ended",
        updatedAt: new Date().toISOString(),
      };
      await sendActivity(latestActivity, { ...props, phase: "ended", etaLabel: "Trip ended", status: "Trip ended", updatedAt: new Date().toISOString() });
      return;
    }
    const props = liveActivityPropsForTrip(latestActivity, currentlyBoundTrip);
    const previous = latestActivity.lastProps;
    if (previous && JSON.stringify(previous) === JSON.stringify(props)) return;
    await sendActivity(latestActivity, props);
  }));
}

export async function endPassengerLiveActivitiesForTrip(pairingCode: string) {
  const activities = await db.select().from(passengerLiveActivitiesTable).where(and(
    eq(passengerLiveActivitiesTable.operatorPairingCode, pairingCode),
    eq(passengerLiveActivitiesTable.active, true),
  ));
  await Promise.all(activities.map(activity => {
    const previous = activity.lastProps;
    const props: PassengerLiveActivityProps = {
      phase: "ended",
      lineName: activity.lineName,
      stopName: activity.dropoffStopName,
      etaLabel: "Trip ended",
      coachNumber: activity.coachNumber,
      status: "Trip ended",
      updatedAt: new Date().toISOString(),
    };
    return sendActivity(activity, previous ? { ...props, updatedAt: new Date().toISOString() } : props);
  }));
}

export async function endPassengerLiveActivityById(id: string) {
  const [activity] = await db.select().from(passengerLiveActivitiesTable).where(and(
    eq(passengerLiveActivitiesTable.id, id),
    eq(passengerLiveActivitiesTable.active, true),
  )).limit(1);
  if (!activity) return false;
  const props: PassengerLiveActivityProps = {
    phase: "ended",
    lineName: activity.lineName,
    stopName: activity.dropoffStopName,
    etaLabel: "Trip ended",
    coachNumber: activity.coachNumber,
    status: "Trip ended",
    updatedAt: new Date().toISOString(),
  };
  await db.update(passengerLiveActivitiesTable).set({
    phase: "ended",
    lastProps: props,
    endedAt: activity.endedAt ?? (activity.phase === "ended" ? activity.updatedAt : new Date()),
    updatedAt: activity.phase === "ended" ? activity.updatedAt : new Date(),
  }).where(eq(passengerLiveActivitiesTable.id, activity.id));
  await sendActivity(activity, props);
  return true;
}

export async function cleanupExpiredTokenlessTerminalLiveActivities(now = Date.now()) {
  const expiredBefore = new Date(now - TOKENLESS_TERMINAL_GRACE_MS);
  const cleaned = await db.update(passengerLiveActivitiesTable).set({
    active: false,
    updatedAt: new Date(now),
  }).where(and(
    eq(passengerLiveActivitiesTable.active, true),
    eq(passengerLiveActivitiesTable.phase, "ended"),
    isNull(passengerLiveActivitiesTable.pushToken),
    or(
      lte(passengerLiveActivitiesTable.endedAt, expiredBefore),
      and(isNull(passengerLiveActivitiesTable.endedAt), lte(passengerLiveActivitiesTable.updatedAt, expiredBefore)),
    ),
  )).returning({ id: passengerLiveActivitiesTable.id });
  return cleaned.length;
}

export async function processPassengerLiveActivityTick() {
  await cleanupExpiredTokenlessTerminalLiveActivities();
  const processedTrips = new Set<string>();
  await processPassengerLiveActivityBatches(
    async (afterId, limit) => db.select().from(passengerLiveActivitiesTable)
      .where(afterId
        ? and(eq(passengerLiveActivitiesTable.active, true), gt(passengerLiveActivitiesTable.id, afterId))
        : eq(passengerLiveActivitiesTable.active, true))
      .orderBy(asc(passengerLiveActivitiesTable.id))
      .limit(limit),
    async batch => {
      const pairingCodes = [...new Set(batch.map(activity => activity.operatorPairingCode))]
        .filter(pairingCode => !processedTrips.has(pairingCode));
      await Promise.all(pairingCodes.map(async pairingCode => {
        processedTrips.add(pairingCode);
        const [trip] = await db.select().from(liveTripsTable)
          .where(eq(liveTripsTable.pairingCode, pairingCode)).limit(1);
        if (trip) await refreshPassengerLiveActivitiesForTrip(trip);
        else await endPassengerLiveActivitiesForTrip(pairingCode);
      }));
    },
  );
}

let liveActivityScheduler: ReturnType<typeof setInterval> | null = null;
export function startPassengerLiveActivityScheduler() {
  if (liveActivityScheduler || process.env.NODE_ENV === "test") return;
  liveActivityScheduler = setInterval(() => {
    void processPassengerLiveActivityTick().catch(() => {
      logger.warn("passenger Live Activity retry tick failed");
    });
  }, 60_000);
  liveActivityScheduler.unref();
}

export async function validateLiveActivityRun(
  passengerCode: string,
  runKey: string,
  pickupStopId: string,
  dropoffStopId: string,
) {
  const [trip] = await db.select().from(liveTripsTable).where(and(
    eq(liveTripsTable.passengerPairingCode, passengerCode),
    isNull(liveTripsTable.retiredAt),
  )).limit(1);
  if (!trip || trip.status !== "running" || trip.completedAt || !trip.officialRunKey
      || trip.officialRunKey !== runKey) {
    return { error: "Live Activities require the active passenger code on its exact running published trip." } as const;
  }
  const split = runKey.split("|");
  if (split.length !== 5 || !/^\d{4}-\d{2}-\d{2}$/.test(split[0])
      || !/^[123]$/.test(split[1]) || !/^\d+$/.test(split[2]) || !/^\d+$/.test(split[3])) {
    return { error: "Choose the exact published run assigned to this trip." } as const;
  }
  const official = await resolveVerifiedOfficialRun({
    date: split[0], line: Number(split[1]), origin: Number(split[2]), destination: Number(split[3]),
  }, split[4]);
  const stops = verifiedLiveActivityStops(official.stops, pickupStopId, dropoffStopId);
  if (!stops) {
    return { error: "Select the exact verified pickup and a later verified dropoff on this run." } as const;
  }
  const dropoffUpcoming = trip.intermediateStops.some(stop => stop.id === stops.dropoff.id)
    || (trip.destinationLat !== null && trip.destinationLng !== null
      && Math.abs(trip.destinationLat - stops.dropoff.lat) < 0.00002
      && Math.abs(trip.destinationLng - stops.dropoff.lng) < 0.00002);
  if (!dropoffUpcoming) {
    return { error: "The selected dropoff is no longer upcoming on this trip." } as const;
  }
  return { trip, official, pickup: stops.pickup, dropoff: stops.dropoff } as const;
}