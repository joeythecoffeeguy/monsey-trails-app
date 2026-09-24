import { randomUUID } from "node:crypto";
import { json, Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  dispatchAssignmentsTable,
  dispatchInstructionsTable,
  incidentAffectedAssignmentsTable,
  incidentEventsTable,
  incidentsTable,
  operationalReportsTable,
  serviceDisruptionsTable,
} from "@workspace/db";
import { requireAdminCapability } from "../middlewares/admin-role-policy";

const router: IRouter = Router();
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);
const INCIDENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.use("/admin/incidents", requireAdminCapability("dispatch"));
router.use("/admin/incidents", json());

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function assignmentIds(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return null;
  const ids = [...new Set(value.filter(item => Number.isInteger(item) && item > 0) as number[])];
  return ids.length === value.length ? ids : null;
}

export function nextIncidentStatus(
  current: string,
  eventType: string,
): string {
  if (current === "resolved") return "resolved";
  const statusForEvent: Record<string, string> = {
    replacement_confirmed: "replacement_confirmed",
    driver_instruction_confirmed: "instructions_sent",
    passenger_notice_confirmed: "passenger_notice_published",
  };
  const candidate = statusForEvent[eventType];
  if (!candidate) return current;
  const rank = ["identified", "replacement_confirmed", "instructions_sent", "passenger_notice_published"];
  return rank.indexOf(candidate) > rank.indexOf(current) ? candidate : current;
}

export function missingIncidentEvidence(eventTypes: Iterable<string>) {
  const completed = new Set(eventTypes);
  return [
    [["replacement_confirmed", "replacement_not_needed"], "replacement"],
    [["driver_instruction_confirmed", "driver_instruction_not_needed"], "driver instruction"],
    [["passenger_notice_confirmed", "passenger_notice_not_needed"], "passenger notice"],
  ].filter(([events]) => !(events as string[]).some(event => completed.has(event)))
    .map(([, label]) => label as string);
}

async function incidentResponse(id: string) {
  const [incident] = await db.select().from(incidentsTable).where(eq(incidentsTable.id, id)).limit(1);
  if (!incident) return null;
  const [affected, events] = await Promise.all([
    db.select({ assignment: dispatchAssignmentsTable })
      .from(incidentAffectedAssignmentsTable)
      .innerJoin(dispatchAssignmentsTable, eq(
        dispatchAssignmentsTable.id,
        incidentAffectedAssignmentsTable.assignmentId,
      ))
      .where(eq(incidentAffectedAssignmentsTable.incidentId, id))
      .orderBy(asc(incidentAffectedAssignmentsTable.addedAt)),
    db.select().from(incidentEventsTable)
      .where(eq(incidentEventsTable.incidentId, id))
      .orderBy(asc(incidentEventsTable.createdAt)),
  ]);
  return {
    ...incident,
    affectedAssignments: affected.map(({ assignment }) => assignment),
    events,
  };
}

async function appendEvent(
  incidentId: string,
  actorSubject: string,
  eventType: string,
  note: string,
  evidence?: { type: string; id: string },
) {
  return db.transaction(async tx => {
    const [incident] = await tx.select().from(incidentsTable).where(and(
      eq(incidentsTable.id, incidentId),
      isNull(incidentsTable.resolvedAt),
    )).limit(1);
    if (!incident) return null;
    if (evidence) {
      const [existing] = await tx.select().from(incidentEventsTable).where(and(
        eq(incidentEventsTable.incidentId, incidentId),
        eq(incidentEventsTable.eventType, eventType),
        eq(incidentEventsTable.evidenceType, evidence.type),
        eq(incidentEventsTable.evidenceId, evidence.id),
      )).limit(1);
      if (existing) return incident;
    }
    await tx.insert(incidentEventsTable).values({
      id: randomUUID(),
      incidentId,
      eventType,
      note,
      actorSubject,
      evidenceType: evidence?.type ?? null,
      evidenceId: evidence?.id ?? null,
    });
    const status = nextIncidentStatus(incident.status, eventType);
    const [updated] = await tx.update(incidentsTable).set({
      status,
      updatedAt: new Date(),
    }).where(eq(incidentsTable.id, incidentId)).returning();
    return updated;
  });
}

router.get("/admin/incidents", async (req, res): Promise<void> => {
  const includeResolved = req.query.includeResolved === "true";
  const rows = await db.select().from(incidentsTable)
    .where(includeResolved ? undefined : isNull(incidentsTable.resolvedAt))
    .orderBy(desc(incidentsTable.updatedAt))
    .limit(200);
  const responses = await Promise.all(rows.map(row => incidentResponse(row.id)));
  res.json(responses.filter(Boolean));
});

router.get("/admin/incidents/:id", async (req, res): Promise<void> => {
  if (!INCIDENT_ID.test(req.params.id)) {
    res.status(400).json({ error: "Choose a valid incident." });
    return;
  }
  const incident = await incidentResponse(req.params.id);
  if (!incident) {
    res.status(404).json({ error: "Incident not found." });
    return;
  }
  res.json(incident);
});

router.post("/admin/incidents", async (req, res): Promise<void> => {
  const title = text(req.body?.title, 160);
  const description = text(req.body?.description, 2_000);
  const severity = text(req.body?.severity, 16);
  const affectedAssignmentIds = assignmentIds(req.body?.affectedAssignmentIds);
  const operationalReportId = text(req.body?.operationalReportId, 120) || null;
  if (!title || !description || !SEVERITIES.has(severity) || !affectedAssignmentIds) {
    res.status(400).json({ error: "Provide an issue, severity, and at least one existing affected trip." });
    return;
  }
  const assignments = await db.select().from(dispatchAssignmentsTable)
    .where(inArray(dispatchAssignmentsTable.id, affectedAssignmentIds));
  if (assignments.length !== affectedAssignmentIds.length) {
    res.status(409).json({ error: "One or more affected trips no longer exist." });
    return;
  }
  if (operationalReportId) {
    const [report] = await db.select().from(operationalReportsTable)
      .where(eq(operationalReportsTable.id, operationalReportId)).limit(1);
    if (!report || !affectedAssignmentIds.includes(report.assignmentId)) {
      res.status(409).json({ error: "The operational report must belong to an affected trip." });
      return;
    }
  }
  const id = randomUUID();
  const actor = String(res.locals.adminSubject);
  await db.transaction(async tx => {
    await tx.insert(incidentsTable).values({
      id,
      title,
      description,
      severity,
      operationalReportId,
      openedBy: actor,
    });
    await tx.insert(incidentAffectedAssignmentsTable).values(
      affectedAssignmentIds.map(assignmentId => ({ incidentId: id, assignmentId })),
    );
    await tx.insert(incidentEventsTable).values({
      id: randomUUID(),
      incidentId: id,
      eventType: "issue_identified",
      note: operationalReportId
        ? "Issue identified from an operational report and affected trips recorded."
        : "Issue identified and affected trips recorded.",
      actorSubject: actor,
      evidenceType: operationalReportId ? "operational_report" : null,
      evidenceId: operationalReportId,
    });
  });
  res.locals.adminAudit = { action: "create.incident", targetType: "incident", targetId: id, after: { severity, affectedTripCount: affectedAssignmentIds.length } };
  res.status(201).json(await incidentResponse(id));
});

router.post("/admin/incidents/:id/notes", async (req, res): Promise<void> => {
  const note = text(req.body?.note, 2_000);
  if (!INCIDENT_ID.test(req.params.id) || !note) {
    res.status(400).json({ error: "A progress note is required." });
    return;
  }
  const updated = await appendEvent(req.params.id, String(res.locals.adminSubject), "progress_note", note);
  if (!updated) {
    res.status(409).json({ error: "Only an open incident can receive progress notes." });
    return;
  }
  res.locals.adminAudit = { action: "add.incident_note", targetType: "incident", targetId: req.params.id };
  res.json(await incidentResponse(req.params.id));
});

router.post("/admin/incidents/:id/confirm-replacement", async (req, res): Promise<void> => {
  const replacementAssignmentId = req.body?.replacementAssignmentId;
  if (!INCIDENT_ID.test(req.params.id) || !Number.isInteger(replacementAssignmentId) || replacementAssignmentId < 1) {
    res.status(400).json({ error: "Choose a replacement from an existing dispatch assignment." });
    return;
  }
  const [replacement] = await db.select().from(dispatchAssignmentsTable).where(and(
    eq(dispatchAssignmentsTable.id, replacementAssignmentId),
    isNull(dispatchAssignmentsTable.endedAt),
  )).limit(1);
  if (!replacement) {
    res.status(409).json({ error: "The selected replacement is not an active dispatch assignment." });
    return;
  }
  const [affected] = await db.select().from(incidentAffectedAssignmentsTable).where(and(
    eq(incidentAffectedAssignmentsTable.incidentId, req.params.id),
    eq(incidentAffectedAssignmentsTable.assignmentId, replacementAssignmentId),
  )).limit(1);
  if (affected) {
    res.status(409).json({ error: "The replacement must be a different, verified dispatch assignment." });
    return;
  }
  const incident = await db.transaction(async tx => {
    const [current] = await tx.select().from(incidentsTable).where(and(
      eq(incidentsTable.id, req.params.id),
      isNull(incidentsTable.resolvedAt),
    )).limit(1);
    if (!current) return null;
    const evidenceId = String(replacement.id);
    const [existing] = await tx.select().from(incidentEventsTable).where(and(
      eq(incidentEventsTable.incidentId, req.params.id),
      eq(incidentEventsTable.eventType, "replacement_confirmed"),
      eq(incidentEventsTable.evidenceId, evidenceId),
    )).limit(1);
    if (!existing) {
      await tx.insert(incidentEventsTable).values({
        id: randomUUID(),
        incidentId: req.params.id,
        eventType: "replacement_confirmed",
        note: `Replacement dispatch assignment ${replacement.id} for coach ${replacement.busNumber} verified from server records.`,
        actorSubject: String(res.locals.adminSubject),
        evidenceType: "dispatch_assignment",
        evidenceId,
      });
    }
    const [saved] = await tx.update(incidentsTable).set({
      replacementAssignmentId,
      status: nextIncidentStatus(current.status, "replacement_confirmed"),
      updatedAt: new Date(),
    }).where(eq(incidentsTable.id, req.params.id)).returning();
    return saved;
  });
  if (!incident) {
    res.status(409).json({ error: "Only an open incident can record a replacement." });
    return;
  }
  res.locals.adminAudit = { action: "confirm.incident_replacement", targetType: "incident", targetId: req.params.id, after: { replacementAssignmentId } };
  res.json(await incidentResponse(req.params.id));
});

router.post("/admin/incidents/:id/confirm-instruction", async (req, res): Promise<void> => {
  const instructionId = text(req.body?.instructionId, 120);
  if (!INCIDENT_ID.test(req.params.id) || !instructionId) {
    res.status(400).json({ error: "A persisted driver instruction is required." });
    return;
  }
  const [instruction] = await db.select().from(dispatchInstructionsTable)
    .where(eq(dispatchInstructionsTable.id, instructionId)).limit(1);
  const incident = await incidentResponse(req.params.id);
  const permittedIds = new Set([
    ...(incident?.affectedAssignments.map(item => item.id) ?? []),
    incident?.replacementAssignmentId,
  ]);
  if (!instruction || !incident || !permittedIds.has(instruction.assignmentId)) {
    res.status(409).json({ error: "The instruction is not server evidence for this incident's trips." });
    return;
  }
  const updated = await appendEvent(
    req.params.id,
    String(res.locals.adminSubject),
    "driver_instruction_confirmed",
    `Driver instruction for coach ${instruction.busNumber} recorded; delivery state remains available in Communications.`,
    { type: "dispatch_instruction", id: instruction.id },
  );
  if (!updated) {
    res.status(409).json({ error: "Only an open incident can record an instruction." });
    return;
  }
  res.locals.adminAudit = { action: "confirm.incident_instruction", targetType: "incident", targetId: req.params.id };
  res.json(await incidentResponse(req.params.id));
});

router.post("/admin/incidents/:id/confirm-notice", async (req, res): Promise<void> => {
  const disruptionId = text(req.body?.disruptionId, 120);
  if (!INCIDENT_ID.test(req.params.id) || !disruptionId) {
    res.status(400).json({ error: "A persisted passenger notice is required." });
    return;
  }
  const [notice] = await db.select().from(serviceDisruptionsTable).where(and(
    eq(serviceDisruptionsTable.id, disruptionId),
    isNull(serviceDisruptionsTable.clearedAt),
  )).limit(1);
  const incident = await incidentResponse(req.params.id);
  if (!notice || !incident || !incident.affectedAssignments.some(item => item.officialRunKey === notice.officialRunKey)) {
    res.status(409).json({ error: "The notice is not current server evidence for an affected trip." });
    return;
  }
  const updated = await appendEvent(
    req.params.id,
    String(res.locals.adminSubject),
    "passenger_notice_confirmed",
    `Passenger ${notice.type.replaceAll("_", " ")} notice verified for an affected published trip.`,
    { type: "service_disruption", id: notice.id },
  );
  if (!updated) {
    res.status(409).json({ error: "Only an open incident can record a passenger notice." });
    return;
  }
  res.locals.adminAudit = { action: "confirm.incident_notice", targetType: "incident", targetId: req.params.id };
  res.json(await incidentResponse(req.params.id));
});

router.post("/admin/incidents/:id/not-needed", async (req, res): Promise<void> => {
  const step = req.body?.step;
  const reason = text(req.body?.reason, 2_000);
  const eventTypes: Record<string, string> = {
    replacement: "replacement_not_needed",
    driver_instruction: "driver_instruction_not_needed",
    passenger_notice: "passenger_notice_not_needed",
  };
  const eventType = eventTypes[step];
  if (!INCIDENT_ID.test(req.params.id) || !eventType || reason.length < 10) {
    res.status(400).json({ error: "Choose a step and document why it is not needed using at least 10 characters." });
    return;
  }
  const updated = await appendEvent(
    req.params.id,
    String(res.locals.adminSubject),
    eventType,
    `Marked ${String(step).replaceAll("_", " ")} not needed: ${reason}`,
  );
  if (!updated) {
    res.status(409).json({ error: "Only an open incident can document a step as not needed." });
    return;
  }
  res.locals.adminAudit = { action: "document.incident_step_not_needed", targetType: "incident", targetId: req.params.id, after: { step } };
  res.json(await incidentResponse(req.params.id));
});

router.post("/admin/incidents/:id/resolve", async (req, res): Promise<void> => {
  const resolution = text(req.body?.resolution, 2_000);
  if (!INCIDENT_ID.test(req.params.id) || req.body?.confirmation !== "RESOLVE" || !resolution) {
    res.status(400).json({ error: "Enter a resolution and explicitly confirm RESOLVE." });
    return;
  }
  const events = await db.select({ eventType: incidentEventsTable.eventType })
    .from(incidentEventsTable).where(eq(incidentEventsTable.incidentId, req.params.id));
  const missing = missingIncidentEvidence(events.map(item => item.eventType));
  if (missing.length) {
    res.status(409).json({ error: `Record server evidence before resolving: ${missing.join(", ")}.` });
    return;
  }
  const actor = String(res.locals.adminSubject);
  const now = new Date();
  const updated = await db.transaction(async tx => {
    const [closed] = await tx.update(incidentsTable).set({
      status: "resolved",
      resolvedAt: now,
      resolvedBy: actor,
      resolution,
      updatedAt: now,
    }).where(and(
      eq(incidentsTable.id, req.params.id),
      isNull(incidentsTable.resolvedAt),
    )).returning();
    if (!closed) return null;
    await tx.insert(incidentEventsTable).values({
      id: randomUUID(),
      incidentId: req.params.id,
      eventType: "resolved",
      note: resolution,
      actorSubject: actor,
    });
    return closed;
  });
  if (!updated) {
    res.status(409).json({ error: "This incident is already resolved or does not exist." });
    return;
  }
  res.locals.adminAudit = { action: "resolve.incident", targetType: "incident", targetId: req.params.id, after: { status: "resolved" } };
  res.json(await incidentResponse(req.params.id));
});

export default router;