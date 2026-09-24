import { Router, type IRouter } from "express";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import webPush from "web-push";
import { adminDisplayReceiptsTable, adminDisplaySettingsTable, db, liveTripsTable, pushSubscriptionsTable, pushVapidKeysTable, type AdminDisplaySlide, type LiveTripRow, type StoredAnnouncement, type StoredTripStop } from "@workspace/db";
import { and, desc, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { AsyncLocalStorage } from "node:async_hooks";
import { requireDriverProfile } from "./driver-profile";
import { resolveOfficialAssignment, resolveOfficialRunAlias } from "./schedule";
import { isPassengerAccess, locationVisibility, ownsTrip, passengerLocationFields, type LocationVisibility } from "../lib/trip-privacy";
import { officialAssignmentPriority } from "../lib/official-run-assignment";
import { deliverPassengerAlerts, expirePassengerAlerts } from "./passenger-alerts";
import { isSupportedPushEndpoint } from "./push-endpoint";
import { formatPassengerStopLabel } from "@workspace/passenger-stop-label";
import { finishActiveDispatchAssignment } from "../lib/dispatch-history";
import { activeServiceDisruptions, type PublicServiceDisruption } from "../lib/service-disruptions";
import { repairMissingWesternLongitude } from "../lib/route-coordinates";
import { fetchTrafficAwareRoute } from "../lib/traffic-routing";
import { revokePassengerRealtimeSubscriptions } from "../lib/passenger-realtime";
import {
  endPassengerLiveActivitiesForTrip,
  refreshPassengerLiveActivitiesForTrip,
} from "../lib/passenger-live-activities";
import { logger } from "../lib/logger";

type Coordinates = { lat: number; lng: number };
type OverpassElement =
  | { type: "node"; id: number; lat: number; lon: number }
  | { type: "way"; id: number; nodes?: number[]; tags?: { highway?: string; name?: string } };
type TripStatus = "idle" | "ready" | "running" | "stopped";
type DisplayMode = "auto" | "welcome" | "map" | "next-stop" | "weather" | "traffic" | "daf" | "jewish-calendar" | "announcements" | "destinations-info" | "fares-info" | "passenger-guide" | "contact-info" | "charging-amenities" | "safety";
type PassengerLanguage = "en" | "yi" | "he";

interface TripState {
  status: TripStatus;
  destinationAddress: string;
  destination: Coordinates | null;
  destinationNote?: string;
  intermediateStops: StoredTripStop[];
  routeGeometry: Coordinates[];
  origin: Coordinates | null;
  currentLocation: Coordinates | null;
  totalDistanceMiles: number | null;
  remainingDistanceMiles: number | null;
  eta: string | null;
  speedMph: number | null;
  startedAt: string | null;
  emergencyOverride: boolean;
  emergencyMessage: string;
  routeId: string;
  displayMode: DisplayMode;
  passengerLanguage: PassengerLanguage;
  rotationIntervalSeconds: number;
  arrivalSoundsEnabled: boolean;
  announcements: StoredAnnouncement[];
  displaySettingsVersion?: number;
  enabledSlides?: AdminDisplaySlide[];
  chimeTestRequestedAt: string | null;
  passengerDisplays: PassengerDisplayStatus[];
  officialRunKey: string | null;
  scheduledDepartureAt: string | null;
  locationUpdatedAt: string | null;
  locationVisibility: LocationVisibility;
  updatedAt: string;
  disruptions?: PublicServiceDisruption[];
}

interface PassengerDisplayStatus {
  id: string;
  audioReady: boolean;
}

type PolledTripState = Omit<TripState, "routeGeometry"> & {
  routeGeometry?: Coordinates[];
};

const router: IRouter = Router();
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
const BUS_NUMBER_PATTERN = /^[A-Z0-9]{1,6}$/;
// Duplicate upstream run IDs are qualified with their departure time
// (for example, 225~21:30:00). Keep the final segment pipe-free while
// accepting those canonical schedule identities.
const OFFICIAL_RUN_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}\|\d+\|\d+\|\d+\|[^|]{1,80}$/;
const ROUTE_IDS = new Set(["route-1", "route-2", "route-3", "route-4", "route-5", "route-6"]);
const DISPLAY_MODES = new Set<DisplayMode>(["auto", "welcome", "map", "next-stop", "weather", "traffic", "daf", "jewish-calendar", "announcements", "destinations-info", "fares-info", "passenger-guide", "contact-info", "charging-amenities", "safety"]);
const PASSENGER_LANGUAGES = new Set<PassengerLanguage>(["en", "yi", "he"]);
const RETIRED_TRIP_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const PASSENGER_CONNECTED_WINDOW_MS = 10_000;
const PASSENGER_HEARTBEAT_TTL_MS = 12_000;
const QR_INVITE_TTL_MS = 10 * 60 * 1_000;
type PassengerDisplaySession = PassengerDisplayStatus & {
  lastSeenAt: number;
  sessionTokenHash: Buffer;
  pairingGeneration: string;
  sessionGeneration: string;
};
const passengerHeartbeats = new Map<string, Map<string, PassengerDisplaySession>>();
const PASSENGER_ROAD_CLASSES = new Set([
  "residential",
  "living_street",
  "unclassified",
  "tertiary",
  "secondary",
  "primary",
  "trunk",
]);

// Carry authorization through asynchronous routing work; conditional writes reject stale
// updates after logout, ownership transfer, stop advancement, or a newer GPS update.
const operatorContext = new AsyncLocalStorage<{ subject: string; version: Date }>();

async function removeExpiredRetiredTrips() {
  const cutoff = new Date(Date.now() - RETIRED_TRIP_RETENTION_MS);
  await db.delete(liveTripsTable).where(lt(liveTripsTable.retiredAt, cutoff));
}

function validCoordinate(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function distanceMiles(first: Coordinates, second: Coordinates) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const lat = radians(second.lat - first.lat);
  const lng = radians(second.lng - first.lng);
  const a = Math.sin(lat / 2) ** 2
    + Math.cos(radians(first.lat)) * Math.cos(radians(second.lat)) * Math.sin(lng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function currentStopAlert(row: LiveTripRow) {
  if (row.status !== "running" || row.currentLat === null || row.currentLng === null) return null;
  const stop = row.intermediateStops[0];
  const destination = stop
    ? { lat: stop.lat, lng: stop.lng }
    : row.destinationLat !== null && row.destinationLng !== null
      ? { lat: row.destinationLat, lng: row.destinationLng }
      : null;
  if (!destination) return null;
  const eta = stop?.eta ? new Date(stop.eta).getTime() : row.eta?.getTime();
  const isApproaching = distanceMiles(
    { lat: row.currentLat, lng: row.currentLng },
    destination,
  ) <= 0.5 || (eta !== undefined && eta >= Date.now() && eta - Date.now() <= 120_000);
  if (!isApproaching) return null;
  return stop
    ? { key: `stop:${stop.id}`, label: stop.address }
    : { key: `destination:${row.destinationLat}:${row.destinationLng}`, label: row.destinationAddress };
}

async function getVapidKeys() {
  const [existing] = await db.select().from(pushVapidKeysTable)
    .where(eq(pushVapidKeysTable.id, "default")).limit(1);
  if (existing) return existing;
  const generated = webPush.generateVAPIDKeys();
  const [created] = await db.insert(pushVapidKeysTable).values({
    id: "default",
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
  }).onConflictDoNothing().returning();
  if (created) return created;
  const [concurrent] = await db.select().from(pushVapidKeysTable)
    .where(eq(pushVapidKeysTable.id, "default")).limit(1);
  if (!concurrent) throw new Error("Could not initialize push notifications.");
  return concurrent;
}

async function sendApproachingStopAlerts(row: LiveTripRow) {
  if (locationVisibility(row) !== "live") return;
  const alert = currentStopAlert(row);
  if (!alert || row.lastPushNotifiedStopKey === `${row.startedAt?.toISOString()}:${alert.key}`) return;
  const subscriptions = await db.select().from(pushSubscriptionsTable).where(and(
    eq(pushSubscriptionsTable.pairingCode, row.pairingCode),
    eq(pushSubscriptionsTable.stopKey, alert.key),
  ));
  const notifiedKey = `${row.startedAt?.toISOString()}:${alert.key}`;
  if (subscriptions.length === 0) return;
  const vapid = await getVapidKeys();
  webPush.setVapidDetails("https://monseytrails.com", vapid.publicKey, vapid.privateKey);
  const payload = JSON.stringify({
    title: "Your stop is approaching",
    body: `${alert.label} is about 2 minutes away.`,
    tag: notifiedKey,
    url: "/",
  });
  const results = await Promise.allSettled(subscriptions.map(async (subscription) => {
    try {
      await webPush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload, { TTL: 300, urgency: "high" });
      return true;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, subscription.id));
        return false;
      }
      throw error;
    }
  }));
  if (results.some((result) => result.status === "fulfilled" && result.value)) {
    await updateTrip(row.pairingCode, { lastPushNotifiedStopKey: notifiedKey });
  }
}

function normalizeBusNumber(value: string) {
  return value.trim().toUpperCase();
}

function rowToTrip(row: LiveTripRow): TripState {
  const coordinates = (lat: number | null, lng: number | null) =>
    lat === null || lng === null ? null : { lat, lng };
  return {
    status: row.status as TripStatus,
    destinationAddress: row.destinationAddress,
    destination: coordinates(row.destinationLat, row.destinationLng),
    intermediateStops: row.intermediateStops,
    routeGeometry: row.routeGeometry,
    origin: coordinates(row.originLat, row.originLng),
    currentLocation: coordinates(row.currentLat, row.currentLng),
    totalDistanceMiles: row.totalDistanceMiles,
    remainingDistanceMiles: row.remainingDistanceMiles,
    eta: row.eta?.toISOString() ?? null,
    speedMph: row.speedMph,
    startedAt: row.startedAt?.toISOString() ?? null,
    emergencyOverride: row.emergencyOverride,
    emergencyMessage: row.emergencyMessage,
    routeId: row.routeId,
    displayMode: row.displayMode as DisplayMode,
    passengerLanguage: row.passengerLanguage as PassengerLanguage,
    rotationIntervalSeconds: row.rotationIntervalSeconds,
    arrivalSoundsEnabled: row.arrivalSoundsEnabled,
    announcements: row.announcements,
    chimeTestRequestedAt: row.chimeTestRequestedAt?.toISOString() ?? null,
    passengerDisplays: activePassengerDisplays(row.pairingCode),
    officialRunKey: row.officialRunKey,
    scheduledDepartureAt: row.scheduledDepartureAt?.toISOString() ?? null,
    locationUpdatedAt: row.locationUpdatedAt?.toISOString() ?? null,
    locationVisibility: locationVisibility(row),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function rowToPassengerTrip(row: LiveTripRow): TripState {
  const trip = rowToTrip(row);
  const fields = passengerLocationFields(row);
  const passengerStops = trip.intermediateStops.map(stop => ({
    ...stop,
    address: formatPassengerStopLabel(stop.address),
  }));
  return {
    ...trip, ...fields,
    destinationAddress: formatPassengerStopLabel(trip.destinationAddress),
    // Origin is the driver's initial GPS, not the published first stop.
    origin: null,
    destination: row.officialRunKey && row.scheduledDepartureAt ? trip.destination : null,
    intermediateStops: !row.officialRunKey || !row.scheduledDepartureAt ? []
      : fields.locationVisibility === "live" ? passengerStops
        : passengerStops.map(({ eta: _eta, ...stop }) => stop),
  };
}

function sameOfficialPoint(
  stored: { id: string; lat: number; lng: number },
  official: { id: string; lat: number; lng: number },
) {
  return stored.id === official.id
    && Math.abs(stored.lat - official.lat) < 0.000001
    && Math.abs(stored.lng - official.lng) < 0.000001;
}

export function applyOfficialStopNotes<
  T extends { id: string; lat: number; lng: number; note?: string },
  O extends { id: string; lat: number; lng: number; note?: string },
>(stops: T[], officialStops: O[]): Array<T & { note?: string }> {
  return stops.map(stop => {
    const source = officialStops.find(candidate => sameOfficialPoint(stop, candidate));
    return source?.note ? { ...stop, note: source.note } : stop;
  });
}

export async function rowToPassengerTripWithOfficialNotes(row: LiveTripRow): Promise<TripState> {
  const trip = rowToPassengerTrip(row);
  if (!row.officialRunKey || !row.scheduledDepartureAt) return trip;
  const disruptions = await activeServiceDisruptions(row.officialRunKey, new Date(), row.pairingCode);
  try {
    const official = await resolveOfficialAssignment(row.officialRunKey);
    const intermediateStops = applyOfficialStopNotes(trip.intermediateStops, official.intermediateStops);
    const destinationNote = trip.destination
      && sameOfficialPoint(
        { id: official.destination.id, ...trip.destination },
        official.destination,
      )
      ? official.destination.note : undefined;
    return {
      ...trip,
      disruptions,
      intermediateStops,
      ...(destinationNote ? { destinationNote } : {}),
    };
  } catch {
    // Tracking remains available if the authoritative schedule is temporarily unavailable.
    return { ...trip, disruptions };
  }
}

export function activePassengerDisplays(code: string, now = Date.now()) {
  const displays = passengerHeartbeats.get(code);
  if (!displays) return [];
  for (const [id, display] of displays) {
    if (now - display.lastSeenAt > PASSENGER_HEARTBEAT_TTL_MS) displays.delete(id);
  }
  if (displays.size === 0) passengerHeartbeats.delete(code);
  return Array.from(displays.values(), ({ id, audioReady }) => ({ id, audioReady }));
}

export function recordPassengerStatus(code: string, id: string, audioReady: boolean, lastSeenAt = Date.now()) {
  const displays = passengerHeartbeats.get(code) ?? new Map();
  const existing = displays.get(id);
  displays.set(id, existing
    ? { ...existing, audioReady, lastSeenAt }
    : {
      id,
      audioReady,
      lastSeenAt,
      sessionTokenHash: Buffer.alloc(32),
      pairingGeneration: "",
      sessionGeneration: "",
    });
  passengerHeartbeats.set(code, displays);
}

export function activePassengerDisplaySessionGeneration(code: string, id: string) {
  const session = passengerHeartbeats.get(code)?.get(id);
  return session && Date.now() - session.lastSeenAt <= PASSENGER_HEARTBEAT_TTL_MS
    ? session.sessionGeneration
    : null;
}

function pairingGeneration(pairingCode: string) {
  return createHash("sha256").update(`passenger-pairing:${pairingCode}`).digest("hex");
}

function passengerSessionTokenHash(token: string) {
  return createHash("sha256").update(`passenger-display-session:${token}`).digest();
}

function secureTokenMatches(actual: Buffer, supplied: string) {
  const candidate = passengerSessionTokenHash(supplied);
  return actual.length === candidate.length && timingSafeEqual(actual, candidate);
}

function registerPassengerDisplay(
  code: string,
  pairingCode: string,
  id: string,
  audioReady: boolean,
  suppliedToken: string,
) {
  const generation = pairingGeneration(pairingCode);
  const displays = passengerHeartbeats.get(code) ?? new Map<string, PassengerDisplaySession>();
  const existing = displays.get(id);
  const activeExisting = existing && Date.now() - existing.lastSeenAt <= PASSENGER_HEARTBEAT_TTL_MS
    ? existing
    : null;
  if (activeExisting && (
    activeExisting.pairingGeneration !== generation
    || !suppliedToken
    || !secureTokenMatches(activeExisting.sessionTokenHash, suppliedToken)
  )) return null;
  const sessionToken = activeExisting ? suppliedToken : randomBytes(32).toString("base64url");
  displays.set(id, {
    id,
    audioReady,
    lastSeenAt: Date.now(),
    pairingGeneration: generation,
    sessionGeneration: activeExisting?.sessionGeneration ?? randomBytes(32).toString("hex"),
    sessionTokenHash: passengerSessionTokenHash(sessionToken),
  });
  passengerHeartbeats.set(code, displays);
  return sessionToken;
}

async function findTrip(code: string) {
  const [row] = await db.select().from(liveTripsTable).where(eq(liveTripsTable.pairingCode, code)).limit(1);
  return row ?? null;
}

async function findTripByPassengerCode(code: string) {
  const [row] = await db.select().from(liveTripsTable).where(eq(liveTripsTable.passengerPairingCode, code)).limit(1);
  return row ?? null;
}

export async function generatePassengerPairingCode(excludedCode?: string | null) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = String(randomInt(1000, 10_000));
    if (code === excludedCode) continue;
    if (!await findTripByPassengerCode(code)) return code;
  }
  throw new Error("Could not generate an available passenger pairing code.");
}

function qrInviteKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required to create QR invitations.");
  return createHash("sha256").update(`coach-qr-invite:${secret}`).digest();
}

function createQrInvite(row: LiveTripRow) {
  const expiresAt = Date.now() + QR_INVITE_TTL_MS;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", qrInviteKey(), iv);
  const payload = Buffer.from(JSON.stringify({
    busNumber: row.pairingCode,
    pairingCode: row.passengerPairingCode,
    expiresAt,
  }));
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()]);
  return {
    token: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"),
    expiresAt,
  };
}

async function resolveQrInvite(token: string) {
  try {
    const encoded = Buffer.from(token, "base64url");
    if (encoded.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", qrInviteKey(), encoded.subarray(0, 12));
    decipher.setAuthTag(encoded.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([
      decipher.update(encoded.subarray(28)),
      decipher.final(),
    ]).toString("utf8")) as {
      busNumber?: unknown;
      pairingCode?: unknown;
      expiresAt?: unknown;
    };
    if (
      typeof payload.busNumber !== "string"
      || typeof payload.pairingCode !== "string"
      || typeof payload.expiresAt !== "number"
      || payload.expiresAt <= Date.now()
    ) return null;
    const row = await findTrip(payload.busNumber);
    if (!row || row.retiredAt || row.passengerPairingCode !== payload.pairingCode) return null;
    return { expiresAt: payload.expiresAt, row };
  } catch {
    return null;
  }
}

async function updateTrip(code: string, values: Partial<typeof liveTripsTable.$inferInsert>) {
  const context = operatorContext.getStore();
  const [row] = await db.update(liveTripsTable)
    .set({ ...values, updatedAt: new Date() })
    .where(and(
      eq(liveTripsTable.pairingCode, code),
      context ? eq(liveTripsTable.ownerSubject, context.subject) : undefined,
      context ? eq(liveTripsTable.updatedAt, context.version) : undefined,
    ))
    .returning();
  if (!row) throw Object.assign(new Error("The coach changed during this request. Refresh and try again."), { status: 409 });
  if (context) context.version = row.updatedAt;
  return row;
}

export async function startAssignedTrip(code: string) {
  const current = await findTrip(code);
  if (!current || current.retiredAt || current.completedAt || current.status !== "ready"
    || !current.ownerSubject || !current.officialRunKey || !current.scheduledDepartureAt
    || current.destinationLat === null || current.destinationLng === null) {
    throw Object.assign(new Error("This coach does not have a ready assigned trip."), { status: 409 });
  }
  invalidateTripNavigationCache(code);
  const startedAt = new Date();
  return updateTrip(code, {
    status: "running",
    startedAt,
    scheduledDepartureAt: current.scheduledDepartureAt,
    completedAt: null,
    originLat: null,
    originLng: null,
    currentLat: null,
    currentLng: null,
    locationUpdatedAt: null,
    routeGeometry: [],
    totalDistanceMiles: null,
    remainingDistanceMiles: null,
    speedMph: null,
    eta: null,
  });
}

export async function stopActiveTrip(code: string, requireRunning = false) {
  const current = await findTrip(code);
  if (!current || current.retiredAt || current.completedAt
    || (requireRunning && current.status !== "running")) {
    throw Object.assign(new Error("This coach does not have a running trip."), { status: 409 });
  }
  await expirePassengerAlerts(code, { ...current, status: "stopped" });
  invalidateTripNavigationCache(code);
  const updated = await updateTrip(code, {
    status: "stopped",
    completedAt: new Date(),
    destinationAddress: "",
    destinationLat: null,
    destinationLng: null,
    intermediateStops: [],
    routeGeometry: [],
    originLat: null,
    originLng: null,
    currentLat: null,
    currentLng: null,
    locationUpdatedAt: null,
    totalDistanceMiles: null,
    remainingDistanceMiles: null,
    speedMph: 0,
    eta: null,
    startedAt: null,
    displayMode: "auto",
  });
  void endPassengerLiveActivitiesForTrip(code).catch(() => {
    logger.warn({ pairingCode: code }, "passenger Live Activity trip end failed");
  });
  if (current.officialRunKey) await finishActiveDispatchAssignment(code, "completed");
  return updated;
}

async function getRoadRoute(points: Coordinates[]) {
  const coordinates = points.map((point) => `${point.lng},${point.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`;
  const response = await fetch(url, {
    headers: { "User-Agent": "MonseyTrailsCoachDisplay/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Routing provider returned ${response.status}`);
  const body = await response.json() as {
    routes?: Array<{
      distance: number;
      duration: number;
      geometry?: { coordinates: Array<[number, number]> };
      legs?: Array<{ duration: number }>;
    }>;
  };
  const route = body.routes?.[0];
  if (!route?.geometry?.coordinates?.length) throw new Error("No driving route found");
  return {
    distanceMiles: route.distance / 1609.344,
    durationSeconds: route.duration,
    legDurationSeconds: route.legs?.map((leg) => leg.duration) ?? [],
    geometry: route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
  };
}

async function refreshPersistedRoadRoute(
  pairingCode: string,
  locationObservedAt: Date,
  points: Coordinates[],
  intermediateStops: StoredTripStop[],
  includeTotalDistance: boolean,
) {
  const start = points[0];
  const destination = points.at(-1);
  const anchors = start && destination ? [start, destination] : [];
  const routedStopsInput = intermediateStops.map(stop => ({
    ...stop,
    ...repairMissingWesternLongitude({ lat: stop.lat, lng: stop.lng }, anchors),
  }));
  const routePoints = start && destination
    ? [
      start,
      ...routedStopsInput.map(stop => ({ lat: stop.lat, lng: stop.lng })),
      destination,
    ]
    : points;
  const apiKey = process.env.TOMTOM_API_KEY;
  const trafficRoute = apiKey
    ? await fetchTrafficAwareRoute(routePoints, apiKey)
    : null;
  const fallbackRoadRoute = trafficRoute ? null : await getRoadRoute(routePoints);
  const legDurationSeconds = trafficRoute?.legDurationSeconds ?? fallbackRoadRoute!.legDurationSeconds;
  const distanceMiles = trafficRoute
    ? trafficRoute.distanceMeters / 1609.344
    : fallbackRoadRoute!.distanceMiles;
  const geometry = trafficRoute?.geometry ?? fallbackRoadRoute!.geometry;
  let elapsedSeconds = 0;
  const routedStops = routedStopsInput.map((stop, index) => {
    elapsedSeconds += legDurationSeconds[index] ?? 0;
    return {
      ...stop,
      eta: trafficRoute
        ? new Date(locationObservedAt.getTime() + elapsedSeconds * 1000).toISOString()
        : undefined,
    };
  });
  await db.update(liveTripsTable).set({
    ...(includeTotalDistance ? { totalDistanceMiles: distanceMiles } : {}),
    remainingDistanceMiles: distanceMiles,
    routeGeometry: geometry,
    eta: trafficRoute
      ? new Date(locationObservedAt.getTime() + trafficRoute.travelTimeSeconds * 1000)
      : null,
    intermediateStops: routedStops,
    updatedAt: new Date(),
  }).where(and(
    eq(liveTripsTable.pairingCode, pairingCode),
    eq(liveTripsTable.status, "running"),
    eq(liveTripsTable.locationUpdatedAt, locationObservedAt),
    isNull(liveTripsTable.completedAt),
    isNull(liveTripsTable.retiredAt),
  ));
}

type TomTomGuidanceInstruction = {
  routeOffsetInMeters?: number;
  pointIndex?: number;
  instructionType?: string;
  maneuver?: string;
  message?: string;
  exitNumber?: string;
  roadShieldReferences?: TomTomRoadShieldReference[];
  signpostRoadShieldReferences?: TomTomRoadShieldReference[];
  signpostText?: string;
  point?: { latitude?: number; longitude?: number };
};

type TomTomRoadShieldReference = {
  reference?: string;
  shieldContent?: string;
  affixes?: string[];
};

type TomTomNavigationResponse = {
  routes?: Array<{
    summary?: {
      lengthInMeters?: number;
      travelTimeInSeconds?: number;
      noTrafficTravelTimeInSeconds?: number;
      trafficDelayInSeconds?: number;
      arrivalTime?: string;
    };
    legs?: Array<{
      points?: Array<{ latitude: number; longitude: number }>;
      guidance?: { instructions?: TomTomGuidanceInstruction[] };
    }>;
    guidance?: { instructions?: TomTomGuidanceInstruction[] };
    sections?: Array<{
      startPointIndex?: number;
      endPointIndex?: number;
      sectionType?: string;
      maxSpeedLimitInKmh?: number;
      lanes?: Array<{
        directions?: string[];
        follow?: string;
      }>;
      laneSeparators?: string[];
    }>;
  }>;
};

export type DriverLaneGuidance = {
  lanes: Array<{
    directions: string[];
    follow: string | null;
  }>;
  laneSeparators: string[];
};

type NavigationSelection = { id: string; corridor: Coordinates[] };

export type DriverNavigation = {
  currentRouteId: string;
  currentManeuver: {
    instruction: string;
    distanceMiles: number;
    type: "turn" | "merge" | "arrive" | "depart" | "continue" | "exit" | "roundabout" | "fork";
    modifier?: "left" | "right" | "slight left" | "slight right" | "sharp left" | "sharp right" | "straight" | "uturn";
    laneGuidance: DriverLaneGuidance | null;
    exitNumber: string | null;
    roadShields: Array<{
      reference: string;
      shieldContent: string;
      affixes: string[];
    }>;
    signpostText: string | null;
  } | null;
  nextManeuver: DriverNavigation["currentManeuver"];
  trafficDelaySeconds: number;
  speedLimitMph: number | null;
  voicePrompt: string | null;
  voicePromptId: string | null;
  routeGeometry: Coordinates[];
  remainingDistanceMiles: number;
  travelTimeSeconds: number;
  arrivalTime: string | null;
  alternatives: DriverRouteAlternative[];
};

type DriverRoute = Omit<DriverNavigation, "alternatives" | "currentRouteId">;

export type DriverRouteAlternative = DriverRoute & {
  id: string;
  timeDifferenceSeconds: number;
};

type NavigationCacheEntry = {
  key: string;
  selectionVersion: number;
  value: DriverNavigation;
  expiresAt: number;
};

// Navigation is polled by the cockpit, so this is deliberately short lived.  The
// key includes the bus identity (never share a route between coaches), ordered
// stops, and a quantized origin.  Quantizing avoids paying TomTom for GPS noise
// while still forcing a refresh after meaningful movement.
const NAVIGATION_CACHE_TTL_MS = 2_500;
const NAVIGATION_CACHE_LIMIT = 100;
const navigationCache = new Map<string, NavigationCacheEntry>();
const navigationInFlight = new Map<string, Promise<{ navigation: DriverNavigation; selectionVersion: number }>>();
const navigationSelections = new Map<string, NavigationSelection>();
const navigationSelectionVersions = new Map<string, number>();

export function invalidateTripNavigationCache(pairingCode: string) {
  for (const [key] of navigationCache) if (key.startsWith(`${pairingCode}|`)) navigationCache.delete(key);
  for (const [key] of navigationInFlight) if (key.startsWith(`${pairingCode}|`)) navigationInFlight.delete(key);
  navigationSelections.delete(pairingCode);
  navigationSelectionVersions.delete(pairingCode);
}

function quantizedCoordinate(value: number) {
  // ~55m latitude cells: enough movement to warrant a new road instruction.
  return Math.round(value * 1_000) / 1_000;
}

function navigationCacheKey(busNumber: string, points: Coordinates[], selection?: NavigationSelection) {
  return `${busNumber}|${JSON.stringify({
    points: points.map(point => [quantizedCoordinate(point.lat), quantizedCoordinate(point.lng)]),
    selection: selection ? {
      id: selection.id,
      corridor: selection.corridor.map(point => [quantizedCoordinate(point.lat), quantizedCoordinate(point.lng)]),
    } : null,
  })}`;
}

function pruneNavigationCache() {
  const now = Date.now();
  for (const [key, entry] of navigationCache) {
    if (entry.expiresAt <= now) navigationCache.delete(key);
  }
  while (navigationCache.size > NAVIGATION_CACHE_LIMIT) {
    const oldest = navigationCache.keys().next().value;
    if (!oldest) break;
    navigationCache.delete(oldest);
  }
}

function navigationManeuverType(instruction: TomTomGuidanceInstruction): NonNullable<DriverNavigation["currentManeuver"]>["type"] {
  const value = `${instruction.instructionType ?? ""}_${instruction.maneuver ?? ""}`.toUpperCase();
  if (value.includes("ARRIVAL")) return "arrive";
  if (value.includes("DEPARTURE")) return "depart";
  if (value.includes("ROUNDABOUT")) return "roundabout";
  if (value.includes("MERGE")) return "merge";
  if (value.includes("FORK") || value.includes("KEEP")) return "fork";
  if (value.includes("EXIT")) return "exit";
  if (value.includes("TURN") || value.includes("UTURN")) return "turn";
  return "continue";
}

function navigationModifier(instruction: TomTomGuidanceInstruction): NonNullable<DriverNavigation["currentManeuver"]>["modifier"] | undefined {
  const value = instruction.maneuver?.toUpperCase() ?? "";
  if (value.includes("UTURN")) return "uturn";
  if (value.includes("SHARP_LEFT")) return "sharp left";
  if (value.includes("SHARP_RIGHT")) return "sharp right";
  if (value.includes("SLIGHT_LEFT")) return "slight left";
  if (value.includes("SLIGHT_RIGHT")) return "slight right";
  if (value.includes("LEFT")) return "left";
  if (value.includes("RIGHT")) return "right";
  if (value.includes("STRAIGHT")) return "straight";
  return undefined;
}

export function tomTomNavigationUrl(points: Coordinates[], apiKey: string) {
  const locations = points.map((point) => `${point.lat},${point.lng}`).join(":");
  const params = new URLSearchParams({
    key: apiKey,
    traffic: "true",
    routeType: "fastest",
    travelMode: "bus",
    computeTravelTimeFor: "all",
    instructionsType: "text",
    language: "en-US",
    routeRepresentation: "polyline",
    sectionType: "speedLimit",
    instructionRoadShieldReferences: "all",
    maxAlternatives: "2",
  });
  params.append("sectionType", "lanes");
  return `https://api.tomtom.com/routing/1/calculateRoute/${locations}/json?${params}`;
}

export function filterImplausibleNavigationWaypoints(points: Coordinates[]) {
  if (points.length <= 2) return points;
  const start = points[0];
  const destination = points[points.length - 1];
  const directDistance = distanceMiles(start, destination);
  const localRouteRadius = Math.max(150, directDistance * 1.5);
  return [
    start,
    ...points.slice(1, -1).filter((point) => (
      validCoordinate(point.lat, -90, 90)
      && validCoordinate(point.lng, -180, 180)
      && (distanceMiles(start, point) <= localRouteRadius
        || distanceMiles(destination, point) <= localRouteRadius)
    )),
    destination,
  ];
}

function corridorCells(routeGeometry: Coordinates[]) {
  return new Set(routeGeometry.map(point => `${point.lat.toFixed(3)},${point.lng.toFixed(3)}`));
}

function corridorSimilarity(left: Coordinates[], right: Coordinates[]) {
  const leftCells = corridorCells(left);
  const rightCells = corridorCells(right);
  if (!leftCells.size || !rightCells.size) return 0;
  let shared = 0;
  for (const cell of leftCells) if (rightCells.has(cell)) shared += 1;
  return shared / Math.min(leftCells.size, rightCells.size);
}

function routeCorridorId(routeGeometry: Coordinates[]) {
  const corridor = [...corridorCells(routeGeometry)].sort().join("|");
  let hash = 2166136261;
  for (const character of corridor) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `alternative-${(hash >>> 0).toString(36)}`;
}

export function buildDriverNavigation(
  body: TomTomNavigationResponse,
  selection?: NavigationSelection,
): DriverNavigation {
  const route = body.routes?.[0];
  const summary = route?.summary;
  if (!route || !summary || typeof summary.travelTimeInSeconds !== "number") {
    throw new Error("TomTom Navigation returned no route.");
  }
  const buildRoute = (
    candidate: NonNullable<TomTomNavigationResponse["routes"]>[number],
  ): DriverRoute => {
  const candidateSummary = candidate.summary;
  if (!candidateSummary || typeof candidateSummary.travelTimeInSeconds !== "number") {
    throw new Error("TomTom Navigation returned an unusable route.");
  }
  const instructions = candidate.guidance?.instructions
    ?? candidate.legs?.flatMap((leg) => leg.guidance?.instructions ?? [])
    ?? [];
  const actionable = instructions.filter((instruction) => (
    instruction.message
    && !`${instruction.instructionType ?? ""}`.toUpperCase().includes("DEPARTURE")
  ));
  const laneSections = candidate.sections?.filter((section) => (
    section.sectionType?.toLowerCase() === "lanes"
    && Array.isArray(section.lanes)
    && section.lanes.length > 0
  )) ?? [];
  const laneGuidanceFor = (instruction: TomTomGuidanceInstruction): DriverLaneGuidance | null => {
    if (typeof instruction.pointIndex !== "number") return null;
    const pointIndex = instruction.pointIndex;
    const section = laneSections.find((candidate) => (
      typeof candidate.startPointIndex === "number"
      && typeof candidate.endPointIndex === "number"
      && pointIndex >= candidate.startPointIndex
      && pointIndex <= candidate.endPointIndex
    ));
    if (!section?.lanes?.some((lane) => typeof lane.follow === "string" && lane.follow.length > 0)) {
      return null;
    }
    return {
      lanes: section.lanes.map((lane) => ({
        directions: (lane.directions ?? []).filter((direction) => typeof direction === "string" && direction.length > 0),
        follow: typeof lane.follow === "string" && lane.follow.length > 0 ? lane.follow : null,
      })),
      laneSeparators: (section.laneSeparators ?? []).filter((separator) => (
        typeof separator === "string" && separator.length > 0
      )),
    };
  };
  const roadShieldsFor = (instruction: TomTomGuidanceInstruction) => (
    [...(instruction.roadShieldReferences ?? []), ...(instruction.signpostRoadShieldReferences ?? [])]
      .filter((shield) => (
        typeof shield.reference === "string"
        && shield.reference.trim().length > 0
        && typeof shield.shieldContent === "string"
        && shield.shieldContent.trim().length > 0
      ))
      .map((shield) => ({
        reference: shield.reference!.trim(),
        shieldContent: shield.shieldContent!.trim(),
        affixes: (shield.affixes ?? []).filter((affix) => (
          typeof affix === "string" && affix.trim().length > 0
        )).map((affix) => affix.trim()),
      }))
  );
  const toManeuver = (instruction: TomTomGuidanceInstruction | undefined) => instruction?.message ? ({
    instruction: instruction.message,
    distanceMiles: Math.max(0, instruction.routeOffsetInMeters ?? 0) / 1609.344,
    type: navigationManeuverType(instruction),
    modifier: navigationModifier(instruction),
    laneGuidance: laneGuidanceFor(instruction),
    exitNumber: typeof instruction.exitNumber === "string" && instruction.exitNumber.trim()
      ? instruction.exitNumber.trim()
      : null,
    roadShields: roadShieldsFor(instruction),
    signpostText: typeof instruction.signpostText === "string" && instruction.signpostText.trim()
      ? instruction.signpostText.trim()
      : null,
  }) : null;
  const currentInstruction = actionable[0];
  const routeGeometry = candidate.legs?.flatMap((leg, index) => (
    (leg.points ?? []).slice(index === 0 ? 0 : 1).map((point) => ({
      lat: point.latitude,
      lng: point.longitude,
    }))
  )) ?? [];
  const providerDelay = candidateSummary.trafficDelayInSeconds ?? 0;
  const trafficDifference = candidateSummary.noTrafficTravelTimeInSeconds === undefined
    ? 0
    : candidateSummary.travelTimeInSeconds - candidateSummary.noTrafficTravelTimeInSeconds;
  const voicePoint = currentInstruction?.point;
  const currentSpeedLimit = candidate.sections
    ?.filter((section) => section.sectionType === "SPEED_LIMIT"
      || section.sectionType === "speedLimit"
      || typeof section.maxSpeedLimitInKmh === "number")
    .sort((a, b) => (a.startPointIndex ?? 0) - (b.startPointIndex ?? 0))[0]
    ?.maxSpeedLimitInKmh;
  return {
    currentManeuver: toManeuver(currentInstruction),
    nextManeuver: toManeuver(actionable[1]),
    trafficDelaySeconds: Math.max(0, providerDelay, trafficDifference),
    speedLimitMph: typeof currentSpeedLimit === "number"
      ? Math.round(currentSpeedLimit * 0.621371)
      : null,
    voicePrompt: currentInstruction?.message ?? null,
    voicePromptId: currentInstruction?.message
      ? `${currentInstruction.message}:${voicePoint?.latitude ?? ""}:${voicePoint?.longitude ?? ""}`
      : null,
    routeGeometry,
    remainingDistanceMiles: Math.max(0, candidateSummary.lengthInMeters ?? 0) / 1609.344,
    travelTimeSeconds: candidateSummary.travelTimeInSeconds,
    arrivalTime: candidateSummary.arrivalTime ?? null,
  };
  };
  const routes = (body.routes ?? []).flatMap(candidate => {
    try {
      const mapped = buildRoute(candidate);
      return mapped.routeGeometry.length >= 2 ? [mapped] : [];
    } catch {
      return [];
    }
  });
  if (!routes.length) throw new Error("TomTom Navigation returned no usable route.");
  const selectedIndex = selection
    ? routes.reduce((best, candidate, index) => (
      corridorSimilarity(candidate.routeGeometry, selection.corridor)
        > corridorSimilarity(routes[best].routeGeometry, selection.corridor) ? index : best
    ), 0)
    : 0;
  const selected = routes[selectedIndex];
  const selectedMatches = !selection || corridorSimilarity(selected.routeGeometry, selection.corridor) >= 0.35;
  const primary = selectedMatches ? selected : routes[0];
  const primaryIndex = selectedMatches ? selectedIndex : 0;
  return {
    ...primary,
    currentRouteId: selectedMatches && selection ? selection.id : "tomtom-primary",
    alternatives: routes.flatMap((alternative, index) => index === primaryIndex ? [] : [{
      ...alternative,
      id: routeCorridorId(alternative.routeGeometry),
      timeDifferenceSeconds: alternative.travelTimeSeconds - primary.travelTimeSeconds,
    }]),
  };
}

export async function buildLatestDriverNavigation(
  response: Promise<TomTomNavigationResponse>,
  getSelectionState: () => { selection?: NavigationSelection; version: number },
) {
  const body = await response;
  const latest = getSelectionState();
  return {
    navigation: buildDriverNavigation(body, latest.selection),
    selectionVersion: latest.version,
  };
}

async function getDriverNavigationResponse(points: Coordinates[]): Promise<TomTomNavigationResponse> {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) throw new Error("TomTom Navigation is not configured.");
  const response = await fetch(
    tomTomNavigationUrl(points, apiKey),
    { signal: AbortSignal.timeout(12_000) },
  );
  if (!response.ok) throw new Error(`TomTom Navigation returned ${response.status}`);
  return response.json() as Promise<TomTomNavigationResponse>;
}

function selectDriverRoute(navigation: DriverNavigation, routeId: string): DriverNavigation | null {
  if (navigation.currentRouteId === routeId) return navigation;
  const selected = navigation.alternatives.find(route => route.id === routeId);
  if (!selected) return null;
  const { id: _id, timeDifferenceSeconds: _difference, ...selectedRoute } = selected;
  const { alternatives: _alternatives, currentRouteId, ...currentRoute } = navigation;
  return {
    ...selectedRoute,
    currentRouteId: routeId,
    alternatives: [
      {
        ...currentRoute,
        id: currentRouteId,
        timeDifferenceSeconds: currentRoute.travelTimeSeconds - selectedRoute.travelTimeSeconds,
      },
      ...navigation.alternatives.filter(route => route.id !== routeId).map(route => ({
        ...route,
        timeDifferenceSeconds: route.travelTimeSeconds - selectedRoute.travelTimeSeconds,
      })),
    ],
  };
}

function validTripStop(value: unknown): value is StoredTripStop {
  if (!value || typeof value !== "object") return false;
  const stop = value as Partial<StoredTripStop>;
  return typeof stop.id === "string"
    && stop.id.length <= 80
    && typeof stop.address === "string"
    && stop.address.length >= 3
    && stop.address.length <= 240
    && validCoordinate(stop.lat, -90, 90)
    && validCoordinate(stop.lng, -180, 180);
}

function milesBetween(a: Coordinates, b: Coordinates) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latDistance = radians(b.lat - a.lat);
  const lngDistance = radians(b.lng - a.lng);
  const haversine = Math.sin(latDistance / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lngDistance / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function startsWithHouseNumber(address: string) {
  return /^\d+[A-Z-]?(?:,|\s)/i.test(address.trim());
}

async function nearestCrossStreet(point: Coordinates, fallback: string) {
  if (!startsWithHouseNumber(fallback)) return fallback;

  const query = `[out:json][timeout:10];
way(around:250,${point.lat},${point.lng})[highway~"^(residential|living_street|unclassified|tertiary|secondary|primary|trunk)$"][name];
(._;>;);
out body;`;
  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "User-Agent": "MonseyTrailsCoachDisplay/1.0",
    },
    body: new URLSearchParams({ data: query }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Intersection provider returned ${response.status}`);

  const body = await response.json() as { elements?: OverpassElement[] };
  return findNearestCrossStreet(body.elements ?? [], point) ?? fallback;
}

export function findNearestCrossStreet(elements: OverpassElement[], point: Coordinates) {
  const nodes = new Map<number, Coordinates>();
  const namesAtNode = new Map<number, Set<string>>();
  for (const element of elements) {
    if (element.type === "node") nodes.set(element.id, { lat: element.lat, lng: element.lon });
  }
  for (const element of elements) {
    if (
      element.type !== "way"
      || !element.tags?.name
      || !element.tags.highway
      || !PASSENGER_ROAD_CLASSES.has(element.tags.highway)
    ) continue;
    for (const nodeId of element.nodes ?? []) {
      const names = namesAtNode.get(nodeId) ?? new Set<string>();
      names.add(element.tags.name);
      namesAtNode.set(nodeId, names);
    }
  }

  const intersections = Array.from(namesAtNode.entries())
    .filter(([, names]) => names.size >= 2)
    .map(([nodeId, names]) => ({
      names: Array.from(names),
      distance: nodes.has(nodeId) ? milesBetween(point, nodes.get(nodeId)!) : Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.distance - b.distance);
  const nearest = intersections[0];
  return nearest ? `${nearest.names[0]} & ${nearest.names[1]}` : null;
}

async function withCrossStreet(stop: StoredTripStop): Promise<StoredTripStop> {
  try {
    return {
      ...stop,
      address: await nearestCrossStreet({ lat: stop.lat, lng: stop.lng }, stop.address),
    };
  } catch {
    return stop;
  }
}

router.post("/trips", requireDriverProfile, async (req, res): Promise<void> => {
  const busNumber = typeof req.body?.busNumber === "string"
    ? normalizeBusNumber(req.body.busNumber)
    : "";
  if (!BUS_NUMBER_PATTERN.test(busNumber)) {
    res.status(400).json({ error: "Enter a valid bus number using up to 6 letters or numbers." });
    return;
  }

  await removeExpiredRetiredTrips();
  const subject = res.locals.driverSubject as string;
  const [assignedCoach] = await db.select().from(liveTripsTable).where(and(
    eq(liveTripsTable.pairingCode, busNumber),
    eq(liveTripsTable.ownerSubject, subject),
    isNull(liveTripsTable.completedAt),
    isNull(liveTripsTable.retiredAt),
    inArray(liveTripsTable.status, ["ready", "running"]),
    isNotNull(liveTripsTable.officialRunKey),
    isNotNull(liveTripsTable.scheduledDepartureAt),
  )).limit(1);
  if (!assignedCoach) {
    const [driverAssignment] = await db.select({ busNumber: liveTripsTable.pairingCode })
      .from(liveTripsTable).where(and(
        eq(liveTripsTable.ownerSubject, subject),
        isNull(liveTripsTable.completedAt),
        isNull(liveTripsTable.retiredAt),
        inArray(liveTripsTable.status, ["ready", "running"]),
        isNotNull(liveTripsTable.officialRunKey),
        isNotNull(liveTripsTable.scheduledDepartureAt),
      )).limit(1);
    res.status(403).json({
      error: driverAssignment
        ? `Dispatch assigned you to coach ${driverAssignment.busNumber}.`
        : "Dispatch must assign you a coach and published schedule before you can connect.",
      code: "ADMIN_DISPATCH_REQUIRED",
      ...(driverAssignment ? { assignedBusNumber: driverAssignment.busNumber } : {}),
    });
    return;
  }
  let row = assignedCoach;
  if (!row.passengerPairingCode) {
    const passengerPairingCode = await generatePassengerPairingCode();
    const [updated] = await db.update(liveTripsTable).set({
      passengerPairingCode,
      updatedAt: new Date(),
    }).where(and(
      eq(liveTripsTable.pairingCode, busNumber),
      eq(liveTripsTable.ownerSubject, subject),
      isNull(liveTripsTable.passengerPairingCode),
      isNull(liveTripsTable.completedAt),
      isNull(liveTripsTable.retiredAt),
    )).returning();
    if (!updated) {
      res.status(409).json({ error: "The dispatch assignment changed. Refresh and try again." });
      return;
    }
    row = updated;
  }
  res.status(201).json({ busNumber, pairingCode: row.passengerPairingCode, trip: rowToTrip(row) });
});

router.post("/trips/pair", async (req, res): Promise<void> => {
  const pairingCode = typeof req.body?.pairingCode === "string"
    ? req.body.pairingCode.trim()
    : "";
  if (!/^\d{4}$/.test(pairingCode)) {
    res.status(400).json({ error: "Enter the four-digit code shown in the operator app." });
    return;
  }
  const row = await findTripByPassengerCode(pairingCode);
  if (!row || row.retiredAt) {
    res.status(404).json({ error: "That pairing code is invalid or has expired." });
    return;
  }
  const pairedAt = new Date();
  await db.update(liveTripsTable)
    .set({ passengerLastSeenAt: pairedAt })
    .where(eq(liveTripsTable.pairingCode, row.pairingCode));
  res.json({ busNumber: row.pairingCode, pairingCode, trip: await rowToPassengerTripWithOfficialNotes({ ...row, passengerLastSeenAt: pairedAt }) });
});

router.get("/trips/public/:busNumber", async (req, res): Promise<void> => {
  const busNumber = normalizeBusNumber(String(req.params.busNumber));
  if (!BUS_NUMBER_PATTERN.test(busNumber)) {
    res.status(400).json({ error: "Enter a valid bus number." });
    return;
  }
  const row = await findTrip(busNumber);
  if (!row || row.retiredAt) {
    res.status(404).json({ error: "The driver has not signed in to this bus yet." });
    return;
  }
  res.json(await rowToPassengerTripWithOfficialNotes(row));
});

router.get("/trips/public-run/:runKey", async (req, res): Promise<void> => {
  const runKey = String(req.params.runKey);
  if (!OFFICIAL_RUN_KEY_PATTERN.test(runKey)) {
    res.status(400).json({ error: "Choose a valid published departure." });
    return;
  }
  const alias = await resolveOfficialRunAlias(runKey);
  const [row] = await db.select().from(liveTripsTable).where(and(
    inArray(liveTripsTable.officialRunKey, alias.keys),
    isNull(liveTripsTable.retiredAt),
  )).orderBy(desc(officialAssignmentPriority), desc(liveTripsTable.updatedAt)).limit(1);
  if (!row) {
    res.status(404).json({ error: "The driver has not assigned a bus to this departure yet." });
    return;
  }
  const publicRow = alias.physicalDepartureAt
    ? { ...row, scheduledDepartureAt: alias.physicalDepartureAt }
    : row;
  res.json({ busNumber: row.pairingCode, trip: await rowToPassengerTripWithOfficialNotes(publicRow) });
});

router.get("/trips/public/:busNumber/push-public-key", async (req, res): Promise<void> => {
  const busNumber = normalizeBusNumber(String(req.params.busNumber));
  const row = BUS_NUMBER_PATTERN.test(busNumber) ? await findTrip(busNumber) : null;
  if (!row || row.retiredAt) {
    res.status(404).json({ error: "The driver has not signed in to this bus yet." });
    return;
  }
  const keys = await getVapidKeys();
  res.json({ publicKey: keys.publicKey });
});

router.put("/trips/public/:busNumber/push-subscription", async (req, res): Promise<void> => {
  const busNumber = normalizeBusNumber(String(req.params.busNumber));
  const row = BUS_NUMBER_PATTERN.test(busNumber) ? await findTrip(busNumber) : null;
  const displayId = typeof req.body?.displayId === "string" ? req.body.displayId.trim() : "";
  const stopKey = typeof req.body?.stopKey === "string" ? req.body.stopKey.trim() : "";
  const stopLabel = typeof req.body?.stopLabel === "string" ? req.body.stopLabel.trim() : "";
  const endpoint = typeof req.body?.subscription?.endpoint === "string" ? req.body.subscription.endpoint : "";
  const p256dh = typeof req.body?.subscription?.keys?.p256dh === "string" ? req.body.subscription.keys.p256dh : "";
  const auth = typeof req.body?.subscription?.keys?.auth === "string" ? req.body.subscription.keys.auth : "";
  if (
    !row || row.retiredAt
    || !/^[A-Za-z0-9_-]{1,64}$/.test(displayId)
    || !/^(stop:|destination:).{1,148}$/.test(stopKey)
    || !stopLabel || stopLabel.length > 240
    || !endpoint.startsWith("https://") || !p256dh || !auth
  ) {
    res.status(400).json({ error: "A live bus, valid stop, and notification subscription are required." });
    return;
  }
  const id = createHash("sha256").update(endpoint).digest("hex");
  await db.insert(pushSubscriptionsTable).values({
    id,
    pairingCode: row.pairingCode,
    displayId,
    stopKey,
    stopLabel,
    endpoint,
    p256dh,
    auth,
  }).onConflictDoUpdate({
    target: pushSubscriptionsTable.id,
    set: { pairingCode: row.pairingCode, displayId, stopKey, stopLabel, p256dh, auth },
  });
  res.status(204).end();
});

router.delete("/trips/public/:busNumber/push-subscription/:displayId", async (req, res): Promise<void> => {
  const busNumber = normalizeBusNumber(String(req.params.busNumber));
  if (BUS_NUMBER_PATTERN.test(busNumber)) {
    await db.delete(pushSubscriptionsTable).where(and(
      eq(pushSubscriptionsTable.pairingCode, busNumber),
      eq(pushSubscriptionsTable.displayId, String(req.params.displayId)),
    ));
  }
  res.status(204).end();
});

router.get("/trips/qr-invites/:token", async (req, res): Promise<void> => {
  const token = String(req.params.token);
  if (!/^[A-Za-z0-9_-]{32,}$/.test(token)) {
    res.status(404).json({ error: "This QR invitation is invalid or has expired." });
    return;
  }
  const resolved = await resolveQrInvite(token);
  if (!resolved) {
    res.status(404).json({ error: "This QR invitation is invalid or has expired." });
    return;
  }
  res.json({
    busNumber: resolved.row.pairingCode,
    expiresAt: new Date(resolved.expiresAt).toISOString(),
  });
});

router.post("/trips/qr-invites/:token/pair", async (req, res): Promise<void> => {
  const resolved = await resolveQrInvite(String(req.params.token));
  if (!resolved) {
    res.status(404).json({ error: "This QR invitation is invalid or has expired." });
    return;
  }
  const pairedAt = new Date();
  await db.update(liveTripsTable)
    .set({ passengerLastSeenAt: pairedAt })
    .where(eq(liveTripsTable.pairingCode, resolved.row.pairingCode));
  res.json({
    busNumber: resolved.row.pairingCode,
    pairingCode: resolved.row.passengerPairingCode,
    trip: await rowToPassengerTripWithOfficialNotes({ ...resolved.row, passengerLastSeenAt: pairedAt }),
  });
});

router.use("/trips/:code", async (req, res, next): Promise<void> => {
  const code = normalizeBusNumber(String(req.params.code));
  if (!BUS_NUMBER_PATTERN.test(code)) {
    res.status(400).json({ error: "Invalid bus number." });
    return;
  }
  const passengerViewer = isPassengerAccess(req.method, req.path, req.query.viewer);
  if (!passengerViewer) {
    let authorized = false;
    await requireDriverProfile(req, res, () => { authorized = true; });
    if (!authorized) return;
  }
  const row = passengerViewer ? await findTripByPassengerCode(code) : await findTrip(code);
  if (!row) {
    res.status(404).json({ error: "Bus session not found." });
    return;
  }
  if (row.retiredAt) {
    res.status(410).json({ error: "This bus session is no longer active." });
    return;
  }
  if (!passengerViewer && !ownsTrip(row.ownerSubject, res.locals.driverSubject)) {
    res.status(403).json({ error: "Only the assigned driver can operate this coach.", code: "NOT_COACH_OWNER" });
    return;
  }
  res.locals.pairingCode = row.pairingCode;
  res.locals.tripRow = row;
  res.locals.passengerViewer = passengerViewer;
  res.set("Cache-Control", "no-store");
  if (passengerViewer) next();
  else operatorContext.run({ subject: res.locals.driverSubject, version: row.updatedAt }, next);
});

router.post("/trips/:code/qr-invite", (req, res): void => {
  const row = res.locals.tripRow as LiveTripRow;
  const proof = typeof req.body?.passengerPairingCode === "string" ? req.body.passengerPairingCode.trim() : "";
  // The bus number alone is not a secret (it is shown publicly on the coach), so creating an
  // invitation must prove possession of the rotating passenger pairing code the operator display
  // already holds. Anyone who only knows the bus number cannot mint an invite this way.
  if (!row.passengerPairingCode || proof !== row.passengerPairingCode) {
    res.status(403).json({ error: "Only the operator display can create a QR invitation." });
    return;
  }
  const { token, expiresAt } = createQrInvite(row);
  res.status(201).json({ token, expiresAt: new Date(expiresAt).toISOString() });
});

router.get("/trips/:code", async (req, res): Promise<void> => {
  const trip = res.locals.passengerViewer
    ? await rowToPassengerTripWithOfficialNotes(res.locals.tripRow as LiveTripRow) : rowToTrip(res.locals.tripRow as LiveTripRow);
  const [adminSettings] = await db.select().from(adminDisplaySettingsTable)
    .where(eq(adminDisplaySettingsTable.busNumber, res.locals.pairingCode)).limit(1);
  const configuredTrip = adminSettings ? {
    ...trip,
    displaySettingsVersion: adminSettings.version,
    enabledSlides: adminSettings.enabledSlides,
    passengerLanguage: adminSettings.passengerLanguage as PassengerLanguage,
    rotationIntervalSeconds: adminSettings.rotationIntervalSeconds,
    announcements: adminSettings.announcements,
  } : trip;
  if (res.locals.passengerViewer) {
    await db.update(liveTripsTable)
      .set({ passengerLastSeenAt: new Date() })
      .where(eq(liveTripsTable.pairingCode, res.locals.pairingCode));
  }
  const knownGeometryVersion = typeof req.query.geometryVersion === "string"
    ? req.query.geometryVersion
    : "";
  const response: PolledTripState = knownGeometryVersion === trip.updatedAt && !res.locals.passengerViewer
    ? (({ routeGeometry: _routeGeometry, ...rest }) => rest)(configuredTrip)
    : configuredTrip;
  res.json(response);
});

export async function disconnectPassengerScreens(
  code: string,
  options: { ownerSubject?: string; activeOnly?: boolean } = {},
) {
  const current = await findTrip(code);
  if (!current) throw Object.assign(new Error("Bus session not found."), { status: 404 });
  const passengerPairingCode = await generatePassengerPairingCode(current.passengerPairingCode);
  const displaysDisconnected = activePassengerDisplays(code).length;
  const [updated] = await db.update(liveTripsTable).set({
    passengerPairingCode,
    passengerLastSeenAt: null,
    chimeTestRequestedAt: null,
    updatedAt: new Date(),
  }).where(and(
    eq(liveTripsTable.pairingCode, code),
    options.ownerSubject ? eq(liveTripsTable.ownerSubject, options.ownerSubject) : undefined,
    options.activeOnly ? inArray(liveTripsTable.status, ["ready", "running"]) : undefined,
    current.passengerPairingCode === null
      ? isNull(liveTripsTable.passengerPairingCode)
      : eq(liveTripsTable.passengerPairingCode, current.passengerPairingCode),
    isNull(liveTripsTable.retiredAt),
  )).returning();
  if (!updated) throw Object.assign(new Error("The coach changed during this request. Refresh and try again."), { status: 409 });
  if (current.passengerPairingCode) {
    await revokePassengerRealtimeSubscriptions(code, current.passengerPairingCode);
  }
  const context = operatorContext.getStore();
  if (context) context.version = updated.updatedAt;
  passengerHeartbeats.delete(code);
  await db.delete(adminDisplayReceiptsTable)
    .where(eq(adminDisplayReceiptsTable.busNumber, code));
  await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.pairingCode, code));
  return { updated, displaysDisconnected };
}

router.post("/trips/:code/disconnect-screens", async (_req, res): Promise<void> => {
  const code = res.locals.pairingCode as string;
  const { updated } = await disconnectPassengerScreens(code, {
    ownerSubject: operatorContext.getStore()!.subject,
  });
  res.json({ busNumber: code, pairingCode: updated.passengerPairingCode, trip: rowToTrip(updated) });
});

router.post("/trips/:code/logout", async (_req, res): Promise<void> => {
  // Driver sign-out must never cancel a dispatch-owned coach/run assignment.
  // It only revokes every currently paired passenger screen.
  await disconnectPassengerScreens(res.locals.pairingCode as string, {
    ownerSubject: operatorContext.getStore()!.subject,
  });
  res.status(204).end();
});

router.put("/trips/:code/passenger-status", (req, res): void => {
  const id = typeof req.body?.id === "string" ? req.body.id.trim() : "";
  const audioReady = req.body?.audioReady;
  const sessionToken = typeof req.body?.sessionToken === "string" ? req.body.sessionToken : "";
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || typeof audioReady !== "boolean") {
    res.status(400).json({ error: "Passenger status requires a valid display ID and audio readiness." });
    return;
  }
  const row = res.locals.tripRow as LiveTripRow;
  if (!row.passengerPairingCode) {
    res.status(403).json({ error: "Passenger pairing is required." });
    return;
  }
  const issuedToken = registerPassengerDisplay(
    res.locals.pairingCode as string,
    row.passengerPairingCode,
    id,
    audioReady,
    sessionToken,
  );
  if (!issuedToken) {
    res.status(403).json({ error: "This passenger display session is no longer valid. Pair the display again." });
    return;
  }
  res.json({ sessionToken: issuedToken });
});

router.put("/trips/:code/display-settings-receipt", async (req, res): Promise<void> => {
  if (!res.locals.passengerViewer) {
    res.status(403).json({ error: "Passenger pairing is required." });
    return;
  }
  const displayId = typeof req.body?.displayId === "string" ? req.body.displayId.trim() : "";
  const version = req.body?.version;
  const sessionToken = typeof req.body?.sessionToken === "string" ? req.body.sessionToken : "";
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(displayId) || !Number.isInteger(version) || version < 1) {
    res.status(400).json({ error: "A valid display and settings version are required." });
    return;
  }
  const busNumber = res.locals.pairingCode as string;
  const row = res.locals.tripRow as LiveTripRow;
  const session = passengerHeartbeats.get(busNumber)?.get(displayId);
  const generation = row.passengerPairingCode ? pairingGeneration(row.passengerPairingCode) : "";
  if (!session || Date.now() - session.lastSeenAt > PASSENGER_HEARTBEAT_TTL_MS
    || !generation || session.pairingGeneration !== generation
    || !sessionToken || !secureTokenMatches(session.sessionTokenHash, sessionToken)) {
    res.status(403).json({ error: "A current authenticated passenger display session is required." });
    return;
  }
  const [settings] = await db.select({ version: adminDisplaySettingsTable.version })
    .from(adminDisplaySettingsTable).where(eq(adminDisplaySettingsTable.busNumber, busNumber)).limit(1);
  if (!settings || settings.version !== version) {
    res.status(409).json({ error: "Those display settings are no longer current." });
    return;
  }
  const now = new Date();
  await db.insert(adminDisplayReceiptsTable).values({
    busNumber,
    displayId,
    pairingGeneration: generation,
    sessionGeneration: session.sessionGeneration,
    receivedVersion: version,
    receivedAt: now,
    connected: true,
  }).onConflictDoUpdate({
    target: [adminDisplayReceiptsTable.busNumber, adminDisplayReceiptsTable.displayId],
    set: {
      pairingGeneration: generation,
      sessionGeneration: session.sessionGeneration,
      receivedVersion: version,
      receivedAt: now,
      connected: true,
    },
  });
  res.status(204).end();
});

router.get("/trips/:code/push-public-key", async (_req, res): Promise<void> => {
  if (!res.locals.passengerViewer) {
    res.status(403).json({ error: "Passenger pairing is required." });
    return;
  }
  const keys = await getVapidKeys();
  res.json({ publicKey: keys.publicKey });
});

router.put("/trips/:code/push-subscription", async (req, res): Promise<void> => {
  if (!res.locals.passengerViewer) {
    res.status(403).json({ error: "Passenger pairing is required." });
    return;
  }
  const displayId = typeof req.body?.displayId === "string" ? req.body.displayId.trim() : "";
  const stopKey = typeof req.body?.stopKey === "string" ? req.body.stopKey.trim() : "";
  const stopLabel = typeof req.body?.stopLabel === "string" ? req.body.stopLabel.trim() : "";
  const endpoint = typeof req.body?.subscription?.endpoint === "string" ? req.body.subscription.endpoint : "";
  const p256dh = typeof req.body?.subscription?.keys?.p256dh === "string" ? req.body.subscription.keys.p256dh : "";
  const auth = typeof req.body?.subscription?.keys?.auth === "string" ? req.body.subscription.keys.auth : "";
  if (
    !/^[A-Za-z0-9_-]{1,64}$/.test(displayId)
    || !/^(stop:|destination:).{1,148}$/.test(stopKey)
    || !stopLabel || stopLabel.length > 240
    || !isSupportedPushEndpoint(endpoint) || !p256dh || !auth
  ) {
    res.status(400).json({ error: "A valid stop and notification subscription are required." });
    return;
  }
  const id = createHash("sha256").update(endpoint).digest("hex");
  await db.insert(pushSubscriptionsTable).values({
    id,
    pairingCode: res.locals.pairingCode,
    displayId,
    stopKey,
    stopLabel,
    endpoint,
    p256dh,
    auth,
  }).onConflictDoUpdate({
    target: pushSubscriptionsTable.id,
    set: { pairingCode: res.locals.pairingCode, displayId, stopKey, stopLabel, p256dh, auth },
  });
  res.status(204).end();
});

router.delete("/trips/:code/push-subscription/:displayId", async (req, res): Promise<void> => {
  if (!res.locals.passengerViewer) {
    res.status(403).json({ error: "Passenger pairing is required." });
    return;
  }
  await db.delete(pushSubscriptionsTable).where(and(
    eq(pushSubscriptionsTable.pairingCode, res.locals.pairingCode),
    eq(pushSubscriptionsTable.displayId, String(req.params.displayId)),
  ));
  res.status(204).end();
});

router.post("/trips/:code/test-chime", async (_req, res): Promise<void> => {
  const row = res.locals.tripRow as LiveTripRow;
  const passengerLastSeenAt = row.passengerLastSeenAt?.getTime() ?? 0;
  if (Date.now() - passengerLastSeenAt > PASSENGER_CONNECTED_WINDOW_MS) {
    res.status(409).json({ error: "No passenger display is connected to this bus." });
    return;
  }

  const updated = await updateTrip(res.locals.pairingCode, { chimeTestRequestedAt: new Date() });
  res.json(rowToTrip(updated));
});

router.get("/trips/:code/route-geometry", async (req, res): Promise<void> => {
  const row = await findTrip(res.locals.pairingCode);
  if (row && res.locals.passengerViewer && locationVisibility(row) !== "live") {
    res.json({ geometry: [], ...passengerLocationFields(row) });
    return;
  }
  const start = row?.currentLat !== null && row?.currentLng !== null
    ? { lat: row.currentLat, lng: row.currentLng }
    : row?.originLat !== null && row?.originLng !== null
      ? { lat: row.originLat, lng: row.originLng }
      : null;
  if (!row || !start || row.destinationLat === null || row.destinationLng === null) {
    res.status(409).json({ error: "A running route is not available yet." });
    return;
  }
  try {
    const route = await getRoadRoute([
      start,
      ...row.intermediateStops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
      { lat: row.destinationLat, lng: row.destinationLng },
    ]);
    if (res.locals.passengerViewer) {
      // Routing is an external, potentially slow call. Recheck after it completes so
      // an arrival/logout during the lookup cannot return a now-private GPS polyline.
      const latest = await findTrip(res.locals.pairingCode);
      if (!latest) {
        res.json({ geometry: [], routeGeometry: [], currentLocation: null, origin: null,
          speedMph: null, bearing: null, locationVisibility: "unavailable", scheduledDepartureAt: null });
        return;
      }
      const fields = passengerLocationFields(latest);
      res.json({ geometry: fields.locationVisibility === "live" ? route.geometry : [], ...fields });
      return;
    }
    res.json({ geometry: route.geometry });
  } catch (error) {
    req.log.warn({ err: error }, "route geometry lookup failed");
    res.status(502).json({ error: "The road route is temporarily unavailable." });
  }
});

router.get("/trips/:code/navigation", async (req, res): Promise<void> => {
  const row = await findTrip(res.locals.pairingCode);
  const start = row?.currentLat !== null && row?.currentLng !== null
    ? { lat: row.currentLat, lng: row.currentLng }
    : null;
  if (!row || row.status !== "running" || !start || row.destinationLat === null || row.destinationLng === null) {
    res.status(409).json({ error: "A running trip is required for navigation." });
    return;
  }
  const requestedPoints = [
    start,
    ...row.intermediateStops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
    { lat: row.destinationLat, lng: row.destinationLng },
  ];
  const points = filterImplausibleNavigationWaypoints(requestedPoints);
  if (points.length !== requestedPoints.length) {
    req.log.warn({
      pairingCode: res.locals.pairingCode,
      excludedWaypoints: requestedPoints.length - points.length,
    }, "excluded implausible waypoints from driver navigation");
  }
  const busNumber = row.pairingCode;
  const selection = navigationSelections.get(busNumber);
  const selectionVersion = navigationSelectionVersions.get(busNumber) ?? 0;
  const cacheKey = navigationCacheKey(busNumber, points, selection);
  pruneNavigationCache();
  const cached = navigationCache.get(cacheKey);
  if (cached && cached.selectionVersion === selectionVersion && cached.expiresAt > Date.now()) {
    res.setHeader("cache-control", "private, max-age=1");
    res.json(cached.value);
    return;
  }
  try {
    let work = navigationInFlight.get(cacheKey);
    if (!work) {
      work = buildLatestDriverNavigation(
        getDriverNavigationResponse(points),
        () => ({
          selection: navigationSelections.get(busNumber),
          version: navigationSelectionVersions.get(busNumber) ?? 0,
        }),
      );
      navigationInFlight.set(cacheKey, work);
      void work.finally(() => {
        if (navigationInFlight.get(cacheKey) === work) navigationInFlight.delete(cacheKey);
      });
    }
    const { navigation, selectionVersion: latestSelectionVersion } = await work;
    // A newer selection may have arrived while TomTom was working.  Do not
    // publish the old corridor; the next poll will use the new cache key.
    if ((navigationSelectionVersions.get(busNumber) ?? 0) !== latestSelectionVersion) {
      const latest = navigationCache.get(navigationCacheKey(
        busNumber,
        points,
        navigationSelections.get(busNumber),
      ));
      if (latest) {
        res.json(latest.value);
        return;
      }
    } else {
      navigationCache.set(cacheKey, {
        key: cacheKey,
        selectionVersion: latestSelectionVersion,
        value: navigation,
        expiresAt: Date.now() + NAVIGATION_CACHE_TTL_MS,
      });
      pruneNavigationCache();
    }
    res.setHeader("cache-control", "private, max-age=1");
    res.json(navigation);
  } catch (error) {
    req.log.warn({ err: error }, "driver navigation lookup failed");
    res.status(502).json({ error: "Live TomTom navigation is temporarily unavailable." });
  }
});

router.put("/trips/:code/navigation-selection", async (req, res): Promise<void> => {
  const routeId = typeof req.body?.routeId === "string" ? req.body.routeId : "";
  const row = await findTrip(res.locals.pairingCode);
  const busNumber = row?.pairingCode ?? res.locals.pairingCode;
  const cached = [...navigationCache.values()]
    .filter(entry => entry.expiresAt > Date.now() && entry.key.startsWith(`${busNumber}|`))
    .sort((left, right) => right.expiresAt - left.expiresAt)[0];
  if (!routeId || !cached) {
    res.status(409).json({ error: "Live route choices are not available yet." });
    return;
  }
  const selected = selectDriverRoute(cached.value, routeId);
  if (!selected) {
    res.status(400).json({ error: "That route choice is no longer available." });
    return;
  }
  navigationSelections.set(res.locals.pairingCode, {
    id: selected.currentRouteId,
    corridor: selected.routeGeometry,
  });
  const selectionVersion = (navigationSelectionVersions.get(res.locals.pairingCode) ?? 0) + 1;
  navigationSelectionVersions.set(res.locals.pairingCode, selectionVersion);
  // Keep the selected response hot, but retain the key's bus-specific identity.
  navigationCache.set(cached.key, {
    ...cached,
    selectionVersion,
    value: selected,
    expiresAt: Date.now() + NAVIGATION_CACHE_TTL_MS,
  });
  res.json(selected);
});

export function normalizeNavigationQuery(query: string) {
  return query
    .replace(/\b(?:intersection\s+of|corner\s+of)\b/gi, " ")
    .replace(/\b(?:at\s+the\s+)?corner(?:\s+of)?\b/gi, " & ")
    .replace(/\s+\b(?:and|&)\b\s+/gi, " & ")
    .replace(/\b([A-Z])\s+(?:Street|St\.?)\b/gi, "Avenue $1")
    .replace(/\s*&\s*&\s*/g, " & ")
    .replace(/\s+/g, " ")
    .trim();
}

export function navigationSearchQueries(query: string) {
  const normalized = normalizeNavigationQuery(query);
  if (!normalized.includes("&") || /,\s*(?:NY|NJ|New York|New Jersey)\b/i.test(normalized)) {
    return [normalized];
  }
  if (/\bAvenue\s+[A-Z]\b/i.test(normalized)) {
    return [`${normalized}, Brooklyn, New York`];
  }
  if (/\b(?:Route|NY-\d+|Monsey|Viola|Maple|306)\b/i.test(normalized)) {
    return [
      `${normalized}, Spring Valley, New York`,
      `${normalized}, Monsey, New York`,
      normalized,
    ];
  }
  return [
    `${normalized}, Brooklyn, New York`,
    `${normalized}, New York, New York`,
    normalized,
  ];
}

export function tomTomNavigationQuery(query: string) {
  const normalized = normalizeNavigationQuery(query);
  const providerQuery = normalized
    .replace(/\b(?:Route|NY-?)\s*45\b/gi, "Main Street")
    .replace(/\b(?:Route|NY-?)\s*59\b/gi, "West Route 59")
    .replace(/\s*&\s*/g, " ")
    .replace(normalized.includes("&") ? /,/g : /$^/, "")
    .replace(/\s+/g, " ")
    .trim();
  return providerQuery;
}

type NavigationCandidate = {
  address: string;
  score: number;
  location: { x: number; y: number };
  attributes: { Addr_type: string };
};

async function findAddressCandidates(query: string, limit: number): Promise<NavigationCandidate[]> {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) throw new Error("TomTom Search is not configured.");
  const params = new URLSearchParams({
    key: apiKey,
    limit: String(limit),
    countrySet: "US",
    language: "en-US",
    view: "Unified",
  });
  const response = await fetch(
    `https://api.tomtom.com/search/2/search/${encodeURIComponent(tomTomNavigationQuery(query))}.json?${params}`,
    {
      headers: { "User-Agent": "MonseyTrailsCoachDisplay/1.0 navigation search" },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) throw new Error(`TomTom Search returned ${response.status}`);
  const body = await response.json() as {
    results?: Array<{
      type: string;
      score: number;
      position: { lat: number; lon: number };
      address?: { freeformAddress?: string };
    }>;
  };
  return (body.results ?? [])
    .filter((result) => result.address?.freeformAddress)
    .map((result) => ({
      address: result.address!.freeformAddress!,
      score: result.score,
      location: { x: result.position.lon, y: result.position.lat },
      attributes: { Addr_type: result.type },
    }));
}

export async function geocodeNavigationQuery(query: string, limit: number) {
  const intersectionQuery = normalizeNavigationQuery(query).includes("&");
  const providerLimit = intersectionQuery ? Math.max(20, limit) : limit;
  const resultSets = await Promise.all(
    navigationSearchQueries(query).map((candidateQuery) => findAddressCandidates(candidateQuery, providerLimit)),
  );
  const seen = new Set<string>();
  return resultSets
    .flat()
    .filter((candidate) => (!intersectionQuery || candidate.attributes.Addr_type === "Cross Street")
      && Number.isFinite(candidate.location.y)
      && Number.isFinite(candidate.location.x))
    .filter((candidate) => {
      const key = `${candidate.location.y.toFixed(6)},${candidate.location.x.toFixed(6)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export async function reverseGeocodeNavigationCoordinates(lat: number, lng: number) {
  const apiKey = process.env.TOMTOM_API_KEY;
  if (!apiKey) throw new Error("TomTom Search is not configured.");
  const params = new URLSearchParams({ key: apiKey, language: "en-US" });
  const response = await fetch(
    `https://api.tomtom.com/search/2/reverseGeocode/${lat},${lng}.json?${params}`,
    {
      headers: { "User-Agent": "MonseyTrailsCoachDisplay/1.0 reverse geocode" },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) throw new Error(`TomTom Reverse Geocoding returned ${response.status}`);
  const body = await response.json() as {
    addresses?: Array<{
      address?: { freeformAddress?: string };
      position?: string;
    }>;
  };
  const match = body.addresses?.find(candidate => candidate.address?.freeformAddress);
  if (!match?.address?.freeformAddress) return null;
  return {
    address: match.address.freeformAddress,
    lat,
    lng,
    type: "coordinates",
    score: 1,
  };
}

router.get("/trips/:code/address-suggestions", async (req, res): Promise<void> => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length < 3 || query.length > 120) {
    res.status(400).json({ error: "Enter at least 3 characters to search for an address." });
    return;
  }
  try {
    const results = await geocodeNavigationQuery(query, 5);
    res.json(results.map((result, index) => ({
      id: `navigation-${result.location.y}-${result.location.x}-${index}`,
      label: result.address,
      lat: result.location.y,
      lng: result.location.x,
      type: result.attributes.Addr_type,
    })));
  } catch (error) {
    req.log.warn({ err: error }, "address suggestion lookup failed");
    res.status(502).json({ error: "Address suggestions are temporarily unavailable." });
  }
});

router.post("/trips/:code/resolve", (_req, res): void => {
  res.status(403).json({
    error: "Only dispatch can assign a coach destination and published schedule.",
    code: "ADMIN_DISPATCH_REQUIRED",
  });
});

router.put("/trips/:code/route-plan", (_req, res): void => {
  res.status(403).json({
    error: "Only dispatch can assign or change a coach's published schedule.",
    code: "ADMIN_DISPATCH_REQUIRED",
  });
});

router.delete("/trips/:code/route-plan", async (_req, res): Promise<void> => {
  res.status(403).json({
    error: "Only dispatch can release a coach's published schedule.",
    code: "ADMIN_DISPATCH_REQUIRED",
  });
});

router.post("/trips/:code/start", async (req, res): Promise<void> => {
  const row = await findTrip(res.locals.pairingCode);
  const { lat, lng } = req.body ?? {};
  const hasLocation = lat !== undefined || lng !== undefined;
  if (!row || !row.officialRunKey || !row.scheduledDepartureAt
      || row.destinationLat === null || row.destinationLng === null) {
    res.status(400).json({ error: "A dispatch-assigned published schedule is required before starting." });
    return;
  }
  if (hasLocation && (!validCoordinate(lat, -90, 90) || !validCoordinate(lng, -180, 180))) {
    res.status(400).json({ error: "Invalid GPS position." });
    return;
  }
  if (row.completedAt || row.status === "stopped") {
    res.status(409).json({ error: "Assign a new route before starting another trip." });
    return;
  }
  const locationObservedAt = new Date();
  invalidateTripNavigationCache(res.locals.pairingCode);
  const now = new Date();
  try {
    const intermediateStops = row.intermediateStops.map((stop) => {
      const { eta: _eta, ...withoutEta } = stop;
      return withoutEta;
    });
    const updated = await updateTrip(res.locals.pairingCode, {
      status: "running",
      originLat: hasLocation ? lat : null,
      originLng: hasLocation ? lng : null,
      currentLat: hasLocation ? lat : null,
      currentLng: hasLocation ? lng : null,
      locationUpdatedAt: hasLocation ? locationObservedAt : null,
      speedMph: null,
      totalDistanceMiles: null,
      remainingDistanceMiles: null,
      routeGeometry: [],
      eta: null,
      intermediateStops,
      startedAt: now,
      scheduledDepartureAt: row.scheduledDepartureAt,
    });
    res.json(rowToTrip(updated));
    if (hasLocation) {
      void refreshPersistedRoadRoute(
        res.locals.pairingCode,
        locationObservedAt,
        [
          { lat, lng },
          ...intermediateStops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
          { lat: row.destinationLat, lng: row.destinationLng },
        ],
        intermediateStops,
        true,
      ).catch((error) => req.log.warn({ err: error }, "trip started without an initial road route"));
    }
    void deliverPassengerAlerts(res.locals.pairingCode, updated, req.log)
      .catch((error) => req.log.error({ err: error }, "passenger alert delivery failed"));
  } catch (error) {
    req.log.error({ err: error }, "trip start persistence failed");
    const status = Number((error as { status?: number }).status) || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : "The trip could not be started." });
  }
});

router.post("/trips/:code/location", async (req, res): Promise<void> => {
  const row = await findTrip(res.locals.pairingCode);
  const { lat, lng, speedMph } = req.body ?? {};
  if (!row || row.status !== "running" || row.destinationLat === null || row.destinationLng === null) {
    res.status(409).json({ error: "No trip is currently running." });
    return;
  }
  if (!validCoordinate(lat, -90, 90) || !validCoordinate(lng, -180, 180)) {
    res.status(400).json({ error: "Invalid GPS position." });
    return;
  }
  const locationObservedAt = new Date();
  try {
    const [updated] = await db.update(liveTripsTable).set({
      currentLat: lat,
      currentLng: lng,
      locationUpdatedAt: locationObservedAt,
      speedMph: typeof speedMph === "number" && Number.isFinite(speedMph) ? Math.max(0, speedMph) : null,
      updatedAt: new Date(),
    }).where(and(
      eq(liveTripsTable.pairingCode, res.locals.pairingCode),
      eq(liveTripsTable.ownerSubject, res.locals.driverSubject),
      eq(liveTripsTable.status, "running"),
      isNull(liveTripsTable.completedAt),
      isNull(liveTripsTable.retiredAt),
    )).returning();
    if (!updated) {
      res.status(409).json({ error: "No trip is currently running." });
      return;
    }
    res.json(rowToTrip(updated));
    void refreshPersistedRoadRoute(
      res.locals.pairingCode,
      locationObservedAt,
      [
        { lat, lng },
        ...row.intermediateStops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
        { lat: row.destinationLat, lng: row.destinationLng },
      ],
      row.intermediateStops,
      false,
    ).catch((error) => req.log.warn({ err: error }, "live route refresh failed"));
    // Fire-and-forget: neither web nor native passenger push delivery may delay the driver's
    // live location update response.
    void sendApproachingStopAlerts(updated).catch((error) => {
      req.log.warn({ err: error }, "passenger stop push failed");
    });
    void deliverPassengerAlerts(res.locals.pairingCode, updated, req.log)
      .catch((error) => req.log.error({ err: error }, "passenger alert delivery failed"));
  } catch (error) {
    req.log.error({ err: error }, "live location persistence failed");
    const status = Number((error as { status?: number }).status) || 500;
    res.status(status).json({ error: error instanceof Error ? error.message : "The location could not be published." });
  }
});

router.post("/trips/:code/arrive", async (_req, res): Promise<void> => {
  const expectedStopIdentity = typeof _req.body?.expectedStopIdentity === "string"
    ? _req.body.expectedStopIdentity
    : "";
  const expectedStartedAt = typeof _req.body?.expectedStartedAt === "string"
    ? _req.body.expectedStartedAt
    : "";
  if (!expectedStopIdentity || expectedStopIdentity.length > 160 || !expectedStartedAt) {
    res.status(400).json({ error: "Arrival requires the current trip and stop identity." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [row] = await tx.select()
      .from(liveTripsTable)
      .where(eq(liveTripsTable.pairingCode, res.locals.pairingCode))
      .limit(1)
      .for("update");
    if (!row || row.status !== "running"
      || !ownsTrip(row.ownerSubject, res.locals.driverSubject)) return { kind: "not-running" } as const;

    const currentStop = row.intermediateStops[0];
    const currentStopIdentity = currentStop?.id
      ?? (row.destinationLat !== null && row.destinationLng !== null
        ? `${row.destinationLat}:${row.destinationLng}`
        : "");
    if (
      currentStopIdentity !== expectedStopIdentity
      || row.startedAt?.toISOString() !== expectedStartedAt
    ) {
      return { kind: "stale" } as const;
    }

    if (currentStop) {
      const intermediateStops = row.intermediateStops.slice(1);
      const [updated] = await tx.update(liveTripsTable)
        .set({
          intermediateStops,
          remainingDistanceMiles: null,
          eta: null,
          updatedAt: new Date(),
        })
        .where(eq(liveTripsTable.pairingCode, row.pairingCode))
        .returning();
      return {
        kind: "arrived" as const,
        body: {
          trip: rowToTrip(updated),
          arrivedAt: currentStop.address,
          nextDestination: intermediateStops[0]?.address ?? row.destinationAddress,
          tripComplete: false,
        },
      };
    }

    const [updated] = await tx.update(liveTripsTable)
      .set({
        status: "stopped",
        completedAt: new Date(),
        destinationAddress: "",
        destinationLat: null,
        destinationLng: null,
        intermediateStops: [],
        routeGeometry: [],
        originLat: null,
        originLng: null,
        currentLat: null,
        currentLng: null,
        locationUpdatedAt: null,
        totalDistanceMiles: null,
        speedMph: 0,
        remainingDistanceMiles: null,
        eta: null,
        startedAt: null,
        displayMode: "auto",
        updatedAt: new Date(),
      })
      .where(eq(liveTripsTable.pairingCode, row.pairingCode))
      .returning();
    return {
      kind: "arrived" as const,
      body: {
        trip: rowToTrip(updated),
        arrivedAt: row.destinationAddress,
        nextDestination: null,
        tripComplete: true,
      },
    };
  });

  if (result.kind === "not-running") {
    res.status(409).json({ error: "No trip is currently running." });
    return;
  }
  if (result.kind === "stale") {
    res.status(409).json({ error: "This stop was already advanced by another operator screen." });
    return;
  }
  const arrivedRow = await findTrip(res.locals.pairingCode);
  if (arrivedRow) await expirePassengerAlerts(res.locals.pairingCode, {
    ...arrivedRow,
    status: result.body.trip.status,
  });
  if (arrivedRow) {
    void refreshPassengerLiveActivitiesForTrip(arrivedRow).catch(() => {
      logger.warn({ pairingCode: arrivedRow.pairingCode }, "passenger Live Activity arrival update failed");
    });
  }
  if (result.body.tripComplete) await finishActiveDispatchAssignment(res.locals.pairingCode, "completed");
  res.json(result.body);
});

router.post("/trips/:code/stop", async (_req, res): Promise<void> => {
  const updated = await stopActiveTrip(res.locals.pairingCode);
  res.json(rowToTrip(updated));
});

router.patch("/trips/:code/emergency", async (req, res): Promise<void> => {
  const emergencyOverride = req.body?.emergencyOverride;
  const emergencyMessage = typeof req.body?.emergencyMessage === "string" ? req.body.emergencyMessage.trim() : "";
  if (typeof emergencyOverride !== "boolean" || emergencyMessage.length < 1 || emergencyMessage.length > 500) {
    res.status(400).json({ error: "Provide an emergency status and a message up to 500 characters." });
    return;
  }
  const updated = await updateTrip(res.locals.pairingCode, {
    emergencyOverride,
    emergencyMessage,
  });
  res.json(rowToTrip(updated));
});

router.patch("/trips/:code/display-settings", async (req, res): Promise<void> => {
  const routeId = typeof req.body?.routeId === "string" ? req.body.routeId : "";
  const displayMode = typeof req.body?.displayMode === "string" ? req.body.displayMode as DisplayMode : "";
  const passengerLanguage = typeof req.body?.passengerLanguage === "string" ? req.body.passengerLanguage as PassengerLanguage : "";
  const rotationIntervalSeconds = req.body?.rotationIntervalSeconds;
  const arrivalSoundsEnabled = req.body?.arrivalSoundsEnabled;

  if (
    !ROUTE_IDS.has(routeId)
    || !DISPLAY_MODES.has(displayMode as DisplayMode)
    || !PASSENGER_LANGUAGES.has(passengerLanguage as PassengerLanguage)
    || typeof rotationIntervalSeconds !== "number"
    || !Number.isFinite(rotationIntervalSeconds)
    || rotationIntervalSeconds < 5
    || rotationIntervalSeconds > 300
    || typeof arrivalSoundsEnabled !== "boolean"
  ) {
    res.status(400).json({ error: "Provide a valid route, display mode, passenger language, rotation interval, and arrival sound setting." });
    return;
  }
  const updated = await updateTrip(res.locals.pairingCode, {
    routeId,
    displayMode,
    passengerLanguage,
    rotationIntervalSeconds,
    arrivalSoundsEnabled,
  });
  res.json(rowToTrip(updated));
});

router.patch("/trips/:code/announcements", async (req, res): Promise<void> => {
  const announcements = req.body?.announcements;
  const validAnnouncements = Array.isArray(announcements)
    && announcements.length <= 20
    && announcements.every((announcement: unknown) => {
      if (!announcement || typeof announcement !== "object") return false;
      const value = announcement as Record<string, unknown>;
      return typeof value.id === "string"
        && value.id.length >= 1
        && value.id.length <= 100
        && typeof value.title === "string"
        && value.title.trim().length >= 1
        && value.title.length <= 100
        && typeof value.message === "string"
        && value.message.trim().length >= 1
        && value.message.length <= 500
        && typeof value.active === "boolean";
    })
    && new Set(announcements.map((announcement: StoredAnnouncement) => announcement.id)).size === announcements.length;

  if (!validAnnouncements) {
    res.status(400).json({ error: "Provide up to 20 announcements with a title and message." });
    return;
  }

  const normalized = announcements.map((announcement: StoredAnnouncement) => ({
    id: announcement.id,
    title: announcement.title.trim(),
    message: announcement.message.trim(),
    active: announcement.active,
  }));
  const updated = await updateTrip(res.locals.pairingCode, { announcements: normalized });
  res.json(rowToTrip(updated));
});

export default router;