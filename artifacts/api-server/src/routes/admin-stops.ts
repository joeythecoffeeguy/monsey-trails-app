import { json, Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import {
  db,
  liveTripsTable,
  passengerAlertsTable,
  scheduledStopChangesTable,
  scheduleStopOverridesTable,
  type LiveTripRow,
} from "@workspace/db";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  geocodeNavigationQuery,
  invalidateTripNavigationCache,
  reverseGeocodeNavigationCoordinates,
} from "./trip";
import {
  integratedScheduleStops,
  invalidateJourneyTrafficCaches,
  invalidateScheduleStopCaches,
  resolveOfficialAssignment,
  scheduleStopKey,
} from "./schedule";
import { requireAdmin } from "../middlewares/admin-role-policy";
import { buildStopChangeImpact, type StopChangeProposal } from "../lib/stop-change-impact";
import { isMonseyTrailsServiceCoordinate } from "../lib/route-coordinates";
import {
  SCHEDULED_STOP_CHANGE_POLICY,
  scheduledStopChangeCanBeQueued,
  scheduledStopChangeIsDue,
} from "../lib/scheduled-stop-changes";

const router: IRouter = Router();
router.use("/admin", requireAdmin);
router.use("/admin", json());

const AREA_NAMES: Record<number, string> = {
  1: "New Square", 2: "Monsey", 3: "Boro Park", 4: "Williamsburg", 5: "Manhattan",
  6: "Wall Street", 7: "Lakewood (Westgate)", 8: "Lakewood (Sq. Kennedy)",
  9: "Flatbush", 10: "Kiryas Yoel", 11: "B&H", 12: "Crown Heights",
};

const STOP_CATEGORIES = ["pickup", "dropoff", "both"] as const;
type StopCategory = typeof STOP_CATEGORIES[number];

function stopCategory(value: unknown): StopCategory | null {
  return typeof value === "string" && STOP_CATEGORIES.includes(value as StopCategory)
    ? value as StopCategory
    : null;
}

export function effectiveStopCategory(
  published: StopCategory,
  override: { category: string } | null | undefined,
): StopCategory {
  return stopCategory(override?.category) ?? published;
}

function comparableLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function samePoint(
  point: { lat: number; lng: number },
  expected: { lat: number; lng: number },
) {
  return Math.abs(point.lat - expected.lat) < 0.0000001
    && Math.abs(point.lng - expected.lng) < 0.0000001;
}

export function applyStopCoordinatesToActiveTrip(
  trip: Pick<LiveTripRow, "destinationAddress" | "destinationLat" | "destinationLng" | "intermediateStops">,
  stop: { canonicalLabel: string; sourceLabel: string },
  previous: { lat: number; lng: number },
  next: { lat: number; lng: number; address?: string },
) {
  const labels = new Set([
    comparableLabel(stop.canonicalLabel),
    comparableLabel(stop.sourceLabel),
  ]);
  const matches = (candidate: { address: string; lat: number; lng: number; id?: string }) => (
    labels.has(comparableLabel(candidate.address))
    || (candidate.id?.startsWith("official-") === true && samePoint(candidate, previous))
  );
  let changed = false;
  const intermediateStops = trip.intermediateStops.map(candidate => {
    if (!matches(candidate)) return candidate;
    changed = true;
    const { eta: _eta, ...rest } = candidate;
    return { ...rest, address: next.address ?? rest.address, lat: next.lat, lng: next.lng };
  });
  const destinationMatches = trip.destinationLat !== null
    && trip.destinationLng !== null
    && matches({
      address: trip.destinationAddress,
      lat: trip.destinationLat,
      lng: trip.destinationLng,
      id: "official-destination",
    });
  if (destinationMatches) changed = true;
  return changed ? {
    intermediateStops,
    ...(destinationMatches ? {
      destinationAddress: next.address ?? trip.destinationAddress,
      destinationLat: next.lat,
      destinationLng: next.lng,
    } : {}),
  } : null;
}

function stopResponse(row: typeof scheduleStopOverridesTable.$inferSelect, manuallyOverridden = true) {
  return {
    key: row.key,
    areaId: Number(row.areaId),
    areaName: row.areaName,
    canonicalLabel: row.canonicalLabel,
    sourceLabel: row.sourceLabel,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    category: row.category as StopCategory,
    manuallyOverridden: row.isCustom ? false : manuallyOverridden,
    isCustom: row.isCustom,
    listedOnOfficialSite: !row.isCustom,
    officialSiteNote: row.isCustom ? "Not yet listed on the official Monsey Trails website." : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type StopMutation =
  | { kind: "create"; stopId: string }
  | { kind: "delete"; canonicalLabel: string; sourceLabel: string };

export function removalTargetsActiveFinalLeg(
  trip: Pick<LiveTripRow, "status" | "intermediateStops" | "destinationAddress">,
  destinationAreaId: number,
  affectedAreaId: number,
  labels: { canonicalLabel: string; sourceLabel: string },
) {
  return trip.status === "running"
    && trip.intermediateStops.length === 0
    && destinationAreaId === affectedAreaId
    && [labels.canonicalLabel, labels.sourceLabel]
      .some(label => comparableLabel(label) === comparableLabel(trip.destinationAddress));
}

export function shouldPreserveActiveTripRoute(status: string) {
  return status === "running";
}

async function reconcileActiveOfficialTrips(
  tx: DbTransaction,
  stopOverrides: Array<typeof scheduleStopOverridesTable.$inferSelect>,
  now: Date,
  affectedAreaId: number,
  mutation: StopMutation,
) {
  const rows = await tx.select().from(liveTripsTable).where(and(
    isNotNull(liveTripsTable.officialRunKey),
    isNull(liveTripsTable.completedAt),
    isNull(liveTripsTable.retiredAt),
  )).for("update");
  const affected: string[] = [];
  for (const row of rows) {
    let official: Awaited<ReturnType<typeof resolveOfficialAssignment>>;
    try {
      official = await resolveOfficialAssignment(row.officialRunKey!, stopOverrides);
    } catch (error) {
      const [, , origin, destination] = row.officialRunKey!.split("|").map(Number);
      if (origin !== affectedAreaId && destination !== affectedAreaId
        && Number((error as { status?: number }).status) === 404) {
        continue;
      }
      throw Object.assign(
        new Error(`Coach ${row.pairingCode} could not be reconciled with published run ${row.officialRunKey}.`, { cause: error }),
        { status: Number((error as { status?: number }).status) || 502 },
      );
    }
    if (mutation.kind === "delete" && removalTargetsActiveFinalLeg(
      row,
      official.destinationAreaId,
      affectedAreaId,
      mutation,
    )) {
      throw Object.assign(
        new Error(`Coach ${row.pairingCode} is already on its final leg to this stop. Stop the trip before removing its active destination.`),
        { status: 409 },
      );
    }
    // Never rewrite the route under a moving coach. In particular, its final
    // stop remains the driver's current operational destination.
    if (shouldPreserveActiveTripRoute(row.status)) continue;
    let intermediateStops = official.intermediateStops;
    await tx.update(liveTripsTable).set({
      destinationAddress: official.destination.address,
      destinationLat: official.destination.lat,
      destinationLng: official.destination.lng,
      intermediateStops,
      routeGeometry: [],
      eta: null,
      remainingDistanceMiles: null,
      updatedAt: now,
    }).where(eq(liveTripsTable.pairingCode, row.pairingCode));
    const validAlertStopIds = new Set([
      ...intermediateStops.map(stop => stop.id),
      official.destination.id,
      "final-destination",
    ]);
    const activeAlerts = await tx.select({
      id: passengerAlertsTable.id,
      selectedStopId: passengerAlertsTable.selectedStopId,
    }).from(passengerAlertsTable).where(and(
      eq(passengerAlertsTable.operatorPairingCode, row.pairingCode),
      inArray(passengerAlertsTable.state, ["pending", "sending"]),
    ));
    const expiredAlertIds = activeAlerts
      .filter(alert => !validAlertStopIds.has(alert.selectedStopId))
      .map(alert => alert.id);
    if (expiredAlertIds.length) {
      await tx.update(passengerAlertsTable).set({
        state: "expired",
        expiresAt: now,
        updatedAt: now,
      }).where(inArray(passengerAlertsTable.id, expiredAlertIds));
    }
    affected.push(row.pairingCode);
  }
  return affected;
}

async function proposalForExistingStop(
  key: string,
  kind: "update" | "delete",
  change: Record<string, unknown> = {},
): Promise<StopChangeProposal | null> {
  const official = integratedScheduleStops()
    .find(item => scheduleStopKey(item.areaId, item.canonicalLabel) === key);
  const [stored] = await db.select().from(scheduleStopOverridesTable)
    .where(eq(scheduleStopOverridesTable.key, key)).limit(1);
  const stop = stored ?? official;
  if (!stop) return null;
  const { confirmedImpactRevision: _confirmedImpactRevision, ...proposedChange } = change;
  return {
    kind,
    key,
    areaId: Number(stop.areaId),
    areaName: stop.areaName,
    canonicalLabel: stop.canonicalLabel,
    sourceLabel: stop.sourceLabel,
    change: proposedChange,
  };
}

async function confirmedImpact(
  req: { body?: any; query?: any },
  proposal: StopChangeProposal,
) {
  const preview = await buildStopChangeImpact(proposal);
  const confirmed = typeof req.body?.confirmedImpactRevision === "string"
    ? req.body.confirmedImpactRevision
    : typeof req.query?.confirmedImpactRevision === "string"
      ? req.query.confirmedImpactRevision
      : "";
  return { preview, confirmed: confirmed === preview.revision };
}

router.get("/admin/schedule-stops", async (_req, res) => {
  const [overrides, known] = await Promise.all([
    db.select().from(scheduleStopOverridesTable),
    Promise.resolve(integratedScheduleStops()),
  ]);
  const byKey = new Map(overrides.map(row => [row.key, row]));
  const official = known.flatMap(stop => {
    const key = scheduleStopKey(stop.areaId, stop.canonicalLabel);
    const override = byKey.get(key);
    if (override?.suppressed) return [];
    return [{
      key, areaId: stop.areaId, areaName: stop.areaName,
      canonicalLabel: stop.canonicalLabel, sourceLabel: stop.sourceLabel,
      address: override?.address ?? stop.canonicalLabel,
      lat: override?.lat ?? stop.lat, lng: override?.lng ?? stop.lng,
      category: effectiveStopCategory(stop.category, override),
      manuallyOverridden: Boolean(override),
      isCustom: false,
      listedOnOfficialSite: true,
      officialSiteNote: null,
      updatedAt: override?.updatedAt?.toISOString() ?? null,
    }];
  });
  const custom = overrides
    .filter(row => row.isCustom && !row.suppressed)
    .map(row => stopResponse(row, false));
  res.json([...official, ...custom]);
});

router.post("/admin/schedule-stops/impact", async (req, res) => {
  const kind = req.body?.kind;
  let proposal: StopChangeProposal | null = null;
  if (kind === "create") {
    const areaId = Number(req.body?.change?.areaId);
    const canonicalLabel = typeof req.body?.change?.canonicalLabel === "string"
      ? req.body.change.canonicalLabel.trim().slice(0, 240) : "";
    const address = typeof req.body?.change?.address === "string"
      ? req.body.change.address.trim().slice(0, 320) || null
      : null;
    const lat = Number(req.body?.change?.lat);
    const lng = Number(req.body?.change?.lng);
    const category = req.body?.change?.category === undefined
      ? "both"
      : stopCategory(req.body.change.category);
    if (
      AREA_NAMES[areaId]
      && canonicalLabel.length >= 2
      && Number.isFinite(lat) && lat >= -90 && lat <= 90
      && Number.isFinite(lng) && lng >= -180 && lng <= 180
      && category
    ) {
      proposal = {
        kind,
        areaId,
        areaName: AREA_NAMES[areaId],
        canonicalLabel,
        sourceLabel: canonicalLabel,
        change: { address, lat, lng, category },
      };
    }
  } else if ((kind === "update" || kind === "delete") && typeof req.body?.key === "string") {
    proposal = await proposalForExistingStop(req.body.key, kind, req.body?.change ?? {});
  }
  if (!proposal) {
    res.status(400).json({ error: "Choose an existing stop and a valid create, update, or delete change." });
    return;
  }
  res.json(await buildStopChangeImpact(proposal));
});

router.get("/admin/scheduled-stop-changes", async (_req, res) => {
  const rows = await db.select().from(scheduledStopChangesTable);
  res.json({
    changes: rows.map(row => ({
      ...row,
      applyAt: row.applyAt.toISOString(),
      appliedAt: row.appliedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })),
    processingPolicy: SCHEDULED_STOP_CHANGE_POLICY,
    dueChangeIds: rows.filter(row => scheduledStopChangeIsDue(row)).map(row => row.id),
  });
});

router.post("/admin/scheduled-stop-changes", async (req, res) => {
  const kind = req.body?.kind;
  const key = typeof req.body?.key === "string" ? req.body.key : undefined;
  const change = req.body?.change && typeof req.body.change === "object" ? req.body.change : {};
  const applyAt = new Date(req.body?.applyAt);
  let proposal: StopChangeProposal | null = null;
  if (kind === "create") {
    const areaId = Number(change.areaId);
    const canonicalLabel = typeof change.canonicalLabel === "string" ? change.canonicalLabel.trim() : "";
    const address = typeof change.address === "string" ? change.address.trim().slice(0, 320) || null : null;
    const lat = Number(change.lat);
    const lng = Number(change.lng);
    const category = change.category === undefined ? "both" : stopCategory(change.category);
    if (AREA_NAMES[areaId] && canonicalLabel
      && Number.isFinite(lat) && lat >= -90 && lat <= 90
      && Number.isFinite(lng) && lng >= -180 && lng <= 180
      && category) {
      proposal = {
        kind, areaId, areaName: AREA_NAMES[areaId], canonicalLabel, sourceLabel: canonicalLabel,
        change: { address, lat, lng, category },
      };
    }
  } else if ((kind === "update" || kind === "delete") && key) {
    proposal = await proposalForExistingStop(key, kind, change);
  }
  if (!proposal || !scheduledStopChangeCanBeQueued(applyAt)) {
    res.status(400).json({ error: "Choose a valid stop change at least one minute in the future." });
    return;
  }
  const impact = await buildStopChangeImpact(proposal);
  if (req.body?.confirmedImpactRevision !== impact.revision) {
    res.status(409).json({
      error: "Impact changed or has not been confirmed. Review the latest impact before scheduling.",
      code: "IMPACT_CONFIRMATION_REQUIRED",
      impact,
    });
    return;
  }
  const [created] = await db.insert(scheduledStopChangesTable).values({
    id: randomUUID(),
    kind,
    stopKey: key ?? null,
    change,
    applyAt,
    requestedBy: res.locals.adminSubject,
    confirmedImpactRevision: impact.revision,
  }).returning();
  res.status(201).json({
    change: { ...created, applyAt: created.applyAt.toISOString(), createdAt: created.createdAt.toISOString(), updatedAt: created.updatedAt.toISOString() },
    processingPolicy: SCHEDULED_STOP_CHANGE_POLICY,
  });
});

router.delete("/admin/scheduled-stop-changes/:id", async (req, res) => {
  const [cancelled] = await db.update(scheduledStopChangesTable).set({
    state: "cancelled",
    updatedAt: new Date(),
  }).where(and(
    eq(scheduledStopChangesTable.id, req.params.id),
    eq(scheduledStopChangesTable.state, "queued"),
  )).returning();
  if (!cancelled) {
    res.status(404).json({ error: "Queued stop change not found." });
    return;
  }
  res.status(204).end();
});

router.patch("/admin/scheduled-stop-changes/:id", async (req, res) => {
  const [existing] = await db.select().from(scheduledStopChangesTable)
    .where(eq(scheduledStopChangesTable.id, req.params.id)).limit(1);
  if (!existing || existing.state !== "queued") {
    res.status(404).json({ error: "Queued stop change not found." });
    return;
  }
  if (req.body?.action === "applied") {
    if (!scheduledStopChangeIsDue(existing)) {
      res.status(409).json({ error: "This change is not due yet." });
      return;
    }
    const proposal = existing.kind === "create"
      ? (() => {
          const areaId = Number(existing.change.areaId);
          const canonicalLabel = typeof existing.change.canonicalLabel === "string"
            ? existing.change.canonicalLabel.trim().slice(0, 240) : "";
          const address = typeof existing.change.address === "string"
            ? existing.change.address.trim().slice(0, 320) || null : null;
          const lat = Number(existing.change.lat);
          const lng = Number(existing.change.lng);
          const category = existing.change.category === undefined ? "both" : stopCategory(existing.change.category);
          return AREA_NAMES[areaId] && canonicalLabel
            && Number.isFinite(lat) && lat >= -90 && lat <= 90
            && Number.isFinite(lng) && lng >= -180 && lng <= 180
            && category
            ? {
                kind: "create" as const, areaId, areaName: AREA_NAMES[areaId],
                canonicalLabel, sourceLabel: canonicalLabel, change: { address, lat, lng, category },
              }
            : null;
        })()
      : existing.stopKey
        ? await proposalForExistingStop(existing.stopKey, existing.kind, existing.change)
        : null;
    if (!proposal) {
      res.status(409).json({ error: "The queued stop change no longer targets a valid stop." });
      return;
    }
    const freshImpact = await buildStopChangeImpact(proposal);
    if (req.body?.confirmedImpactRevision !== freshImpact.revision) {
      res.status(409).json({ error: "Review and confirm a fresh impact before completing this queued change." });
      return;
    }
    const affectedPairingCodes: string[] = [];
    try {
      const applied = await db.transaction(async tx => {
        const [locked] = await tx.select().from(scheduledStopChangesTable).where(and(
          eq(scheduledStopChangesTable.id, existing.id),
          eq(scheduledStopChangesTable.state, "queued"),
        )).for("update").limit(1);
        if (!locked || !scheduledStopChangeIsDue(locked)) {
          throw Object.assign(new Error("This queued change was already applied or is no longer due."), { status: 409 });
        }
        const now = new Date();
        if (locked.kind === "create") {
          const areaId = Number(locked.change.areaId);
          const areaName = AREA_NAMES[areaId];
          const canonicalLabel = typeof locked.change.canonicalLabel === "string"
            ? locked.change.canonicalLabel.trim().slice(0, 240) : "";
          const address = typeof locked.change.address === "string"
            ? locked.change.address.trim().slice(0, 320) || null : null;
          const lat = Number(locked.change.lat);
          const lng = Number(locked.change.lng);
          const category = locked.change.category === undefined ? "both" : stopCategory(locked.change.category);
          if (!areaName || canonicalLabel.length < 2 || !Number.isFinite(lat) || lat < -90 || lat > 90
            || !Number.isFinite(lng) || lng < -180 || lng > 180 || !category) {
            throw Object.assign(new Error("The queued stop addition is no longer valid."), { status: 400 });
          }
          const overrides = await tx.select().from(scheduleStopOverridesTable);
          const duplicate = overrides.some(row => !row.suppressed && Number(row.areaId) === areaId
            && comparableLabel(row.canonicalLabel) === comparableLabel(canonicalLabel));
          if (duplicate || integratedScheduleStops().some(stop => stop.areaId === areaId
            && comparableLabel(stop.canonicalLabel) === comparableLabel(canonicalLabel))) {
            throw Object.assign(new Error("A stop with this name already exists in the selected area."), { status: 409 });
          }
          const sequence = Math.max(0, ...overrides
            .filter(row => row.isCustom && Number(row.areaId) === areaId)
            .map(row => row.sequence)) + 1;
          const [saved] = await tx.insert(scheduleStopOverridesTable).values({
            key: `${areaId}:custom:${randomUUID()}`, areaId: String(areaId), areaName,
            canonicalLabel, sourceLabel: canonicalLabel, address, lat, lng, category,
            isCustom: true, sequence, updatedBy: res.locals.adminSubject,
          }).returning();
          affectedPairingCodes.push(...await reconcileActiveOfficialTrips(
            tx, [...overrides, saved], now, areaId, { kind: "create", stopId: `custom-${saved.key}` },
          ));
        } else if (locked.kind === "update" && locked.stopKey) {
          const official = integratedScheduleStops()
            .find(item => scheduleStopKey(item.areaId, item.canonicalLabel) === locked.stopKey);
          const [stored] = await tx.select().from(scheduleStopOverridesTable)
            .where(eq(scheduleStopOverridesTable.key, locked.stopKey)).limit(1);
          const stop = stored?.isCustom ? stored : official;
          if (!stop) throw Object.assign(new Error("The queued stop no longer exists."), { status: 404 });
          const categoryProvided = locked.change.category !== undefined;
          const category = categoryProvided ? stopCategory(locked.change.category) : null;
          const coordinatesProvided = locked.change.lat !== undefined
            || locked.change.lng !== undefined || locked.change.address !== undefined;
          const lat = coordinatesProvided ? Number(locked.change.lat) : (stored?.lat ?? stop.lat);
          const lng = coordinatesProvided ? Number(locked.change.lng) : (stored?.lng ?? stop.lng);
          const address = coordinatesProvided
            ? (typeof locked.change.address === "string" ? locked.change.address.trim().slice(0, 320) || null : null)
            : (stored?.address ?? stop.canonicalLabel);
          if ((!coordinatesProvided && !categoryProvided) || (categoryProvided && !category)
            || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
            throw Object.assign(new Error("The queued stop update is no longer valid."), { status: 400 });
          }
          const previous = stored ?? { lat: stop.lat, lng: stop.lng };
          await tx.insert(scheduleStopOverridesTable).values({
            key: locked.stopKey, areaId: String(stop.areaId), areaName: stop.areaName,
            canonicalLabel: stop.canonicalLabel, sourceLabel: stop.sourceLabel,
            address, lat, lng, category: category ?? stored?.category ?? stop.category ?? "both",
            updatedAt: now, updatedBy: res.locals.adminSubject,
          }).onConflictDoUpdate({
            target: scheduleStopOverridesTable.key,
            set: {
              ...(coordinatesProvided ? { address, lat, lng } : {}),
              ...(category ? { category } : {}),
              updatedAt: now, updatedBy: res.locals.adminSubject,
            },
          });
          if (coordinatesProvided) {
            const activeTrips = await tx.select().from(liveTripsTable).where(and(
              isNotNull(liveTripsTable.officialRunKey), isNull(liveTripsTable.completedAt), isNull(liveTripsTable.retiredAt),
            )).for("update");
            for (const trip of activeTrips) {
              if (shouldPreserveActiveTripRoute(trip.status)) continue;
              const patch = applyStopCoordinatesToActiveTrip(trip, stop, previous, {
                lat, lng, address: address ?? stop.canonicalLabel,
              });
              if (!patch) continue;
              await tx.update(liveTripsTable).set({
                ...patch, routeGeometry: [], eta: null, remainingDistanceMiles: null, updatedAt: now,
              }).where(eq(liveTripsTable.pairingCode, trip.pairingCode));
              affectedPairingCodes.push(trip.pairingCode);
            }
          }
        } else if (locked.kind === "delete" && locked.stopKey) {
          const official = integratedScheduleStops()
            .find(item => scheduleStopKey(item.areaId, item.canonicalLabel) === locked.stopKey);
          const [stored] = await tx.select().from(scheduleStopOverridesTable)
            .where(eq(scheduleStopOverridesTable.key, locked.stopKey)).limit(1);
          if (!official && !stored) throw Object.assign(new Error("The queued stop no longer exists."), { status: 404 });
          if (stored) {
            await tx.update(scheduleStopOverridesTable).set({
              suppressed: true, updatedAt: now, updatedBy: res.locals.adminSubject,
            }).where(eq(scheduleStopOverridesTable.key, locked.stopKey));
          } else {
            await tx.insert(scheduleStopOverridesTable).values({
              key: locked.stopKey, areaId: String(official!.areaId), areaName: official!.areaName,
              canonicalLabel: official!.canonicalLabel, sourceLabel: official!.sourceLabel,
              address: official!.canonicalLabel, lat: official!.lat, lng: official!.lng,
              suppressed: true, updatedAt: now, updatedBy: res.locals.adminSubject,
            });
          }
          const stopOverrides = await tx.select().from(scheduleStopOverridesTable);
          affectedPairingCodes.push(...await reconcileActiveOfficialTrips(
            tx, stopOverrides, now, Number(stored?.areaId ?? official!.areaId),
            {
              kind: "delete",
              canonicalLabel: stored?.canonicalLabel ?? official!.canonicalLabel,
              sourceLabel: stored?.sourceLabel ?? official!.sourceLabel,
            },
          ));
        } else {
          throw Object.assign(new Error("The queued stop change is incomplete."), { status: 400 });
        }
        const [completed] = await tx.update(scheduledStopChangesTable).set({
          state: "applied", appliedAt: now, confirmedImpactRevision: freshImpact.revision,
          lastError: null, updatedAt: now,
        }).where(and(
          eq(scheduledStopChangesTable.id, locked.id),
          eq(scheduledStopChangesTable.state, "queued"),
        )).returning();
        if (!completed) throw Object.assign(new Error("The queued change was already applied."), { status: 409 });
        return completed;
      });
      invalidateScheduleStopCaches();
      for (const pairingCode of affectedPairingCodes) invalidateTripNavigationCache(pairingCode);
      invalidateJourneyTrafficCaches();
      res.json(applied);
    } catch (error) {
      const status = Number((error as { status?: number }).status) || 502;
      req.log.warn({ err: error }, "scheduled stop change apply failed");
      res.status(status).json({ error: error instanceof Error ? error.message : "The queued change could not be applied safely." });
    }
    return;
  }
  const applyAt = new Date(req.body?.applyAt);
  if (!scheduledStopChangeCanBeQueued(applyAt)) {
    res.status(400).json({ error: "Choose an application time at least one minute in the future." });
    return;
  }
  const [updated] = await db.update(scheduledStopChangesTable).set({
    applyAt,
    updatedAt: new Date(),
  }).where(and(
    eq(scheduledStopChangesTable.id, existing.id),
    eq(scheduledStopChangesTable.state, "queued"),
  )).returning();
  res.json(updated);
});

router.post("/admin/schedule-stops", async (req, res) => {
  const areaId = Number(req.body?.areaId);
  const areaName = AREA_NAMES[areaId];
  const canonicalLabel = typeof req.body?.canonicalLabel === "string"
    ? req.body.canonicalLabel.trim().slice(0, 240) : "";
  const address = typeof req.body?.address === "string" ? req.body.address.trim().slice(0, 320) || null : null;
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const category = req.body?.category === undefined ? "both" : stopCategory(req.body.category);
  if (!areaName || canonicalLabel.length < 2 || !isMonseyTrailsServiceCoordinate({ lat, lng }) || !category) {
    res.status(400).json({ error: "Choose an area, a valid category, and coordinates within the Monsey Trails service region." });
    return;
  }
  const proposal: StopChangeProposal = {
    kind: "create", areaId, areaName, canonicalLabel, sourceLabel: canonicalLabel,
    change: { address, lat, lng, category },
  };
  const confirmation = await confirmedImpact(req, proposal);
  if (!confirmation.confirmed) {
    res.status(409).json({
      error: "Impact changed or has not been confirmed. Review the latest impact before adding this stop.",
      code: "IMPACT_CONFIRMATION_REQUIRED",
      impact: confirmation.preview,
    });
    return;
  }
  const duplicate = (await db.select().from(scheduleStopOverridesTable))
    .find(row => !row.suppressed && Number(row.areaId) === areaId
      && comparableLabel(row.canonicalLabel) === comparableLabel(canonicalLabel));
  if (duplicate || integratedScheduleStops().some(stop => stop.areaId === areaId
    && comparableLabel(stop.canonicalLabel) === comparableLabel(canonicalLabel))) {
    res.status(409).json({ error: "A stop with this name already exists in the selected area." });
    return;
  }
  const areaCustom = await db.select().from(scheduleStopOverridesTable).where(and(
    eq(scheduleStopOverridesTable.areaId, String(areaId)),
    eq(scheduleStopOverridesTable.isCustom, true),
  ));
  const sequence = Math.max(0, ...areaCustom.map(row => row.sequence)) + 1;
  try {
    const { row, affectedPairingCodes } = await db.transaction(async tx => {
      const [saved] = await tx.insert(scheduleStopOverridesTable).values({
        key: `${areaId}:custom:${randomUUID()}`,
        areaId: String(areaId),
        areaName,
        canonicalLabel,
        sourceLabel: canonicalLabel,
        address,
        lat,
        lng,
        category,
        isCustom: true,
        sequence,
        updatedBy: res.locals.adminSubject,
      }).returning();
      const stopOverrides = await tx.select().from(scheduleStopOverridesTable);
      const affectedPairingCodes = await reconcileActiveOfficialTrips(
        tx,
        stopOverrides,
        new Date(),
        areaId,
        { kind: "create", stopId: `custom-${saved.key}` },
      );
      return { row: saved, affectedPairingCodes };
    });
    invalidateScheduleStopCaches();
    for (const pairingCode of affectedPairingCodes) invalidateTripNavigationCache(pairingCode);
    invalidateJourneyTrafficCaches();
    res.status(201).json(stopResponse(row, false));
  } catch (error) {
    req.log.warn({ err: error }, "custom schedule stop creation failed");
    res.status(502).json({ error: "The stop could not be added because active trips could not be updated safely." });
  }
});

router.put("/admin/schedule-stops/:key", async (req, res) => {
  const key = req.params.key;
  const officialStop = integratedScheduleStops()
    .find(item => scheduleStopKey(item.areaId, item.canonicalLabel) === key);
  const [stored] = await db.select().from(scheduleStopOverridesTable)
    .where(eq(scheduleStopOverridesTable.key, key)).limit(1);
  const stop = stored?.isCustom ? {
    areaId: Number(stored.areaId),
    areaName: stored.areaName,
    canonicalLabel: stored.canonicalLabel,
    sourceLabel: stored.sourceLabel,
    lat: stored.lat,
    lng: stored.lng,
    category: stored.category as StopCategory,
  } : officialStop;
  if (!stop) {
    res.status(404).json({ error: "Integrated schedule stop not found." });
    return;
  }
  const categoryProvided = req.body?.category !== undefined;
  const category = categoryProvided ? stopCategory(req.body.category) : null;
  if (categoryProvided && !category) {
    res.status(400).json({ error: "Category must be pickup, dropoff, or both." });
    return;
  }
  const proposal = (await proposalForExistingStop(key, "update", req.body ?? {}))!;
  const confirmation = await confirmedImpact(req, proposal);
  if (!confirmation.confirmed) {
    res.status(409).json({
      error: "Impact changed or has not been confirmed. Review the latest impact before saving.",
      code: "IMPACT_CONFIRMATION_REQUIRED",
      impact: confirmation.preview,
    });
    return;
  }
  const coordinatesProvided = req.body?.lat !== undefined
    || req.body?.lng !== undefined
    || req.body?.address !== undefined;
  if (!coordinatesProvided && !categoryProvided) {
    res.status(400).json({ error: "Provide coordinates or a category to update." });
    return;
  }
  const lat = coordinatesProvided ? Number(req.body?.lat) : (stored?.lat ?? stop.lat);
  const lng = coordinatesProvided ? Number(req.body?.lng) : (stored?.lng ?? stop.lng);
  const address = coordinatesProvided
    ? (typeof req.body?.address === "string" ? req.body.address.trim().slice(0, 320) || null : null)
    : (stored?.address ?? stop.canonicalLabel);
  if (coordinatesProvided) {
    if (!isMonseyTrailsServiceCoordinate({ lat, lng })) {
      res.status(400).json({ error: "Coordinates must be within the Monsey Trails service region." });
      return;
    }
    try {
      const verifiedCoordinates = await reverseGeocodeNavigationCoordinates(lat, lng);
      if (!verifiedCoordinates) {
        res.status(400).json({ error: "No address was found at those coordinates. Check the latitude and longitude." });
        return;
      }
    } catch (error) {
      req.log.warn({ err: error }, "stop coordinate verification failed");
      res.status(502).json({ error: "The coordinates could not be verified right now. Please try again." });
      return;
    }
  }
  const now = new Date();
  const { row, affectedPairingCodes } = await db.transaction(async tx => {
    const [existingOverride] = await tx.select({
      lat: scheduleStopOverridesTable.lat,
      lng: scheduleStopOverridesTable.lng,
    }).from(scheduleStopOverridesTable).where(eq(scheduleStopOverridesTable.key, key)).limit(1);
    const previous = existingOverride ?? { lat: stop.lat, lng: stop.lng };
    const [saved] = await tx.insert(scheduleStopOverridesTable).values({
      key, areaId: String(stop.areaId), areaName: stop.areaName, canonicalLabel: stop.canonicalLabel,
      sourceLabel: stop.sourceLabel, address, lat, lng,
      category: category ?? stored?.category ?? stop.category ?? "both",
      updatedAt: now, updatedBy: res.locals.adminSubject,
    }).onConflictDoUpdate({
      target: scheduleStopOverridesTable.key,
      set: {
        ...(coordinatesProvided ? { address, lat, lng } : {}),
        ...(category ? { category } : {}),
        updatedAt: now,
        updatedBy: res.locals.adminSubject,
      },
    }).returning();
    if (!coordinatesProvided) return { row: saved, affectedPairingCodes: [] };
    const activeTrips = await tx.select().from(liveTripsTable).where(and(
      isNotNull(liveTripsTable.officialRunKey),
      isNull(liveTripsTable.completedAt),
      isNull(liveTripsTable.retiredAt),
    )).for("update");
    const affected: string[] = [];
    for (const trip of activeTrips) {
      if (shouldPreserveActiveTripRoute(trip.status)) continue;
      const patch = applyStopCoordinatesToActiveTrip(trip, stop, previous, {
        lat,
        lng,
        address: address ?? stop.canonicalLabel,
      });
      if (!patch) continue;
      await tx.update(liveTripsTable).set({
        ...patch,
        routeGeometry: [],
        eta: null,
        remainingDistanceMiles: null,
        updatedAt: now,
      }).where(eq(liveTripsTable.pairingCode, trip.pairingCode));
      affected.push(trip.pairingCode);
    }
    return { row: saved, affectedPairingCodes: affected };
  });
  if (coordinatesProvided) {
    invalidateScheduleStopCaches();
    for (const pairingCode of affectedPairingCodes) invalidateTripNavigationCache(pairingCode);
    invalidateJourneyTrafficCaches();
  }
  res.json(stopResponse(row));
});

router.delete("/admin/schedule-stops/:key", async (req, res) => {
  const key = req.params.key;
  const official = integratedScheduleStops()
    .find(item => scheduleStopKey(item.areaId, item.canonicalLabel) === key);
  const [stored] = await db.select().from(scheduleStopOverridesTable)
    .where(eq(scheduleStopOverridesTable.key, key)).limit(1);
  if (!official && !stored) {
    res.status(404).json({ error: "Stop not found." });
    return;
  }
  const proposal = (await proposalForExistingStop(key, "delete"))!;
  const confirmation = await confirmedImpact(req, proposal);
  if (!confirmation.confirmed) {
    res.status(409).json({
      error: "Impact changed or has not been confirmed. Review the latest impact before removing this stop.",
      code: "IMPACT_CONFIRMATION_REQUIRED",
      impact: confirmation.preview,
    });
    return;
  }
  try {
    const affectedPairingCodes = await db.transaction(async tx => {
      const now = new Date();
      if (stored) {
        await tx.update(scheduleStopOverridesTable).set({
          suppressed: true,
          updatedAt: now,
          updatedBy: res.locals.adminSubject,
        }).where(eq(scheduleStopOverridesTable.key, key));
      } else if (official) {
        await tx.insert(scheduleStopOverridesTable).values({
          key,
          areaId: String(official.areaId),
          areaName: official.areaName,
          canonicalLabel: official.canonicalLabel,
          sourceLabel: official.sourceLabel,
          address: official.canonicalLabel,
          lat: official.lat,
          lng: official.lng,
          suppressed: true,
          updatedAt: now,
          updatedBy: res.locals.adminSubject,
        });
      }
      const stopOverrides = await tx.select().from(scheduleStopOverridesTable);
      return reconcileActiveOfficialTrips(
        tx,
        stopOverrides,
        now,
        Number(stored?.areaId ?? official?.areaId),
        {
          kind: "delete",
          canonicalLabel: stored?.canonicalLabel ?? official!.canonicalLabel,
          sourceLabel: stored?.sourceLabel ?? official!.sourceLabel,
        },
      );
    });
    invalidateScheduleStopCaches();
    for (const pairingCode of affectedPairingCodes) invalidateTripNavigationCache(pairingCode);
    invalidateJourneyTrafficCaches();
    res.status(204).end();
  } catch (error) {
    req.log.warn({ err: error }, "schedule stop removal failed");
    const status = Number((error as { status?: number }).status) || 502;
    res.status(status).json({
      error: status === 409 && error instanceof Error
        ? error.message
        : "The stop could not be removed because active trips could not be updated safely.",
    });
  }
});

router.get("/admin/address-search", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length < 3 || query.length > 120) {
    res.status(400).json({ error: "Enter at least 3 characters to search for an address." });
    return;
  }
  const areaId = Number(req.query.areaId);
  const scoped = Number.isInteger(areaId) && AREA_NAMES[areaId] ? `${query}, ${AREA_NAMES[areaId]}` : query;
  try {
    const coordinateMatch = /^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(query);
    if (coordinateMatch) {
      const lat = Number(coordinateMatch[1]);
      const lng = Number(coordinateMatch[2]);
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        res.status(400).json({ error: "Latitude or longitude is outside the valid range." });
        return;
      }
      const result = await reverseGeocodeNavigationCoordinates(lat, lng);
      res.json(result ? [{
        id: `admin-coordinates-${lat}-${lng}`,
        ...result,
      }] : []);
      return;
    }
    const results = await geocodeNavigationQuery(scoped, 8);
    res.json(results.map((result, index) => ({
      id: `admin-${result.location.y}-${result.location.x}-${index}`,
      address: result.address, lat: result.location.y, lng: result.location.x,
      type: result.attributes.Addr_type, score: result.score,
    })));
  } catch (error) {
    req.log.warn({ err: error }, "admin address search failed");
    res.status(502).json({ error: "Address search is temporarily unavailable." });
  }
});

export default router;
