import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import {
  CreateAdminServiceDisruptionBody,
  UpdateAdminServiceDisruptionBody,
} from "@workspace/api-zod";
import { db, serviceDisruptionsTable } from "@workspace/db";
import { notifyRunDisruption } from "../lib/passenger-realtime";
import { publicServiceDisruption } from "../lib/service-disruptions";
import { requireAdmin } from "./admin-drivers";
import { resolveOfficialRunAlias } from "./schedule";

const router: IRouter = Router();
const TYPES = new Set(["delay", "detour", "skipped_stop", "cancellation"]);
const RUN_KEY = /^\d{4}-\d{2}-\d{2}\|[123]\|\d{1,2}\|\d{1,2}\|[^|]{1,80}$/;
const UNSAFE_PLAIN_TEXT = /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function notifyDisruption(
  req: { log: { error: (obj: unknown, message: string) => void } },
  runKey: string,
  disruptionId: string,
  action: "created" | "updated" | "cleared",
  updatedAt: Date,
  title: string,
  body: string,
) {
  void resolveOfficialRunAlias(runKey).then(alias => notifyRunDisruption(
    alias.keys, disruptionId, action, updatedAt, { title, body }, req.log,
  )).catch(error => req.log.error({ err: error, disruptionId, officialRunKey: runKey }, "passenger disruption push failed"));
}

router.use("/admin/service-disruptions", requireAdmin);

export function normalizedDisruptionInput(body: unknown) {
  const parsed = CreateAdminServiceDisruptionBody.safeParse(body);
  if (!parsed.success) return { error: "Check the trip, notice type, message, and expiration." } as const;
  const message = parsed.data.message.trim().replace(/[ \t]+/g, " ");
  const stopName = parsed.data.stopName?.trim().replace(/\s+/g, " ") || null;
  const startsAt = parsed.data.startsAt ? new Date(parsed.data.startsAt) : new Date(Date.now());
  const expiresAt = new Date(parsed.data.expiresAt);
  if (!RUN_KEY.test(parsed.data.officialRunKey)
      || !TYPES.has(parsed.data.type)
      || !message
      || UNSAFE_PLAIN_TEXT.test(message)
      || (stopName !== null && UNSAFE_PLAIN_TEXT.test(stopName))
      || !Number.isFinite(startsAt.getTime())
      || !Number.isFinite(expiresAt.getTime())
      || expiresAt <= startsAt
      || expiresAt.getTime() > Date.now() + 30 * 24 * 60 * 60 * 1000) {
    return { error: "Use plain text and choose an expiration after the start, within 30 days." } as const;
  }
  if (parsed.data.type === "delay" && parsed.data.delayMinutes == null) {
    return { error: "Delay notices require the expected delay in minutes." } as const;
  }
  if (parsed.data.type === "skipped_stop" && !stopName) {
    return { error: "Skipped-stop notices require the affected stop." } as const;
  }
  return {
    data: {
      officialRunKey: parsed.data.officialRunKey,
      type: parsed.data.type,
      message,
      delayMinutes: parsed.data.type === "delay" ? parsed.data.delayMinutes : null,
      stopName: parsed.data.type === "skipped_stop" ? stopName : null,
      startsAt,
      expiresAt,
    },
  } as const;
}

router.get("/admin/service-disruptions", async (req, res): Promise<void> => {
  const runKey = typeof req.query.runKey === "string" ? req.query.runKey.trim() : "";
  if (runKey && !RUN_KEY.test(runKey)) {
    res.status(400).json({ error: "Choose a valid published trip." });
    return;
  }
  const filters = [
    isNull(serviceDisruptionsTable.clearedAt),
    gt(serviceDisruptionsTable.expiresAt, new Date()),
    runKey ? eq(serviceDisruptionsTable.officialRunKey, runKey) : undefined,
  ].filter(Boolean);
  const rows = await db.select().from(serviceDisruptionsTable)
    .where(and(...filters))
    .orderBy(desc(serviceDisruptionsTable.updatedAt))
    .limit(200);
  res.json(rows.map(publicServiceDisruption));
});

router.post("/admin/service-disruptions", async (req, res): Promise<void> => {
  const input = normalizedDisruptionInput(req.body);
  if ("error" in input) {
    res.status(400).json({ error: input.error });
    return;
  }
  const [created] = await db.insert(serviceDisruptionsTable).values({
    id: randomUUID(),
    ...input.data,
    createdBy: res.locals.adminSubject,
  }).returning();
  req.log.info({
    action: "create_service_disruption",
    adminSubject: res.locals.adminSubject,
    disruptionId: created.id,
    officialRunKey: created.officialRunKey,
    type: created.type,
  }, "Dispatch disruption audit");
  notifyDisruption(req, created.officialRunKey, created.id, "created", created.updatedAt,
    "Service disruption", created.message);
  res.status(201).json(publicServiceDisruption(created));
});

router.put("/admin/service-disruptions/:id", async (req, res): Promise<void> => {
  const parsedBody = UpdateAdminServiceDisruptionBody.safeParse(req.body);
  const input = parsedBody.success ? normalizedDisruptionInput(parsedBody.data) : { error: "Check the notice details." } as const;
  if ("error" in input) {
    res.status(400).json({ error: input.error });
    return;
  }
  const [previous] = await db.select().from(serviceDisruptionsTable).where(and(
    eq(serviceDisruptionsTable.id, req.params.id),
    isNull(serviceDisruptionsTable.clearedAt),
  )).limit(1);
  const [updated] = await db.update(serviceDisruptionsTable).set({
    ...input.data,
    updatedAt: new Date(),
  }).where(and(
    eq(serviceDisruptionsTable.id, req.params.id),
    isNull(serviceDisruptionsTable.clearedAt),
  )).returning();
  if (!updated) {
    res.status(404).json({ error: "This notice is no longer current." });
    return;
  }
  req.log.info({ action: "update_service_disruption", adminSubject: res.locals.adminSubject, disruptionId: updated.id }, "Dispatch disruption audit");
  if (previous && previous.officialRunKey !== updated.officialRunKey) {
    notifyDisruption(req, previous.officialRunKey, updated.id, "updated", updated.updatedAt,
      "Service notice updated", "A previous service notice for this run has changed.");
  }
  notifyDisruption(req, updated.officialRunKey, updated.id, "updated", updated.updatedAt,
    "Service notice updated", updated.message);
  res.json(publicServiceDisruption(updated));
});

router.delete("/admin/service-disruptions/:id", async (req, res): Promise<void> => {
  const [previous] = await db.select().from(serviceDisruptionsTable).where(and(
    eq(serviceDisruptionsTable.id, req.params.id),
    isNull(serviceDisruptionsTable.clearedAt),
  )).limit(1);
  const [cleared] = await db.update(serviceDisruptionsTable).set({
    clearedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(serviceDisruptionsTable.id, req.params.id),
    isNull(serviceDisruptionsTable.clearedAt),
  )).returning({
    id: serviceDisruptionsTable.id,
    officialRunKey: serviceDisruptionsTable.officialRunKey,
    updatedAt: serviceDisruptionsTable.updatedAt,
  });
  if (!cleared) {
    res.status(404).json({ error: "This notice is already clear or does not exist." });
    return;
  }
  req.log.info({ action: "clear_service_disruption", adminSubject: res.locals.adminSubject, disruptionId: cleared.id }, "Dispatch disruption audit");
  if (previous) {
    notifyDisruption(req, previous.officialRunKey, previous.id, "cleared", cleared.updatedAt,
      "Service notice cleared", "The service notice for your selected run has been cleared.");
  }
  res.status(204).end();
});

export default router;