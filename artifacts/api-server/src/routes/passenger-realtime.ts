import { createHash, randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { CreatePassengerRealtimeSubscriptionBody } from "@workspace/api-zod";
import {
  db,
  liveTripsTable,
  passengerRealtimeDeliveriesTable,
  passengerRealtimeSubscriptionsTable,
  type PassengerRealtimeFlow,
} from "@workspace/db";
import { isExpoPushToken } from "./passenger-alerts";
import { assessPublishedTransfer, parseExactRunKey } from "./passenger-transfers";
import {
  buildPassengerJourney,
  findExactLiveRun,
  resolveEquivalentOfficialRunKeys,
  resolveVerifiedOfficialRun,
} from "./schedule";
import { startPassengerRealtimePushRetryScheduler } from "../lib/passenger-realtime";

const router: IRouter = Router();
router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
const CAPABILITY_HEADER = "x-passenger-realtime-capability";
const FLOW_VALUES = ["disruption", "approaching-pickup", "transfer-risk"] as const;

function ownerCapability(req: { get(name: string): string | undefined }) {
  const value = req.get(CAPABILITY_HEADER)?.trim() ?? "";
  return /^[A-Za-z0-9_-]{43,128}$/.test(value) ? value : null;
}

function capabilityHash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function publicSubscription(row: typeof passengerRealtimeSubscriptionsTable.$inferSelect) {
  return {
    id: row.id,
    flow: row.flow,
    deviceId: row.deviceId,
    officialRunKey: row.officialRunKey,
    selectedStopId: row.selectedStopId || null,
    onwardRunKey: row.onwardRunKey || null,
    transferAreaId: row.transferAreaId,
    minimumBufferMinutes: row.minimumBufferMinutes,
    active: row.active,
    lastConnectionStatus: row.lastConnectionStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type ParsedInput = {
  flow: PassengerRealtimeFlow;
  passengerCode: string;
  deviceId: string;
  expoPushToken: string;
  soundEnabled: boolean;
  runKey: string;
  selectedStopId: string;
  onwardRunKey: string;
  transferAreaId: number | null;
  minimumBufferMinutes: number | null;
};

function parseInput(value: unknown): ParsedInput | null {
  const parsed = CreatePassengerRealtimeSubscriptionBody.safeParse(value);
  if (!parsed.success) return null;
  const body = parsed.data;
  const flow = body.flow as PassengerRealtimeFlow;
  const passengerCode = body.passengerCode.trim();
  const deviceId = body.deviceId.trim();
  const expoPushToken = body.expoPushToken;
  const runKey = body.runKey.trim();
  const selectedStopId = body.selectedStopId?.trim() ?? "";
  const onwardRunKey = body.onwardRunKey?.trim() ?? "";
  const transferAreaId = body.transferAreaId ?? null;
  const minimumBufferMinutes = body.minimumBufferMinutes ?? null;
  const soundEnabled = body.soundEnabled;
  if (
    !FLOW_VALUES.includes(flow)
    || !/^\d{4}$/.test(passengerCode)
    || !/^[A-Za-z0-9_.:-]{1,160}$/.test(deviceId)
    || !isExpoPushToken(expoPushToken)
    || !/^\d{4}-\d{2}-\d{2}\|[123]\|\d{1,2}\|\d{1,2}\|[^|]{1,80}$/.test(runKey)
    || runKey.length > 180
    || typeof soundEnabled !== "boolean"
    || (flow === "approaching-pickup" && (!selectedStopId || selectedStopId.length > 100))
    || (flow === "transfer-risk" && (!selectedStopId || selectedStopId.length > 100))
    || (flow === "disruption" && selectedStopId)
    || (flow === "transfer-risk" && (
      !onwardRunKey || onwardRunKey.length > 180
      || !Number.isInteger(transferAreaId) || transferAreaId! < 1
      || !Number.isInteger(minimumBufferMinutes) || minimumBufferMinutes! < 5 || minimumBufferMinutes! > 120
    ))
    || (flow !== "transfer-risk" && (onwardRunKey || transferAreaId !== null || minimumBufferMinutes !== null))
  ) return null;
  return {
    flow, passengerCode, deviceId, expoPushToken, soundEnabled, runKey, selectedStopId,
    onwardRunKey, transferAreaId, minimumBufferMinutes,
  };
}

async function validateRunSelection(input: ParsedInput) {
  const [passengerTrip] = await db.select().from(liveTripsTable).where(and(
    eq(liveTripsTable.passengerPairingCode, input.passengerCode),
    isNull(liveTripsTable.retiredAt),
  )).limit(1);
  if (!passengerTrip || passengerTrip.status !== "running" || !passengerTrip.officialRunKey) {
    return { error: "Realtime alerts require your active running trip." } as const;
  }
  const requestedKeys = await resolveEquivalentOfficialRunKeys(input.runKey);
  if (!requestedKeys.includes(passengerTrip.officialRunKey)) {
    return { error: "The selected run is not the active trip paired to this passenger code." } as const;
  }
  const parsed = parseExactRunKey(input.runKey);
  if (!parsed) return { error: "Choose an exact published run." } as const;
  const incoming = await resolveVerifiedOfficialRun(parsed, parsed.runId);
  const canonicalKeys = await resolveEquivalentOfficialRunKeys(incoming.runKey);
  if (!canonicalKeys.includes(passengerTrip.officialRunKey)) {
    return { error: "The selected published run does not match the active trip." } as const;
  }
  let lastConnectionStatus: string | null = null;
  if (input.flow === "approaching-pickup") {
    const selected = passengerTrip.intermediateStops.some(stop => stop.id === input.selectedStopId);
    if (!selected) return { error: "Choose an upcoming pickup on your active trip." } as const;
    if (!incoming.stops.some(stop => stop.id === input.selectedStopId && stop.kind === "pickup")) {
      return { error: "Approaching alerts are available for verified pickup stops only." } as const;
    }
  }
  if (input.flow === "transfer-risk") {
    const onwardParsed = parseExactRunKey(input.onwardRunKey);
    if (!onwardParsed || onwardParsed.date === "" || input.transferAreaId !== parsed.destination) {
      return { error: "Choose an exact verified connection at the incoming run's destination." } as const;
    }
    const onward = await resolveVerifiedOfficialRun(onwardParsed, onwardParsed.runId);
    if (incoming.arrivalVerification !== "verified" || onward.arrivalVerification !== "verified") {
      return { error: "Both selected runs must have verified published arrival and departure times." } as const;
    }
    const exactIncoming = await findExactLiveRun(canonicalKeys);
    if (!exactIncoming || exactIncoming.pairingCode !== passengerTrip.pairingCode) {
      return { error: "The incoming exact run is no longer actively assigned to this trip." } as const;
    }
    const journey = await buildPassengerJourney(incoming, passengerTrip);
    const assessment = assessPublishedTransfer({
      incoming,
      onward,
      incomingJourney: journey,
      transferAreaId: input.transferAreaId,
      minimumBufferMinutes: input.minimumBufferMinutes!,
    });
    if (!assessment || assessment.sharedStop.id !== input.selectedStopId) {
      return { error: "The selected stop is not the verified shared transfer stop for those exact runs." } as const;
    }
    lastConnectionStatus = assessment.connectionStatus;
  }
  return {
    passengerTrip,
    officialRunKey: passengerTrip.officialRunKey,
    lastConnectionStatus,
  } as const;
}

async function saveSubscription(
  input: ParsedInput,
  ownerHash: string,
  existingId?: string,
) {
  const validated = await validateRunSelection(input);
  if ("error" in validated) return { error: validated.error } as const;
  const now = new Date();
  const values = {
    flow: input.flow,
    deviceId: input.deviceId,
    ownerCapabilityHash: ownerHash,
    passengerCode: input.passengerCode,
    operatorPairingCode: validated.passengerTrip.pairingCode,
    officialRunKey: validated.officialRunKey,
    selectedStopId: input.selectedStopId,
    onwardRunKey: input.onwardRunKey,
    transferAreaId: input.transferAreaId,
    minimumBufferMinutes: input.minimumBufferMinutes,
    expoPushToken: input.expoPushToken,
    soundEnabled: input.soundEnabled,
    active: true,
    lastConnectionStatus: validated.lastConnectionStatus,
    lastTransferAlertAt: null,
    updatedAt: now,
  };
  if (existingId) {
    const [updated] = await db.update(passengerRealtimeSubscriptionsTable).set({
      ...values,
      ...(input.flow === "approaching-pickup" ? {
        pickupAlertGeneration: sql`${passengerRealtimeSubscriptionsTable.pickupAlertGeneration} + 1`,
      } : {}),
    }).where(and(
      eq(passengerRealtimeSubscriptionsTable.id, existingId),
      eq(passengerRealtimeSubscriptionsTable.deviceId, input.deviceId),
      eq(passengerRealtimeSubscriptionsTable.ownerCapabilityHash, ownerHash),
    )).returning();
    return updated ? { subscription: updated } as const : { error: "Subscription not found." } as const;
  }
  const saved = await insertOrRefreshPassengerRealtimeSubscription({
    id: randomUUID(), ...values,
  });
  return { subscription: saved } as const;
}

export async function insertOrRefreshPassengerRealtimeSubscription(
  insertValues: typeof passengerRealtimeSubscriptionsTable.$inferInsert,
) {
  // POST may refresh credentials and preferences, but only PUT is an explicit re-opt-in.
  const [saved] = await db.insert(passengerRealtimeSubscriptionsTable).values(insertValues).onConflictDoUpdate({
    target: [
      passengerRealtimeSubscriptionsTable.deviceId,
      passengerRealtimeSubscriptionsTable.ownerCapabilityHash,
      passengerRealtimeSubscriptionsTable.flow,
      passengerRealtimeSubscriptionsTable.officialRunKey,
      passengerRealtimeSubscriptionsTable.selectedStopId,
      passengerRealtimeSubscriptionsTable.onwardRunKey,
    ],
    set: {
      passengerCode: insertValues.passengerCode,
      expoPushToken: insertValues.expoPushToken,
      soundEnabled: insertValues.soundEnabled,
      updatedAt: insertValues.updatedAt,
    },
  }).returning();
  return saved;
}

router.get("/passenger/realtime-subscriptions", async (req, res): Promise<void> => {
  const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId.trim() : "";
  const capability = ownerCapability(req);
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(deviceId) || !capability) {
    res.status(400).json({ error: "A valid installation identity is required." });
    return;
  }
  const rows = await db.select().from(passengerRealtimeSubscriptionsTable).where(and(
    eq(passengerRealtimeSubscriptionsTable.deviceId, deviceId),
    eq(passengerRealtimeSubscriptionsTable.ownerCapabilityHash, capabilityHash(capability)),
  )).orderBy(desc(passengerRealtimeSubscriptionsTable.createdAt));
  res.json({ subscriptions: rows.map(publicSubscription) });
});

router.post("/passenger/realtime-subscriptions", async (req, res): Promise<void> => {
  const input = parseInput(req.body);
  const capability = ownerCapability(req);
  if (!input || !capability) {
    res.status(400).json({ error: "Choose a valid installation, Expo token, active exact run, and flow-specific stop or connection." });
    return;
  }
  try {
    const result = await saveSubscription(input, capabilityHash(capability));
    if ("error" in result) {
      res.status(409).json({ error: result.error });
      return;
    }
    res.status(201).json({ subscription: publicSubscription(result.subscription) });
  } catch (error) {
    req.log.warn({ err: error }, "passenger realtime subscription validation failed");
    res.status(502).json({ error: "The exact published run could not be verified. No subscription was created." });
  }
});

router.put("/passenger/realtime-subscriptions/:id", async (req, res): Promise<void> => {
  const input = parseInput(req.body);
  const capability = ownerCapability(req);
  const id = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !input || !capability) {
    res.status(400).json({ error: "Choose a valid subscription, installation, active exact run, and flow-specific details." });
    return;
  }
  try {
    const result = await saveSubscription(input, capabilityHash(capability), id);
    if ("error" in result) {
      res.status(result.error === "Subscription not found." ? 404 : 409).json({ error: result.error });
      return;
    }
    await db.update(passengerRealtimeDeliveriesTable).set({
      state: "failed", lastError: "The subscription was updated before delivery.", updatedAt: new Date(),
    }).where(and(
      eq(passengerRealtimeDeliveriesTable.subscriptionId, id),
      inArray(passengerRealtimeDeliveriesTable.state, ["pending", "sending", "receipt_pending"]),
    ));
    res.json({ subscription: publicSubscription(result.subscription) });
  } catch (error) {
    req.log.warn({ err: error, subscriptionId: id }, "passenger realtime subscription update failed");
    res.status(502).json({ error: "The exact published run could not be verified. The subscription was not changed." });
  }
});

router.delete("/passenger/realtime-subscriptions/:id", async (req, res): Promise<void> => {
  const capability = ownerCapability(req);
  const id = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !capability) {
    res.status(400).json({ error: "A valid subscription and installation identity are required." });
    return;
  }
  const [cancelled] = await db.update(passengerRealtimeSubscriptionsTable).set({
    active: false, updatedAt: new Date(),
  }).where(and(
    eq(passengerRealtimeSubscriptionsTable.id, id),
    eq(passengerRealtimeSubscriptionsTable.ownerCapabilityHash, capabilityHash(capability)),
  )).returning({ id: passengerRealtimeSubscriptionsTable.id });
  if (!cancelled) {
    res.status(404).json({ error: "Subscription not found." });
    return;
  }
  await db.update(passengerRealtimeDeliveriesTable).set({
    state: "failed", lastError: "Subscription was cancelled.", updatedAt: new Date(),
  }).where(and(
    eq(passengerRealtimeDeliveriesTable.subscriptionId, id),
    inArray(passengerRealtimeDeliveriesTable.state, ["pending", "sending", "receipt_pending"]),
  ));
  res.status(204).end();
});

startPassengerRealtimePushRetryScheduler();

export { capabilityHash as passengerRealtimeCapabilityHash, parseInput as parsePassengerRealtimeInput };
export default router;