import { createHash, randomUUID } from "node:crypto";
import { json, Router, type IRouter } from "express";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db, dispatchAssignmentsTable, serviceDisruptionsTable } from "@workspace/db";
import { requireAnyAdminCapability } from "../middlewares/admin-role-policy";
import { publicServiceDisruption } from "../lib/service-disruptions";
import { resolveOfficialAssignment } from "./schedule";

const router: IRouter = Router();
const RUN_KEY = /^\d{4}-\d{2}-\d{2}\|[123]\|\d{1,2}\|\d{1,2}\|[^|]{1,80}$/;
const TYPES = new Set(["delay", "cancellation", "detour", "boarding_change"]);
const UNSAFE = /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const approvals = new Map<string, {
  subject: string;
  digest: string;
  expiresAt: number;
  payload: CommunicationInput;
}>();

type CommunicationInput = {
  communicationGroupId: string | null;
  officialRunKeys: string[];
  type: "delay" | "cancellation" | "detour" | "boarding_change";
  message: string;
  delayMinutes: number | null;
  stopName: string | null;
  startsAt: Date;
  expiresAt: Date;
  targetCoachNumbers: string[];
};

export function isSingleRouteDateRunGroup(runKeys: string[]) {
  return runKeys.length > 0
    && runKeys.length <= 100
    && runKeys.every(key => RUN_KEY.test(key))
    && new Set(runKeys.map(key => key.split("|").slice(0, 4).join("|"))).size === 1;
}

export function coachTargetsForRuns<T extends { assignedCoaches: string[] }>(
  runs: T[],
  selectedCoaches: string[],
) {
  const mapped = runs.map(run => ({
    ...run,
    selectedCoaches: selectedCoaches.filter(coach => run.assignedCoaches.includes(coach)),
  }));
  const resolved = new Set(mapped.flatMap(run => run.selectedCoaches));
  return {
    affectedRuns: selectedCoaches.length ? mapped.filter(run => run.selectedCoaches.length) : mapped,
    unresolvedCoaches: selectedCoaches.filter(coach => !resolved.has(coach)),
  };
}

export function communicationPublicationStatus(row: {
  startsAt: Date;
  expiresAt: Date;
  clearedAt: Date | null;
}, now = new Date()) {
  if (row.clearedAt) return "withdrawn";
  if (row.expiresAt <= now) return "expired";
  if (row.startsAt > now) return "scheduled";
  return "published";
}

function normalize(body: unknown): CommunicationInput | { error: string } {
  const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const officialRunKeys = Array.isArray(value.officialRunKeys)
    ? [...new Set(value.officialRunKeys.filter((item): item is string => typeof item === "string").map(item => item.trim()))]
    : typeof value.officialRunKey === "string" ? [value.officialRunKey.trim()] : [];
  const type = typeof value.type === "string" ? value.type : "";
  const message = typeof value.message === "string" ? value.message.trim().replace(/[ \t]+/g, " ") : "";
  const stopName = typeof value.stopName === "string" ? value.stopName.trim().replace(/\s+/g, " ") || null : null;
  const startsAt = new Date(typeof value.startsAt === "string" ? value.startsAt : Date.now());
  const expiresAt = new Date(typeof value.expiresAt === "string" ? value.expiresAt : "");
  const delayMinutes = type === "delay" && Number.isInteger(value.delayMinutes)
    ? value.delayMinutes as number : null;
  const targetCoachNumbers = Array.isArray(value.targetCoachNumbers)
    ? [...new Set(value.targetCoachNumbers
      .filter((item): item is string => typeof item === "string")
      .map(item => item.trim())
      .filter(Boolean))]
    : [];
  const communicationGroupId = typeof value.communicationGroupId === "string" && value.communicationGroupId
    ? value.communicationGroupId : typeof value.communicationId === "string" && value.communicationId ? value.communicationId : null;
  if (!isSingleRouteDateRunGroup(officialRunKeys) || !TYPES.has(type) || !message || message.length > 500
      || UNSAFE.test(message) || (stopName && UNSAFE.test(stopName))
      || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(expiresAt.getTime())
      || expiresAt <= startsAt || expiresAt.getTime() > Date.now() + 30 * 86_400_000
      || (type === "delay" && (!delayMinutes || delayMinutes < 1 || delayMinutes > 1440))
      || targetCoachNumbers.some(coach => !/^[A-Za-z0-9-]{1,6}$/.test(coach))) {
    return { error: "Check the exact trip, template fields, start, expiry, and selected coaches." };
  }
  return {
    communicationGroupId,
    officialRunKeys,
    type: type as CommunicationInput["type"],
    message,
    delayMinutes,
    stopName: type === "boarding_change" ? stopName : null,
    startsAt,
    expiresAt,
    targetCoachNumbers,
  };
}

function digest(input: CommunicationInput) {
  return createHash("sha256").update(JSON.stringify({
    ...input,
    startsAt: input.startsAt.toISOString(),
    expiresAt: input.expiresAt.toISOString(),
  })).digest("hex");
}

async function resolveTarget(input: CommunicationInput) {
  const resolvedRuns = await Promise.all(input.officialRunKeys.map(async officialRunKey => {
    const official = await resolveOfficialAssignment(officialRunKey);
    const assignments = await db.select({
      busNumber: dispatchAssignmentsTable.busNumber,
    }).from(dispatchAssignmentsTable).where(and(
      inArray(dispatchAssignmentsTable.officialRunKey, official.equivalentRunKeys),
      isNull(dispatchAssignmentsTable.endedAt),
    ));
    const assignedCoaches = [...new Set(assignments.map(item => item.busNumber))];
    return {
      canonicalRunKey: officialRunKey,
      equivalentRunKeys: official.equivalentRunKeys,
      scheduledDepartureAt: official.scheduledDepartureAt.toISOString(),
      assignedCoaches,
      selectedCoaches: input.targetCoachNumbers.filter(coach => assignedCoaches.includes(coach)),
    };
  }));
  const mapped = coachTargetsForRuns(resolvedRuns, input.targetCoachNumbers);
  const unresolved = mapped.unresolvedCoaches;
  if (unresolved.length) {
    throw Object.assign(new Error(`These coaches are not assigned to any selected run: ${unresolved.join(", ")}.`), { status: 409 });
  }
  const affectedRuns = mapped.affectedRuns;
  if (!affectedRuns.length) throw Object.assign(new Error("No selected coach matches a selected run."), { status: 409 });
  return {
    affectedRuns,
    affectedRunCount: affectedRuns.length,
    selectedCoachCount: new Set(affectedRuns.flatMap(run => run.selectedCoaches)).size,
  };
}

function response(row: typeof serviceDisruptionsTable.$inferSelect) {
  return {
    ...publicServiceDisruption(row),
    publicationStatus: communicationPublicationStatus(row),
    measuredReceipt: {
      status: "not_measured",
      passengerReadCount: null,
      explanation: "Publication makes the notice eligible for matching passenger views. Passenger reading is not measured.",
    },
  };
}

router.get(
  "/admin/passenger-communications",
  requireAnyAdminCapability(["dispatch", "content"]),
  async (_req, res): Promise<void> => {
    const rows = await db.select().from(serviceDisruptionsTable)
      .orderBy(desc(serviceDisruptionsTable.updatedAt)).limit(200);
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.communicationGroupId ?? row.id;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    res.json([...groups.entries()].map(([groupId, groupedRows]) => {
      const currentRows = groupedRows.filter(row => !row.clearedAt);
      const items = (currentRows.length ? currentRows : groupedRows).map(response);
      return ({
      ...items[0],
      id: groupId,
      communicationGroupId: groupId,
      officialRunKeys: items.map(item => item.officialRunKey),
      targetCoachNumbers: [...new Set(items.flatMap(item => item.targetCoachNumbers ?? []))],
      affectedRunCount: items.length,
      publicationStatus: items.every(item => item.publicationStatus === "withdrawn") ? "withdrawn"
        : items.every(item => item.publicationStatus === "expired") ? "expired"
          : items.some(item => item.publicationStatus === "published") ? "published" : "scheduled",
      });
    }));
  },
);

router.post(
  "/admin/passenger-communications/preview",
  requireAnyAdminCapability(["dispatch", "content"]),
  json(),
  async (req, res): Promise<void> => {
    const input = normalize(req.body);
    if ("error" in input) {
      res.status(400).json({ error: input.error });
      return;
    }
    let target;
    try {
      target = await resolveTarget(input);
    } catch (error) {
      const status = (error as { status?: number }).status === 409 ? 409 : 400;
      res.status(status).json({ error: (error as Error).message || "The exact published trip could not be resolved." });
      return;
    }
    if (input.communicationGroupId) {
      const [current] = await db.select().from(serviceDisruptionsTable)
        .where(and(or(
          eq(serviceDisruptionsTable.communicationGroupId, input.communicationGroupId),
          eq(serviceDisruptionsTable.id, input.communicationGroupId),
        ),
          isNull(serviceDisruptionsTable.clearedAt),
        )).limit(1);
      if (!current || current.clearedAt) {
        res.status(404).json({ error: "This communication is no longer editable." });
        return;
      }
    }
    const approvalToken = randomUUID();
    approvals.set(approvalToken, {
      subject: res.locals.adminSubject,
      digest: digest(input),
      expiresAt: Date.now() + 15 * 60_000,
      payload: input,
    });
    res.json({
      approvalToken,
      approvalExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      preview: {
        type: input.type,
        message: input.message,
        delayMinutes: input.delayMinutes,
        stopName: input.stopName,
        startsAt: input.startsAt.toISOString(),
        expiresAt: input.expiresAt.toISOString(),
      },
      target,
      affectedRunCount: target.affectedRunCount,
      publicationStatus: input.startsAt > new Date() ? "scheduled" : "ready_to_publish",
      measuredReceipt: { status: "not_measured", passengerReadCount: null },
    });
  },
);

router.post(
  "/admin/passenger-communications/publish",
  requireAnyAdminCapability(["dispatch", "content"]),
  json(),
  async (req, res): Promise<void> => {
    const approvalToken = typeof req.body?.approvalToken === "string" ? req.body.approvalToken : "";
    const approval = approvals.get(approvalToken);
    approvals.delete(approvalToken);
    if (!approval || approval.subject !== res.locals.adminSubject || approval.expiresAt <= Date.now()
        || approval.digest !== digest(approval.payload)) {
      res.status(409).json({ error: "Preview approval is missing or expired. Preview the exact communication again." });
      return;
    }
    try {
      const target = await resolveTarget(approval.payload);
      const commonValues = {
        type: approval.payload.type,
        message: approval.payload.message,
        delayMinutes: approval.payload.delayMinutes,
        stopName: approval.payload.stopName,
        startsAt: approval.payload.startsAt,
        expiresAt: approval.payload.expiresAt,
        updatedAt: new Date(),
      };
      const groupId = approval.payload.communicationGroupId ?? randomUUID();
      const created = await db.transaction(async tx => {
        const existing = approval.payload.communicationGroupId
          ? await tx.select().from(serviceDisruptionsTable).where(and(
            or(
              eq(serviceDisruptionsTable.communicationGroupId, groupId),
              eq(serviceDisruptionsTable.id, groupId),
            ),
            isNull(serviceDisruptionsTable.clearedAt),
          ))
          : [];
        if (approval.payload.communicationGroupId && !existing.length) {
          throw Object.assign(new Error("This communication group is no longer editable."), { status: 404 });
        }
        const nextRunKeys = new Set(target.affectedRuns.map(run => run.canonicalRunKey));
        const removedIds = existing.filter(row => !nextRunKeys.has(row.officialRunKey)).map(row => row.id);
        if (removedIds.length) {
          await tx.update(serviceDisruptionsTable).set({
            clearedAt: new Date(),
            updatedAt: new Date(),
          }).where(inArray(serviceDisruptionsTable.id, removedIds));
        }
        const results: typeof existing = [];
        for (const run of target.affectedRuns) {
          const values = {
            ...commonValues,
            officialRunKey: run.canonicalRunKey,
            communicationGroupId: groupId,
            targetCoachNumbers: approval.payload.targetCoachNumbers.length
              ? JSON.stringify(run.selectedCoaches) : null,
          };
          const current = existing.find(row => row.officialRunKey === run.canonicalRunKey);
          if (current) {
            const [updated] = await tx.update(serviceDisruptionsTable).set(values)
              .where(eq(serviceDisruptionsTable.id, current.id)).returning();
            results.push(updated);
          } else {
            const [inserted] = await tx.insert(serviceDisruptionsTable).values({
              id: randomUUID(),
              ...values,
              createdBy: res.locals.adminSubject,
            }).returning();
            results.push(inserted);
          }
        }
        return results;
      });
      req.log.info({
        action: approval.payload.communicationGroupId ? "edit_passenger_communication_group" : "publish_passenger_communication_group",
        communicationGroupId: groupId,
        affectedRunCount: created.length,
        type: approval.payload.type,
        selectedCoachCount: approval.payload.targetCoachNumbers.length,
      }, "Passenger communication audit");
      res.status(approval.payload.communicationGroupId ? 200 : 201).json({
        communicationGroupId: groupId,
        affectedRunCount: created.length,
        communications: created.map(response),
      });
    } catch (error) {
      const candidate = (error as { status?: number }).status;
      const status = candidate === 404 || candidate === 409 ? candidate : 400;
      res.status(status).json({ error: (error as Error).message || "The target could not be revalidated." });
    }
  },
);

router.delete(
  "/admin/passenger-communications/:id",
  requireAnyAdminCapability(["dispatch", "content"]),
  async (req, res): Promise<void> => {
    const communicationId = typeof req.params.id === "string" ? req.params.id : "";
    const withdrawn = await db.update(serviceDisruptionsTable).set({
      clearedAt: new Date(),
      updatedAt: new Date(),
    }).where(and(
      eq(serviceDisruptionsTable.communicationGroupId, communicationId),
      isNull(serviceDisruptionsTable.clearedAt),
    )).returning();
    if (!withdrawn.length) {
      const legacy = await db.update(serviceDisruptionsTable).set({
        clearedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(serviceDisruptionsTable.id, communicationId), isNull(serviceDisruptionsTable.clearedAt))).returning();
      withdrawn.push(...legacy);
    }
    if (!withdrawn.length) {
      res.status(404).json({ error: "This communication is already withdrawn or does not exist." });
      return;
    }
    req.log.info({ action: "withdraw_passenger_communication_group", communicationGroupId: communicationId, affectedRunCount: withdrawn.length }, "Passenger communication audit");
    res.json({ communicationGroupId: communicationId, affectedRunCount: withdrawn.length, communications: withdrawn.map(response) });
  },
);

export default router;
