import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  AcknowledgeDispatchInstructionParams,
  AcknowledgeDispatchInstructionResponse,
  CreateDispatchInstructionBody,
  CreateDispatchInstructionResponse,
  CreateDriverOperationalReportBody,
  CreateDriverOperationalReportResponse,
  GetAdminCommunicationsResponse,
  GetDriverCommunicationsResponse,
  MarkDispatchInstructionDeliveredParams,
  MarkDispatchInstructionDeliveredResponse,
  ResolveOperationalReportBody,
  ResolveOperationalReportParams,
  ResolveOperationalReportResponse,
} from "@workspace/api-zod";
import {
  db,
  dispatchAssignmentsTable,
  dispatchInstructionsTable,
  liveTripsTable,
  operationalReportsTable,
  type DispatchInstructionRow,
  type LiveTripRow,
  type OperationalReportRow,
} from "@workspace/db";
import { requireDriverProfile } from "./driver-profile";
import { requireAdmin } from "./admin-drivers";

const router: IRouter = Router();
const STOPPED_SPEED_MPH = 1;
const TELEMETRY_MAX_AGE_MS = 30_000;

function reportResponse(row: OperationalReportRow) {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    busNumber: row.busNumber,
    officialRunKey: row.officialRunKey,
    category: row.category,
    location: { lat: row.latitude, lng: row.longitude },
    locationObservedAt: row.locationObservedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolution: row.resolution,
  };
}

function instructionResponse(row: DispatchInstructionRow) {
  return {
    id: row.id,
    assignmentId: row.assignmentId,
    busNumber: row.busNumber,
    officialRunKey: row.officialRunKey,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
  };
}

export function stoppedSafety(row: LiveTripRow | undefined, now = Date.now()) {
  if (!row || row.completedAt || row.retiredAt || !["ready", "running"].includes(row.status)) {
    return { stopped: false, reason: "No current assigned coach is available." };
  }
  if (
    row.speedMph === null
    || !Number.isFinite(row.speedMph)
    || !row.locationUpdatedAt
    || row.currentLat === null
    || row.currentLng === null
  ) {
    return { stopped: false, reason: "A fresh GPS speed is required before using communications." };
  }
  if (now - row.locationUpdatedAt.getTime() > TELEMETRY_MAX_AGE_MS) {
    return { stopped: false, reason: "GPS speed is stale. Remain stopped and wait for a fresh update." };
  }
  if (row.speedMph > STOPPED_SPEED_MPH) {
    return { stopped: false, reason: "Communications are locked while the coach is moving." };
  }
  return { stopped: true, reason: "Coach is confirmed stopped by fresh GPS telemetry." };
}

export function instructionLifecyclePatch(
  row: Pick<DispatchInstructionRow, "deliveredAt" | "acknowledgedAt">,
  event: "delivered" | "acknowledged",
  now: Date,
) {
  if (event === "delivered") {
    return { deliveredAt: row.deliveredAt ?? now, acknowledgedAt: row.acknowledgedAt };
  }
  return {
    deliveredAt: row.deliveredAt ?? now,
    acknowledgedAt: row.acknowledgedAt ?? now,
  };
}

export function matchesAssignmentScope(
  assignment: Pick<DispatchInstructionRow, "assignmentId" | "driverSubject" | "busNumber" | "officialRunKey">,
  resource: Pick<DispatchInstructionRow, "assignmentId" | "driverSubject" | "busNumber" | "officialRunKey">,
) {
  return assignment.assignmentId === resource.assignmentId
    && assignment.driverSubject === resource.driverSubject
    && assignment.busNumber === resource.busNumber
    && assignment.officialRunKey === resource.officialRunKey;
}

async function currentDriverAssignment(subject: string) {
  const [assignment] = await db.select().from(dispatchAssignmentsTable).where(and(
    eq(dispatchAssignmentsTable.driverSubject, subject),
    isNull(dispatchAssignmentsTable.endedAt),
  )).orderBy(desc(dispatchAssignmentsTable.assignedAt)).limit(1);
  if (!assignment) return { assignment: undefined, trip: undefined };
  const [trip] = await db.select().from(liveTripsTable).where(and(
    eq(liveTripsTable.pairingCode, assignment.busNumber),
    eq(liveTripsTable.ownerSubject, subject),
    eq(liveTripsTable.officialRunKey, assignment.officialRunKey),
    isNull(liveTripsTable.completedAt),
    isNull(liveTripsTable.retiredAt),
  )).limit(1);
  return { assignment, trip };
}

router.get("/driver/communications", requireDriverProfile, async (_req, res): Promise<void> => {
  const subject = res.locals.driverSubject as string;
  const { assignment, trip } = await currentDriverAssignment(subject);
  if (!assignment) {
    res.json(GetDriverCommunicationsResponse.parse({
      reports: [],
      instructions: [],
      safety: { stopped: false, reason: "Choose a current dispatch assignment first." },
    }));
    return;
  }
  const [reports, instructions] = await Promise.all([
    db.select().from(operationalReportsTable).where(and(
      eq(operationalReportsTable.assignmentId, assignment.id),
      eq(operationalReportsTable.driverSubject, subject),
    )).orderBy(desc(operationalReportsTable.createdAt)).limit(20),
    db.select().from(dispatchInstructionsTable).where(and(
      eq(dispatchInstructionsTable.assignmentId, assignment.id),
      eq(dispatchInstructionsTable.driverSubject, subject),
    )).orderBy(desc(dispatchInstructionsTable.createdAt)).limit(50),
  ]);
  res.json(GetDriverCommunicationsResponse.parse({
    reports: reports.map(reportResponse),
    instructions: instructions.map(instructionResponse),
    safety: stoppedSafety(trip),
  }));
});

router.post("/driver/operational-reports", requireDriverProfile, async (req, res): Promise<void> => {
  const input = CreateDriverOperationalReportBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: input.error.message });
    return;
  }
  const subject = res.locals.driverSubject as string;
  const { assignment, trip } = await currentDriverAssignment(subject);
  if (!assignment || !trip) {
    res.status(403).json({ error: "A current dispatch assignment is required." });
    return;
  }
  const safety = stoppedSafety(trip);
  if (!safety.stopped || !trip.locationUpdatedAt || trip.currentLat === null || trip.currentLng === null) {
    res.status(409).json({ error: safety.reason, code: "COACH_NOT_CONFIRMED_STOPPED" });
    return;
  }
  const [created] = await db.insert(operationalReportsTable).values({
    id: randomUUID(),
    assignmentId: assignment.id,
    busNumber: assignment.busNumber,
    driverSubject: subject,
    officialRunKey: assignment.officialRunKey,
    category: input.data.category,
    latitude: trip.currentLat,
    longitude: trip.currentLng,
    locationObservedAt: trip.locationUpdatedAt,
  }).returning();
  res.status(201).json(CreateDriverOperationalReportResponse.parse(reportResponse(created)));
});

router.post("/driver/dispatch-instructions/:id/delivered", requireDriverProfile, async (req, res): Promise<void> => {
  const params = MarkDispatchInstructionDeliveredParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const subject = res.locals.driverSubject as string;
  const { assignment } = await currentDriverAssignment(subject);
  if (!assignment) {
    res.status(404).json({ error: "Instruction not found for the current assignment." });
    return;
  }
  const now = new Date();
  const [updated] = await db.update(dispatchInstructionsTable).set({ deliveredAt: now }).where(and(
    eq(dispatchInstructionsTable.id, params.data.id),
    eq(dispatchInstructionsTable.assignmentId, assignment.id),
    eq(dispatchInstructionsTable.driverSubject, subject),
    isNull(dispatchInstructionsTable.deliveredAt),
  )).returning();
  if (updated) {
    res.json(MarkDispatchInstructionDeliveredResponse.parse(instructionResponse(updated)));
    return;
  }
  const [existing] = await db.select().from(dispatchInstructionsTable).where(and(
    eq(dispatchInstructionsTable.id, params.data.id),
    eq(dispatchInstructionsTable.assignmentId, assignment.id),
    eq(dispatchInstructionsTable.driverSubject, subject),
  )).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Instruction not found for the current assignment." });
    return;
  }
  res.json(MarkDispatchInstructionDeliveredResponse.parse(instructionResponse(existing)));
});

router.post("/driver/dispatch-instructions/:id/acknowledge", requireDriverProfile, async (req, res): Promise<void> => {
  const params = AcknowledgeDispatchInstructionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const subject = res.locals.driverSubject as string;
  const { assignment, trip } = await currentDriverAssignment(subject);
  const safety = stoppedSafety(trip);
  if (!assignment || !safety.stopped) {
    res.status(409).json({ error: safety.reason, code: "COACH_NOT_CONFIRMED_STOPPED" });
    return;
  }
  const now = new Date();
  const [updated] = await db.update(dispatchInstructionsTable).set({
    deliveredAt: sql`coalesce(${dispatchInstructionsTable.deliveredAt}, ${now})`,
    acknowledgedAt: now,
  }).where(and(
    eq(dispatchInstructionsTable.id, params.data.id),
    eq(dispatchInstructionsTable.assignmentId, assignment.id),
    eq(dispatchInstructionsTable.driverSubject, subject),
    isNull(dispatchInstructionsTable.acknowledgedAt),
  )).returning();
  if (updated) {
    res.json(AcknowledgeDispatchInstructionResponse.parse(instructionResponse(updated)));
    return;
  }
  const [existing] = await db.select().from(dispatchInstructionsTable).where(and(
    eq(dispatchInstructionsTable.id, params.data.id),
    eq(dispatchInstructionsTable.assignmentId, assignment.id),
    eq(dispatchInstructionsTable.driverSubject, subject),
  )).limit(1);
  if (!existing) {
    res.status(404).json({ error: "Instruction not found for the current assignment." });
    return;
  }
  res.json(AcknowledgeDispatchInstructionResponse.parse(instructionResponse(existing)));
});

router.get("/admin/communications", requireAdmin, async (_req, res): Promise<void> => {
  const [reports, instructions] = await Promise.all([
    db.select().from(operationalReportsTable).orderBy(desc(operationalReportsTable.createdAt)).limit(200),
    db.select().from(dispatchInstructionsTable).orderBy(desc(dispatchInstructionsTable.createdAt)).limit(200),
  ]);
  res.json(GetAdminCommunicationsResponse.parse({
    reports: reports.map(reportResponse),
    instructions: instructions.map(instructionResponse),
  }));
});

router.post("/admin/dispatch-instructions", requireAdmin, async (req, res): Promise<void> => {
  const input = CreateDispatchInstructionBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: input.error.message });
    return;
  }
  if (!input.data.message.trim()) {
    res.status(400).json({ error: "Instruction text is required." });
    return;
  }
  const [assignment] = await db.select().from(dispatchAssignmentsTable).where(and(
    eq(dispatchAssignmentsTable.id, input.data.assignmentId),
    isNull(dispatchAssignmentsTable.endedAt),
  )).limit(1);
  if (!assignment) {
    res.status(409).json({ error: "That dispatch assignment is no longer active." });
    return;
  }
  const [created] = await db.insert(dispatchInstructionsTable).values({
    id: randomUUID(),
    assignmentId: assignment.id,
    busNumber: assignment.busNumber,
    driverSubject: assignment.driverSubject,
    officialRunKey: assignment.officialRunKey,
    message: input.data.message.trim(),
    createdBy: res.locals.adminSubject as string,
  }).returning();
  res.status(201).json(CreateDispatchInstructionResponse.parse(instructionResponse(created)));
});

router.post("/admin/operational-reports/:id/resolve", requireAdmin, async (req, res): Promise<void> => {
  const params = ResolveOperationalReportParams.safeParse(req.params);
  const input = ResolveOperationalReportBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!input.success) {
    res.status(400).json({ error: input.error.message });
    return;
  }
  if (!input.data.resolution.trim()) {
    res.status(400).json({ error: "Resolution text is required." });
    return;
  }
  const [updated] = await db.update(operationalReportsTable).set({
    resolvedAt: new Date(),
    resolvedBy: res.locals.adminSubject as string,
    resolution: input.data.resolution.trim(),
  }).where(and(
    eq(operationalReportsTable.id, params.data.id),
    isNull(operationalReportsTable.resolvedAt),
  )).returning();
  if (!updated) {
    res.status(404).json({ error: "Unresolved operational report not found." });
    return;
  }
  res.json(ResolveOperationalReportResponse.parse(reportResponse(updated)));
});

export default router;