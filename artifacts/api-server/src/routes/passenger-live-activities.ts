import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  EndPassengerLiveActivityParams,
  GetPassengerLiveActivityAvailabilityResponse,
  RegisterPassengerLiveActivityBody,
  RegisterPassengerLiveActivityResponse,
  UpdatePassengerLiveActivityTokenBody,
  UpdatePassengerLiveActivityTokenParams,
  UpdatePassengerLiveActivityTokenResponse,
} from "@workspace/api-zod";
import { db, liveTripsTable, passengerLiveActivitiesTable } from "@workspace/db";
import { passengerRealtimeCapabilityHash } from "./passenger-realtime";
import {
  exceedsPassengerLiveActivityRegistrationLimits,
  MAX_ACTIVE_LIVE_ACTIVITIES_PER_INSTALLATION,
  MAX_ACTIVE_LIVE_ACTIVITIES_PER_INSTALLATION_TRIP,
  MAX_ACTIVE_LIVE_ACTIVITIES_PER_TRIP,
  passengerLiveActivityRegistrationAttemptAllowed,
  recordPassengerLiveActivityRegistrationFailure,
} from "../lib/passenger-live-activity-registration-guard";
import {
  apnsConfigurationAvailable,
  endPassengerLiveActivityById,
  isLiveActivityPushToken,
  refreshPassengerLiveActivitiesForTrip,
  startPassengerLiveActivityScheduler,
  validateLiveActivityRun,
} from "../lib/passenger-live-activities";

const router: IRouter = Router();
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
const CAPABILITY_HEADER = "x-passenger-realtime-capability";
startPassengerLiveActivityScheduler();

function readCapability(req: { get(name: string): string | undefined }) {
  const value = req.get(CAPABILITY_HEADER)?.trim() ?? "";
  return /^[A-Za-z0-9_-]{43,128}$/.test(value) ? value : null;
}

function parseId(value: string | string[] | undefined) {
  const id = Array.isArray(value) ? value[0] : value;
  return typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

router.get("/passenger/live-activities/availability", (_req, res): void => {
  res.json(GetPassengerLiveActivityAvailabilityResponse.parse({ available: apnsConfigurationAvailable() }));
});

router.post("/passenger/live-activities", async (req, res): Promise<void> => {
  const body = RegisterPassengerLiveActivityBody.safeParse(req.body);
  const capability = readCapability(req);
  const ownerHash = capability ? passengerRealtimeCapabilityHash(capability) : null;
  const clientIp = req.ip || "unknown";
  const reject = (status: number, error: string) => {
    recordPassengerLiveActivityRegistrationFailure(clientIp, ownerHash);
    res.status(status).json({ error });
  };
  if (!passengerLiveActivityRegistrationAttemptAllowed(clientIp, ownerHash)) {
    res.status(429).json({ error: "Too many failed Live Activity registration attempts. Try again later." });
    return;
  }
  if (!body.success || !capability || !ownerHash) {
    reject(400, "A valid installation capability and Live Activity registration are required.");
    return;
  }
  if (body.data.pushToken && !isLiveActivityPushToken(body.data.pushToken)) {
    reject(400, "A valid APNs Live Activity push token is required.");
    return;
  }
  try {
    const checked = await validateLiveActivityRun(
      body.data.passengerCode,
      body.data.runKey,
      body.data.pickupStopId,
      body.data.dropoffStopId,
    );
    if ("error" in checked) {
      reject(409, checked.error ?? "The selected published run could not be verified.");
      return;
    }
    const id = randomUUID();
    const registration = await db.transaction(async tx => {
      const locks = [`installation:${ownerHash}`, `trip:${checked.trip.pairingCode}`].sort();
      for (const lock of locks) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lock}))`);

      const [existing] = await tx.select().from(passengerLiveActivitiesTable).where(and(
        eq(passengerLiveActivitiesTable.ownerCapabilityHash, ownerHash),
        eq(passengerLiveActivitiesTable.clientActivityId, body.data.clientActivityId),
      )).limit(1);
      if (existing) {
        if (existing.passengerCode !== body.data.passengerCode
            || existing.operatorPairingCode !== checked.trip.pairingCode
            || existing.officialRunKey !== body.data.runKey
            || existing.pickupStopId !== body.data.pickupStopId
            || existing.dropoffStopId !== body.data.dropoffStopId
            || !existing.active || existing.phase === "ended") {
          return { kind: "conflict" as const };
        }
        await tx.update(passengerLiveActivitiesTable).set({
          pushToken: body.data.pushToken ?? existing.pushToken,
          updatedAt: new Date(),
        }).where(eq(passengerLiveActivitiesTable.id, existing.id));
        return { kind: "registered" as const, id: existing.id, created: false };
      }

      const installationActivities = await tx.select({ id: passengerLiveActivitiesTable.id })
        .from(passengerLiveActivitiesTable).where(and(
          eq(passengerLiveActivitiesTable.ownerCapabilityHash, ownerHash),
          eq(passengerLiveActivitiesTable.active, true),
        ));
      const installationTripActivities = await tx.select({ id: passengerLiveActivitiesTable.id })
        .from(passengerLiveActivitiesTable).where(and(
          eq(passengerLiveActivitiesTable.ownerCapabilityHash, ownerHash),
          eq(passengerLiveActivitiesTable.operatorPairingCode, checked.trip.pairingCode),
          eq(passengerLiveActivitiesTable.active, true),
        ));
      const tripActivities = await tx.select({ id: passengerLiveActivitiesTable.id })
        .from(passengerLiveActivitiesTable).where(and(
          eq(passengerLiveActivitiesTable.operatorPairingCode, checked.trip.pairingCode),
          eq(passengerLiveActivitiesTable.active, true),
        ));
      if (exceedsPassengerLiveActivityRegistrationLimits({
        installation: installationActivities.length,
        installationTrip: installationTripActivities.length,
        trip: tripActivities.length,
      })) return { kind: "limit" as const };

      await tx.insert(passengerLiveActivitiesTable).values({
        id,
        clientActivityId: body.data.clientActivityId,
        ownerCapabilityHash: ownerHash,
        passengerCode: body.data.passengerCode,
        operatorPairingCode: checked.trip.pairingCode,
        officialRunKey: checked.trip.officialRunKey!,
        pickupStopId: checked.pickup.id,
        dropoffStopId: checked.dropoff.id,
        pickupStopName: checked.pickup.address ?? checked.pickup.label,
        dropoffStopName: checked.dropoff.address ?? checked.dropoff.label,
        pickupStopLat: checked.pickup.lat,
        pickupStopLng: checked.pickup.lng,
        dropoffStopLat: checked.dropoff.lat,
        dropoffStopLng: checked.dropoff.lng,
        lineName: checked.official.routeCode,
        coachNumber: checked.trip.pairingCode,
        pushToken: body.data.pushToken ?? null,
      });
      return { kind: "registered" as const, id, created: true };
    });
    if (registration.kind === "conflict") {
      reject(409, "This client activity identifier is ended or bound to another trip.");
      return;
    }
    if (registration.kind === "limit") {
      reject(429, `Live Activity registration limits are ${MAX_ACTIVE_LIVE_ACTIVITIES_PER_INSTALLATION} per installation, ${MAX_ACTIVE_LIVE_ACTIVITIES_PER_INSTALLATION_TRIP} per installation and trip, and ${MAX_ACTIVE_LIVE_ACTIVITIES_PER_TRIP} per trip.`);
      return;
    }
    res.status(201).json(RegisterPassengerLiveActivityResponse.parse({ id: registration.id }));
    if (!registration.created) return;
    void refreshPassengerLiveActivitiesForTrip(checked.trip)
      .catch(() => req.log.warn({ activityId: id }, "initial passenger Live Activity update failed"));
  } catch {
    req.log.warn("passenger Live Activity registration validation failed");
    reject(502, "The exact assigned published run could not be verified.");
  }
});

router.patch("/passenger/live-activities/:id", async (req, res): Promise<void> => {
  const params = UpdatePassengerLiveActivityTokenParams.safeParse(req.params);
  const body = UpdatePassengerLiveActivityTokenBody.safeParse(req.body);
  const capability = readCapability(req);
  const id = parseId(req.params.id);
  if (!params.success || !body.success || !capability || !id || !isLiveActivityPushToken(body.data.pushToken)) {
    res.status(400).json({ error: "A valid activity identifier, installation capability, and APNs token are required." });
    return;
  }
  const [activity] = await db.update(passengerLiveActivitiesTable).set({
    pushToken: body.data.pushToken,
    updatedAt: new Date(),
  }).where(and(
    eq(passengerLiveActivitiesTable.id, id),
    eq(passengerLiveActivitiesTable.ownerCapabilityHash, passengerRealtimeCapabilityHash(capability)),
    eq(passengerLiveActivitiesTable.active, true),
  )).returning();
  if (!activity) {
    res.status(404).json({ error: "Live Activity not found for this installation." });
    return;
  }
  res.json(UpdatePassengerLiveActivityTokenResponse.parse({ id: activity.id }));
  const [trip] = await db.select().from(liveTripsTable).where(and(
    eq(liveTripsTable.pairingCode, activity.operatorPairingCode),
    eq(liveTripsTable.passengerPairingCode, activity.passengerCode),
    eq(liveTripsTable.officialRunKey, activity.officialRunKey),
    isNull(liveTripsTable.retiredAt),
  )).limit(1);
  if (trip) {
    void refreshPassengerLiveActivitiesForTrip(trip)
      .catch(() => req.log.warn({ activityId: id }, "passenger Live Activity token refresh failed"));
  }
});

router.delete("/passenger/live-activities/:id", async (req, res): Promise<void> => {
  const params = EndPassengerLiveActivityParams.safeParse(req.params);
  const capability = readCapability(req);
  const id = parseId(req.params.id);
  if (!params.success || !capability || !id) {
    res.status(400).json({ error: "A valid activity identifier and installation capability are required." });
    return;
  }
  const [activity] = await db.select().from(passengerLiveActivitiesTable).where(and(
    eq(passengerLiveActivitiesTable.id, id),
    eq(passengerLiveActivitiesTable.ownerCapabilityHash, passengerRealtimeCapabilityHash(capability)),
    eq(passengerLiveActivitiesTable.active, true),
  )).limit(1);
  if (!activity) {
    res.status(404).json({ error: "Live Activity not found for this installation." });
    return;
  }
  void endPassengerLiveActivityById(activity.id).catch(() => {
    req.log.warn({ activityId: id }, "passenger Live Activity end request failed");
  });
  res.status(204).end();
});

export default router;