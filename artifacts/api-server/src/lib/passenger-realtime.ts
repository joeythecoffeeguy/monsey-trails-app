import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import {
  db,
  liveTripsTable,
  passengerRealtimeDeliveriesTable,
  passengerRealtimeSubscriptionsTable,
  serviceDisruptionsTable,
  type PassengerRealtimeDeliveryRow,
  type LiveTripRow,
  type PassengerRealtimeSubscriptionRow,
} from "@workspace/db";
import { assessPublishedTransfer, parseExactRunKey } from "../routes/passenger-transfers";
import {
  buildPassengerJourney,
  findExactLiveRun,
  resolveEquivalentOfficialRunKeys,
  resolveVerifiedOfficialRun,
} from "../routes/schedule";
import { logger } from "./logger";

export const REALTIME_PUSH_TIMEOUT_MS = 8_000;
export const REALTIME_SEND_LEASE_MS = 30_000;
const REALTIME_RETRY_INTERVAL_MS = 5 * 60_000;
export const TRANSFER_ALERT_COOLDOWN_MS = 2 * 60_000;
export const TRANSFER_ALERT_HYSTERESIS_MINUTES = 2;
const MAX_PROVIDER_ATTEMPTS = 5;
const MAX_RECEIPT_ATTEMPTS = 6;
const RECEIPT_INITIAL_DELAY_MS = 15_000;

type RealtimePushPayload = { title: string; body: string; screen: string; soundEnabled?: boolean };

async function pushExpoToken(token: string, payload: RealtimePushPayload, subscriptionId: string, eventKey: string) {
  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      to: token,
      title: payload.title,
      body: payload.body,
      collapseId: createHash("sha256").update(eventKey).digest("hex"),
      sound: payload.soundEnabled === false ? null : "default",
      channelId: "passenger-realtime",
      data: { screen: payload.screen, subscriptionId, eventKey },
    }),
    signal: AbortSignal.timeout(REALTIME_PUSH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Expo Push API returned ${response.status}`);
  const ticketResponse = await response.json() as {
    data?: { id?: string; status?: string; details?: { error?: string }; message?: string }
      | Array<{ id?: string; status?: string; details?: { error?: string }; message?: string }>;
  };
  const ticket = Array.isArray(ticketResponse.data) ? ticketResponse.data[0] : ticketResponse.data;
  if (ticket?.status !== "ok") {
    const providerError = ticket?.details?.error ?? ticket?.message ?? "Expo Push ticket was not accepted";
    throw Object.assign(new Error(`Expo Push ticket failed: ${providerError}`), {
      permanent: providerError === "DeviceNotRegistered",
      invalidToken: providerError === "DeviceNotRegistered",
    });
  }
  if (!ticket.id) throw Object.assign(new Error("Expo accepted the push without a ticket ID; receipt tracking is unavailable"), { permanent: true });
  return ticket.id;
}

async function revalidateRealtimeEvent(subscriptionId: string, eventKey: string, now = new Date()) {
  const [subscription] = await db.select().from(passengerRealtimeSubscriptionsTable)
    .where(eq(passengerRealtimeSubscriptionsTable.id, subscriptionId)).limit(1);
  if (!subscription?.active) return null;
  const [trip] = await db.select().from(liveTripsTable).where(and(
    eq(liveTripsTable.pairingCode, subscription.operatorPairingCode),
    eq(liveTripsTable.passengerPairingCode, subscription.passengerCode),
    eq(liveTripsTable.officialRunKey, subscription.officialRunKey),
    eq(liveTripsTable.status, "running"),
    isNull(liveTripsTable.retiredAt),
  )).limit(1);
  if (!trip) return null;

  if (subscription.flow === "disruption") {
    const match = /^disruption:([^:]+):(created|updated|cleared):(.+)$/.exec(eventKey);
    if (!match) return null;
    const [, disruptionId, action, timestamp] = match;
    const [disruption] = await db.select().from(serviceDisruptionsTable)
      .where(eq(serviceDisruptionsTable.id, disruptionId)).limit(1);
    if (!disruption || disruption.officialRunKey !== subscription.officialRunKey
        || disruption.updatedAt.toISOString() !== timestamp) return null;
    const clearedEventIsCurrent = action === "cleared"
      && disruption.clearedAt !== null;
    const activeNoticeIsCurrent = action !== "cleared"
      && disruption.clearedAt === null
      && disruption.startsAt.getTime() <= now.getTime()
      && disruption.expiresAt.getTime() > now.getTime();
    if (!clearedEventIsCurrent && !activeNoticeIsCurrent) return null;
  } else if (subscription.flow === "approaching-pickup") {
    if (eventKey !== approachingPickupEventKey(subscription.id, subscription.pickupAlertGeneration)) return null;
    const stop = trip.intermediateStops.find(item => item.id === subscription.selectedStopId);
    const etaSeconds = stop?.eta ? (new Date(stop.eta).getTime() - now.getTime()) / 1000 : null;
    if (!stop || !approachingPickupThresholdReached(etaSeconds)) return null;
  } else if (subscription.flow === "transfer-risk") {
    const match = /^transfer-risk:([^:]+):([^:]+):([^:]+):(.+)$/.exec(eventKey);
    if (!match || match[1] !== subscription.id) return null;
    const previousStatus = match[2];
    const expectedStatus = match[3];
    const observedAt = match[4];
    const priorStatus = previousStatus === "initial" ? null : previousStatus;
    if (!["tight", "at_risk"].includes(expectedStatus)
        || !Number.isFinite(new Date(observedAt).getTime())
        || subscription.lastConnectionStatus !== expectedStatus
        || subscription.lastTransferAlertAt?.toISOString() !== observedAt) return null;
    const assessment = await freshVerifiedTransferAssessment(subscription, trip, now);
    if (!assessment || assessment.connectionStatus !== expectedStatus
        || !transferRiskHasHysteresis(
          priorStatus,
          expectedStatus,
          assessment.bufferMinutes,
          subscription.minimumBufferMinutes!,
        )) return null;
  }
  return { subscription, trip };
}

async function freshVerifiedTransferAssessment(
  subscription: PassengerRealtimeSubscriptionRow,
  trip: LiveTripRow,
  now: Date,
) {
  const incomingKey = parseExactRunKey(subscription.officialRunKey);
  const onwardKey = parseExactRunKey(subscription.onwardRunKey);
  if (!incomingKey || !onwardKey || subscription.transferAreaId === null
      || subscription.minimumBufferMinutes === null) return null;
  const [incoming, onward] = await Promise.all([
    resolveVerifiedOfficialRun(incomingKey, incomingKey.runId),
    resolveVerifiedOfficialRun(onwardKey, onwardKey.runId),
  ]);
  const equivalentKeys = await resolveEquivalentOfficialRunKeys(subscription.officialRunKey);
  const exactIncoming = await findExactLiveRun(equivalentKeys);
  if (!exactIncoming || exactIncoming.pairingCode !== trip.pairingCode
      || exactIncoming.passengerPairingCode !== subscription.passengerCode) return null;
  const journey = await buildPassengerJourney(incoming, trip, now.getTime());
  const trafficUpdatedAt = journey.trafficUpdatedAt ? new Date(journey.trafficUpdatedAt).getTime() : NaN;
  if (journey.trafficStatus !== "live"
      || !Number.isFinite(trafficUpdatedAt)
      || trafficUpdatedAt > now.getTime()
      || now.getTime() - trafficUpdatedAt > 90_000) return null;
  const assessment = assessPublishedTransfer({
    incoming,
    onward,
    incomingJourney: journey,
    transferAreaId: subscription.transferAreaId,
    minimumBufferMinutes: subscription.minimumBufferMinutes,
  });
  if (!assessment || assessment.sharedStop.id !== subscription.selectedStopId
      || assessment.arrivalBasis !== "live") return null;
  return assessment;
}

async function deliverClaimedPush(
  subscription: PassengerRealtimeSubscriptionRow,
  delivery: Pick<PassengerRealtimeDeliveryRow, "id" | "eventKey" | "attemptCount">,
  payload: RealtimePushPayload,
  log: { error: (obj: unknown, message: string) => void },
) {
  let tokenAttempted: string | null = null;
  try {
    const current = await revalidateRealtimeEvent(subscription.id, delivery.eventKey);
    if (!current) {
      await db.update(passengerRealtimeDeliveriesTable).set({
        state: "failed", lastError: "The opt-in or matching event is no longer current.", updatedAt: new Date(),
      }).where(and(
        eq(passengerRealtimeDeliveriesTable.id, delivery.id),
        eq(passengerRealtimeDeliveriesTable.state, "sending"),
      ));
      return false;
    }
    tokenAttempted = current.subscription.expoPushToken;
    const currentPayload = { ...payload, soundEnabled: current.subscription.soundEnabled };
    const ticketId = await pushExpoToken(
      current.subscription.expoPushToken, currentPayload, current.subscription.id, delivery.eventKey,
    );
    await db.update(passengerRealtimeDeliveriesTable).set({
      state: "receipt_pending",
      expoPushToken: current.subscription.expoPushToken,
      expoTicketId: ticketId,
      nextReceiptCheckAt: new Date(Date.now() + RECEIPT_INITIAL_DELAY_MS),
      receiptError: null,
      updatedAt: new Date(),
    }).where(and(
      eq(passengerRealtimeDeliveriesTable.id, delivery.id),
      eq(passengerRealtimeDeliveriesTable.state, "sending"),
    ));
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 500) : "Expo Push delivery failed";
    const permanent = Boolean((error as { permanent?: boolean }).permanent);
    const invalidToken = Boolean((error as { invalidToken?: boolean }).invalidToken);
    const attempts = delivery.attemptCount + 1;
    await db.update(passengerRealtimeDeliveriesTable).set({
      state: permanent || attempts >= MAX_PROVIDER_ATTEMPTS ? "failed" : "pending",
      attemptCount: attempts,
      nextAttemptAt: new Date(Date.now() + Math.min(REALTIME_RETRY_INTERVAL_MS * 2 ** (attempts - 1), 60 * 60_000)),
      lastError: detail,
      updatedAt: new Date(),
    }).where(and(
      eq(passengerRealtimeDeliveriesTable.id, delivery.id),
      eq(passengerRealtimeDeliveriesTable.state, "sending"),
    ));
    if (invalidToken) {
      await db.update(passengerRealtimeSubscriptionsTable).set({ active: false, updatedAt: new Date() })
        .where(and(
          eq(passengerRealtimeSubscriptionsTable.id, subscription.id),
          tokenAttempted
            ? eq(passengerRealtimeSubscriptionsTable.expoPushToken, tokenAttempted)
            : undefined,
        ));
    }
    log.error({ err: error, subscriptionId: subscription.id, eventKey: delivery.eventKey }, "passenger realtime push delivery failed");
    return false;
  }
}

export function approachingPickupThresholdReached(etaSeconds: number | null) {
  return typeof etaSeconds === "number" && Number.isFinite(etaSeconds) && etaSeconds >= 0 && etaSeconds <= 10 * 60;
}

export function approachingPickupEventKey(subscriptionId: string, generation: number) {
  return `approaching-pickup:${subscriptionId}:${generation}`;
}

const TRANSFER_STATUS_RANK: Record<string, number> = { possible: 0, tight: 1, at_risk: 2 };

export function transferRiskDeteriorated(previousStatus: string | null, nextStatus: string) {
  return nextStatus !== "possible"
    && (TRANSFER_STATUS_RANK[nextStatus] ?? -1) > (TRANSFER_STATUS_RANK[previousStatus ?? "possible"] ?? -1);
}

export function transferRiskHasHysteresis(
  previousStatus: string | null,
  nextStatus: string,
  bufferMinutes: number,
  minimumBufferMinutes: number,
) {
  if (!transferRiskDeteriorated(previousStatus, nextStatus)) return false;
  if (nextStatus === "tight") {
    return bufferMinutes <= minimumBufferMinutes - TRANSFER_ALERT_HYSTERESIS_MINUTES;
  }
  if (nextStatus === "at_risk") {
    return bufferMinutes <= -TRANSFER_ALERT_HYSTERESIS_MINUTES;
  }
  return false;
}

export function transferAlertCooldownElapsed(lastAlertAt: Date | null, now: Date) {
  return !lastAlertAt || now.getTime() - lastAlertAt.getTime() >= TRANSFER_ALERT_COOLDOWN_MS;
}

export function transferRiskEventKey(subscriptionId: string, previousStatus: string, nextStatus: string, observedAt: Date) {
  return `transfer-risk:${subscriptionId}:${previousStatus}:${nextStatus}:${observedAt.toISOString()}`;
}

export function disruptionEventKey(disruptionId: string, action: "created" | "updated" | "cleared", updatedAt: Date) {
  return `disruption:${disruptionId}:${action}:${updatedAt.toISOString()}`;
}

export async function sendPassengerRealtimePush(
  subscription: PassengerRealtimeSubscriptionRow,
  eventKey: string,
  message: RealtimePushPayload,
  log: { error: (obj: unknown, message: string) => void },
) {
  const now = new Date();
  const payload = { ...message, soundEnabled: message.soundEnabled ?? subscription.soundEnabled };
  const [inserted] = await db.insert(passengerRealtimeDeliveriesTable).values({
    id: randomUUID(), subscriptionId: subscription.id, eventKey, payload,
    expoPushToken: subscription.expoPushToken, state: "pending", nextAttemptAt: now, updatedAt: now,
  }).onConflictDoNothing().returning();
  if (!inserted) {
    await db.update(passengerRealtimeDeliveriesTable).set({
      state: "pending",
      lastError: "A timed-out push attempt was requeued.",
      updatedAt: now,
    }).where(and(
      eq(passengerRealtimeDeliveriesTable.subscriptionId, subscription.id),
      eq(passengerRealtimeDeliveriesTable.eventKey, eventKey),
      eq(passengerRealtimeDeliveriesTable.state, "sending"),
      lte(passengerRealtimeDeliveriesTable.updatedAt, new Date(now.getTime() - REALTIME_SEND_LEASE_MS)),
    ));
  }
  const [claimed] = await db.update(passengerRealtimeDeliveriesTable).set({
    state: "sending", updatedAt: now,
  }).where(and(
    eq(passengerRealtimeDeliveriesTable.subscriptionId, subscription.id),
    eq(passengerRealtimeDeliveriesTable.eventKey, eventKey),
    eq(passengerRealtimeDeliveriesTable.state, "pending"),
    lte(passengerRealtimeDeliveriesTable.nextAttemptAt, now),
  )).returning();
  if (!claimed) return false;
  return deliverClaimedPush(subscription, claimed, payload, log);
}

export async function processDuePassengerRealtimePushes(
  now = new Date(),
  log: { error: (obj: unknown, message: string) => void } = logger,
) {
  await db.update(passengerRealtimeDeliveriesTable).set({
    state: "pending", updatedAt: now,
  }).where(and(
    eq(passengerRealtimeDeliveriesTable.state, "sending"),
    lte(passengerRealtimeDeliveriesTable.updatedAt, new Date(now.getTime() - REALTIME_SEND_LEASE_MS)),
  ));
  const due = await db.select().from(passengerRealtimeDeliveriesTable).where(and(
    eq(passengerRealtimeDeliveriesTable.state, "pending"),
    lte(passengerRealtimeDeliveriesTable.nextAttemptAt, now),
  )).limit(100);
  for (const delivery of due) {
    const [claimed] = await db.update(passengerRealtimeDeliveriesTable).set({
      state: "sending", updatedAt: now,
    }).where(and(
      eq(passengerRealtimeDeliveriesTable.id, delivery.id),
      eq(passengerRealtimeDeliveriesTable.state, "pending"),
    )).returning();
    if (!claimed) continue;
    const [subscription] = await db.select().from(passengerRealtimeSubscriptionsTable)
      .where(eq(passengerRealtimeSubscriptionsTable.id, delivery.subscriptionId)).limit(1);
    if (!subscription) {
      await db.update(passengerRealtimeDeliveriesTable).set({
        state: "failed", lastError: "The owning subscription no longer exists.", updatedAt: new Date(),
      }).where(and(
        eq(passengerRealtimeDeliveriesTable.id, claimed.id),
        eq(passengerRealtimeDeliveriesTable.state, "sending"),
      ));
      continue;
    }
    await deliverClaimedPush(subscription, claimed, delivery.payload, log);
  }
  return due.length;
}

function receiptBackoff(attempt: number) {
  return Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 30 * 60_000);
}

async function retryReceipt(
  delivery: PassengerRealtimeDeliveryRow,
  detail: string,
  log: { error: (obj: unknown, message: string) => void },
  permanentInvalidToken = false,
) {
  const attempts = delivery.receiptAttempts + 1;
  const terminal = permanentInvalidToken || attempts >= MAX_RECEIPT_ATTEMPTS;
  await db.update(passengerRealtimeDeliveriesTable).set({
    state: terminal ? "failed" : "receipt_pending",
    receiptAttempts: attempts,
    receiptError: detail.slice(0, 500),
    nextReceiptCheckAt: terminal ? null : new Date(Date.now() + receiptBackoff(attempts)),
    lastError: detail.slice(0, 500),
    updatedAt: new Date(),
  }).where(and(
    eq(passengerRealtimeDeliveriesTable.id, delivery.id),
    eq(passengerRealtimeDeliveriesTable.state, "receipt_pending"),
  ));
  if (permanentInvalidToken && delivery.expoPushToken) {
    await db.update(passengerRealtimeSubscriptionsTable).set({ active: false, updatedAt: new Date() })
      .where(and(
        eq(passengerRealtimeSubscriptionsTable.id, delivery.subscriptionId),
        eq(passengerRealtimeSubscriptionsTable.expoPushToken, delivery.expoPushToken),
      ));
  }
  log.error({ subscriptionId: delivery.subscriptionId, eventKey: delivery.eventKey, receiptAttempt: attempts, detail },
    terminal ? "passenger realtime push receipt failed terminally" : "passenger realtime push receipt will retry");
}

export async function processDuePassengerRealtimeReceipts(
  now = new Date(),
  log: { error: (obj: unknown, message: string) => void } = logger,
) {
  const due = await db.select().from(passengerRealtimeDeliveriesTable).where(and(
    eq(passengerRealtimeDeliveriesTable.state, "receipt_pending"),
    lte(passengerRealtimeDeliveriesTable.nextReceiptCheckAt, now),
  )).limit(100);
  for (const candidate of due) {
    const leaseUntil = new Date(now.getTime() + REALTIME_SEND_LEASE_MS);
    const [claimed] = await db.update(passengerRealtimeDeliveriesTable).set({
      nextReceiptCheckAt: leaseUntil,
      updatedAt: now,
    }).where(and(
      eq(passengerRealtimeDeliveriesTable.id, candidate.id),
      eq(passengerRealtimeDeliveriesTable.state, "receipt_pending"),
      lte(passengerRealtimeDeliveriesTable.nextReceiptCheckAt, now),
    )).returning();
    if (!claimed) continue;
    if (!claimed.expoTicketId) {
      await retryReceipt(claimed, "Expo delivery receipt has no ticket ID.", log);
      continue;
    }
    try {
      const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [claimed.expoTicketId] }),
        signal: AbortSignal.timeout(REALTIME_PUSH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Expo receipt API returned ${response.status}`);
      const result = await response.json() as {
        data?: Record<string, { status?: string; message?: string; details?: { error?: string } }>;
      };
      const receipt = result.data?.[claimed.expoTicketId];
      if (receipt?.status === "ok") {
        const [settled] = await db.update(passengerRealtimeDeliveriesTable).set({
          state: "delivered", receiptError: null, lastError: null, nextReceiptCheckAt: null, updatedAt: new Date(),
        }).where(and(
          eq(passengerRealtimeDeliveriesTable.id, claimed.id),
          eq(passengerRealtimeDeliveriesTable.state, "receipt_pending"),
        )).returning({ subscriptionId: passengerRealtimeDeliveriesTable.subscriptionId });
        if (settled) {
          const [subscription] = await db.select().from(passengerRealtimeSubscriptionsTable)
            .where(eq(passengerRealtimeSubscriptionsTable.id, settled.subscriptionId)).limit(1);
          if (subscription?.flow === "approaching-pickup" && subscription.active) {
            await db.update(passengerRealtimeSubscriptionsTable).set({ active: false, updatedAt: new Date() })
              .where(and(
                eq(passengerRealtimeSubscriptionsTable.id, subscription.id),
                eq(passengerRealtimeSubscriptionsTable.active, true),
              ));
          }
        }
        continue;
      }
      const providerError = receipt?.details?.error ?? receipt?.message ?? "Expo receipt is not available yet";
      await retryReceipt(claimed, providerError, log, providerError === "DeviceNotRegistered");
    } catch (error) {
      await retryReceipt(
        claimed,
        error instanceof Error ? error.message : "Expo receipt request failed",
        log,
      );
    }
  }
  return due.length;
}

let retryScheduler: ReturnType<typeof setInterval> | null = null;
export function startPassengerRealtimePushRetryScheduler() {
  if (retryScheduler || process.env.NODE_ENV === "test") return;
  retryScheduler = setInterval(() => {
    void Promise.all([
      processDuePassengerRealtimePushes(new Date(), logger),
      processDuePassengerRealtimeReceipts(new Date(), logger),
    ]).catch(error => logger.error({ err: error }, "passenger realtime push retry sweep failed"));
  }, 60_000);
  retryScheduler.unref();
}

export async function revokePassengerRealtimeSubscriptions(operatorPairingCode: string, passengerCode: string) {
  const now = new Date();
  const rows = await db.update(passengerRealtimeSubscriptionsTable).set({
    active: false, updatedAt: now,
  }).where(and(
    eq(passengerRealtimeSubscriptionsTable.operatorPairingCode, operatorPairingCode),
    eq(passengerRealtimeSubscriptionsTable.passengerCode, passengerCode),
  )).returning({ id: passengerRealtimeSubscriptionsTable.id });
  if (rows.length) {
    await db.update(passengerRealtimeDeliveriesTable).set({
      state: "failed",
      lastError: "The passenger pairing code was rotated or disconnected.",
      updatedAt: now,
    }).where(and(
      inArray(passengerRealtimeDeliveriesTable.subscriptionId, rows.map(row => row.id)),
      inArray(passengerRealtimeDeliveriesTable.state, ["pending", "sending", "receipt_pending"]),
    ));
  }
  return rows.length;
}

export async function notifyRunDisruption(
  officialRunKeys: string[],
  disruptionId: string,
  action: "created" | "updated" | "cleared",
  updatedAt: Date,
  message: { title: string; body: string },
  log: { error: (obj: unknown, message: string) => void },
) {
  const results = await db.select({ subscription: passengerRealtimeSubscriptionsTable })
    .from(passengerRealtimeSubscriptionsTable)
    .innerJoin(liveTripsTable, and(
      eq(liveTripsTable.pairingCode, passengerRealtimeSubscriptionsTable.operatorPairingCode),
      eq(liveTripsTable.passengerPairingCode, passengerRealtimeSubscriptionsTable.passengerCode),
      eq(liveTripsTable.officialRunKey, passengerRealtimeSubscriptionsTable.officialRunKey),
    ))
    .where(and(
      eq(passengerRealtimeSubscriptionsTable.flow, "disruption"),
      inArray(passengerRealtimeSubscriptionsTable.officialRunKey, officialRunKeys),
      eq(passengerRealtimeSubscriptionsTable.active, true),
      eq(liveTripsTable.status, "running"),
      isNull(liveTripsTable.retiredAt),
    ));
  const subscribers = results.map(result => result.subscription);
  const eventKey = disruptionEventKey(disruptionId, action, updatedAt);
  let delivered = 0;
  for (const subscription of subscribers) {
    if (await sendPassengerRealtimePush(subscription, eventKey, {
      title: message.title,
      body: message.body,
      screen: "trip",
    }, log)) delivered += 1;
  }
  return { attempted: subscribers.length, delivered };
}

export async function deliverApproachingPickupAlerts(
  operatorPairingCode: string,
  row: LiveTripRow,
  stops: Array<{ id: string; label: string; eta: string | null }>,
  log: { error: (obj: unknown, message: string) => void },
) {
  if (!row.passengerPairingCode) return;
  const subscriptions = await db.select().from(passengerRealtimeSubscriptionsTable).where(and(
    eq(passengerRealtimeSubscriptionsTable.operatorPairingCode, operatorPairingCode),
    eq(passengerRealtimeSubscriptionsTable.passengerCode, row.passengerPairingCode),
    eq(passengerRealtimeSubscriptionsTable.flow, "approaching-pickup"),
    eq(passengerRealtimeSubscriptionsTable.active, true),
  ));
  const now = Date.now();
  for (const subscription of subscriptions) {
    if (row.status !== "running" || row.retiredAt || !row.officialRunKey
        || row.officialRunKey !== subscription.officialRunKey) {
      await db.update(passengerRealtimeSubscriptionsTable).set({ active: false, updatedAt: new Date() })
        .where(eq(passengerRealtimeSubscriptionsTable.id, subscription.id));
      continue;
    }
    const stop = stops.find(candidate => candidate.id === subscription.selectedStopId);
    if (!stop) {
      await db.update(passengerRealtimeSubscriptionsTable).set({ active: false, updatedAt: new Date() })
        .where(eq(passengerRealtimeSubscriptionsTable.id, subscription.id));
      continue;
    }
    const etaSeconds = stop.eta ? (new Date(stop.eta).getTime() - now) / 1000 : null;
    if (!approachingPickupThresholdReached(etaSeconds)) continue;
    await sendPassengerRealtimePush(
      subscription,
      approachingPickupEventKey(subscription.id, subscription.pickupAlertGeneration),
      {
        title: `Coach approaching ${stop.label}`,
        body: `Your selected pickup is about 10 minutes away.`,
        screen: "stop-alert",
      },
      log,
    );
  }
}

export async function expirePassengerRealtimeSubscriptions(operatorPairingCode: string, row: LiveTripRow) {
  if (row.status === "running" && !row.retiredAt) return 0;
  const result = await db.update(passengerRealtimeSubscriptionsTable).set({
    active: false, updatedAt: new Date(),
  }).where(and(
    eq(passengerRealtimeSubscriptionsTable.operatorPairingCode, operatorPairingCode),
    eq(passengerRealtimeSubscriptionsTable.active, true),
  )).returning({ id: passengerRealtimeSubscriptionsTable.id });
  if (result.length) {
    await db.update(passengerRealtimeDeliveriesTable).set({
      state: "failed", lastError: "The paired trip ended before delivery.", updatedAt: new Date(),
    }).where(and(
      inArray(passengerRealtimeDeliveriesTable.subscriptionId, result.map(item => item.id)),
      inArray(passengerRealtimeDeliveriesTable.state, ["pending", "sending", "receipt_pending"]),
    ));
  }
  return result.length;
}

function transferStatusMessage(status: string) {
  if (status === "at_risk") return {
    title: "Transfer connection at risk",
    body: "Your verified connection may be missed because of the latest arrival estimate.",
  };
  return {
    title: "Transfer connection is tight",
    body: "The latest arrival estimate leaves less than your selected transfer buffer.",
  };
}

export async function evaluateTransferRealtimeSubscriptions(
  operatorPairingCode: string,
  row: LiveTripRow,
  log: { error: (obj: unknown, message: string) => void },
) {
  if (!row.passengerPairingCode) return;
  const subscriptions = await db.select().from(passengerRealtimeSubscriptionsTable).where(and(
    eq(passengerRealtimeSubscriptionsTable.operatorPairingCode, operatorPairingCode),
    eq(passengerRealtimeSubscriptionsTable.passengerCode, row.passengerPairingCode),
    eq(passengerRealtimeSubscriptionsTable.flow, "transfer-risk"),
    eq(passengerRealtimeSubscriptionsTable.active, true),
  ));
  for (const subscription of subscriptions) {
    if (row.status !== "running" || row.retiredAt || !row.officialRunKey
        || row.officialRunKey !== subscription.officialRunKey) {
      await db.update(passengerRealtimeSubscriptionsTable).set({ active: false, updatedAt: new Date() })
        .where(eq(passengerRealtimeSubscriptionsTable.id, subscription.id));
      continue;
    }
    try {
      const now = new Date();
      const assessment = await freshVerifiedTransferAssessment(subscription, row, now);
      if (!assessment || !["tight", "at_risk"].includes(assessment.connectionStatus)) continue;
      const priorStatus = subscription.lastConnectionStatus;
      const lastAlertAt = subscription.lastTransferAlertAt;
      if (!transferRiskHasHysteresis(
        priorStatus,
        assessment.connectionStatus,
        assessment.bufferMinutes,
        subscription.minimumBufferMinutes!,
      )
          || !transferAlertCooldownElapsed(lastAlertAt, now)) continue;
      const [changed] = await db.update(passengerRealtimeSubscriptionsTable).set({
        lastConnectionStatus: assessment.connectionStatus,
        lastTransferAlertAt: now,
        updatedAt: now,
      }).where(and(
        eq(passengerRealtimeSubscriptionsTable.id, subscription.id),
        eq(passengerRealtimeSubscriptionsTable.active, true),
        priorStatus === null
          ? isNull(passengerRealtimeSubscriptionsTable.lastConnectionStatus)
          : eq(passengerRealtimeSubscriptionsTable.lastConnectionStatus, priorStatus),
        lastAlertAt === null
          ? isNull(passengerRealtimeSubscriptionsTable.lastTransferAlertAt)
          : eq(passengerRealtimeSubscriptionsTable.lastTransferAlertAt, lastAlertAt),
      )).returning();
      if (!changed) continue;
      const prior = priorStatus ?? "initial";
      const eventKey = transferRiskEventKey(subscription.id, prior, assessment.connectionStatus, changed.lastTransferAlertAt!);
      await sendPassengerRealtimePush(subscription, eventKey, {
        ...transferStatusMessage(assessment.connectionStatus),
        screen: "transfer",
      }, log);
    } catch (error) {
      log.error({ err: error, subscriptionId: subscription.id }, "passenger transfer alert revalidation failed");
    }
  }
}