import { clerkClient } from "@clerk/express";
import { json, Router, type IRouter, type RequestHandler } from "express";
import {
  CreateAdminDriverBody,
  ResetAdminDriverAccessBody,
} from "@workspace/api-zod";
import {
  db,
  dispatchAssignmentsTable,
  driverProfilesTable,
  fleetCoachesTable,
  liveTripsTable,
  pushSubscriptionsTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/admin-role-policy";
export { requireAdmin } from "../middlewares/admin-role-policy";
import { retireDriverOwnedCoaches } from "./driver-profile";
import {
  activePassengerDisplays,
  disconnectPassengerScreens,
  generatePassengerPairingCode,
  rowToPassengerTripWithOfficialNotes,
  startAssignedTrip,
  stopActiveTrip,
} from "./trip";
import { locationVisibility } from "../lib/trip-privacy";
import { resolveOfficialAssignment } from "./schedule";
import { lockOfficialAssignments } from "../lib/official-run-assignment";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, sql } from "drizzle-orm";

const router: IRouter = Router();

const AREA_NAMES: Record<string, string> = {
  "1": "New Square",
  "2": "Monsey",
  "3": "Boro Park",
  "4": "Williamsburg",
  "5": "Manhattan",
  "6": "Wall Street",
  "7": "Lakewood (Westgate)",
  "8": "Lakewood (Sq. Kennedy)",
  "9": "Flatbush",
  "10": "Kiryas Yoel",
  "11": "B&H",
};

function runIdentity(runKey: string) {
  const [serviceDate = "", , origin = "", destination = ""] = runKey.split("|");
  return {
    serviceDate,
    direction: `${AREA_NAMES[origin] ?? origin} → ${AREA_NAMES[destination] ?? destination}`,
  };
}

async function reconcileCurrentDispatchState() {
  const live = await db.select().from(liveTripsTable).where(and(
    isNull(liveTripsTable.completedAt),
    isNull(liveTripsTable.retiredAt),
    inArray(liveTripsTable.status, ["ready", "running"]),
    sql`${liveTripsTable.officialRunKey} IS NOT NULL`,
    sql`${liveTripsTable.ownerSubject} IS NOT NULL`,
    sql`${liveTripsTable.scheduledDepartureAt} IS NOT NULL`,
  ));
  await db.transaction(async tx => {
    for (const row of live) {
      await tx.insert(fleetCoachesTable).values({ busNumber: row.pairingCode }).onConflictDoNothing();
      const [existing] = await tx.select({ id: dispatchAssignmentsTable.id })
        .from(dispatchAssignmentsTable).where(and(
          eq(dispatchAssignmentsTable.busNumber, row.pairingCode),
          isNull(dispatchAssignmentsTable.endedAt),
        )).limit(1);
      if (!existing && row.officialRunKey && row.ownerSubject && row.scheduledDepartureAt) {
        await tx.insert(dispatchAssignmentsTable).values({
          busNumber: row.pairingCode,
          driverSubject: row.ownerSubject,
          officialRunKey: row.officialRunKey,
          ...runIdentity(row.officialRunKey),
          scheduledDepartureAt: row.scheduledDepartureAt,
          assignedAt: row.updatedAt,
        });
      }
    }
  });
}
async function releaseExpiredReadyAssignments() {
  const candidates = await db.select().from(liveTripsTable).where(and(
    eq(liveTripsTable.status, "ready"),
    isNull(liveTripsTable.completedAt),
    isNull(liveTripsTable.retiredAt),
  ));
  await Promise.all(candidates.map(async row => {
    if (!row.officialRunKey) return;
    try {
      const official = await resolveOfficialAssignment(row.officialRunKey);
      if (!official.scheduledArrivalAt) return;
      const unlockAt = official.scheduledArrivalAt.getTime() + 30 * 60 * 1000;
      if (Date.now() < unlockAt) return;
      await db.transaction(async tx => {
        const updated = await tx.update(liveTripsTable).set({
          status: "stopped",
          ownerSubject: null,
          completedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(liveTripsTable.pairingCode, row.pairingCode),
          eq(liveTripsTable.status, "ready"),
          isNull(liveTripsTable.completedAt),
        )).returning({ busNumber: liveTripsTable.pairingCode });
        if (updated.length) {
          await tx.update(dispatchAssignmentsTable).set({
            endedAt: new Date(),
            outcome: "expired",
          }).where(and(
            eq(dispatchAssignmentsTable.busNumber, row.pairingCode),
            isNull(dispatchAssignmentsTable.endedAt),
          ));
        }
      });
    } catch {
      // Keep a currently assigned route locked when its published evidence
      // cannot be verified instead of releasing it on an assumed duration.
    }
  }));
}

type ClerkUser = Awaited<ReturnType<typeof clerkClient.users.getUser>>;
type PrivateAccess = { role?: unknown; driverAccess?: unknown };
type DriverProfileName = { displayName?: string | null };

function metadata(user: ClerkUser): PrivateAccess {
  return user.privateMetadata as PrivateAccess;
}

function isDriver(user: ClerkUser) {
  const access = metadata(user);
  return access.role !== "admin"
    && (access.driverAccess === true || access.role === "driver");
}

function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim() || null : null;
}

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function metadataName(metadataValue: unknown) {
  const value = record(metadataValue);
  const firstName = cleanName(value.firstName) ?? cleanName(value.first_name);
  const lastName = cleanName(value.lastName) ?? cleanName(value.last_name);
  const displayName = cleanName(value.displayName)
    ?? cleanName(value.display_name)
    ?? cleanName(value.fullName)
    ?? cleanName(value.full_name)
    ?? cleanName(value.name)
    ?? [firstName, lastName].filter(Boolean).join(" ")
    ?? null;
  return { firstName, lastName, displayName: displayName || null };
}

export function resolveDriverName(user: ClerkUser, profile: DriverProfileName = {}) {
  const clerkFirstName = cleanName(user.firstName);
  const clerkLastName = cleanName(user.lastName);
  const metadataCandidates = [
    metadataName(user.privateMetadata),
    metadataName(user.publicMetadata),
    metadataName(user.unsafeMetadata),
  ];
  const metadataFirstName = metadataCandidates.find(candidate => candidate.firstName)?.firstName ?? null;
  const metadataLastName = metadataCandidates.find(candidate => candidate.lastName)?.lastName ?? null;
  const firstName = clerkFirstName ?? metadataFirstName;
  const lastName = clerkLastName ?? metadataLastName;
  const clerkDisplayName = [clerkFirstName, clerkLastName].filter(Boolean).join(" ") || null;
  const resolvedParts = [firstName, lastName].filter(Boolean).join(" ") || null;
  const displayName = cleanName(profile.displayName)
    ?? clerkDisplayName
    ?? metadataCandidates.find(candidate => candidate.displayName)?.displayName
    ?? resolvedParts;
  return { displayName, firstName, lastName };
}

function publicDriver(
  user: ClerkUser,
  profile: DriverProfileName & { unitNumber?: string | null } = {},
) {
  const name = resolveDriverName(user, profile);
  return {
    id: user.id,
    username: user.username ?? "",
    ...name,
    unitNumber: profile.unitNumber ?? null,
    disabled: Boolean(user.banned || user.locked),
  };
}

function clerkErrorCode(error: unknown) {
  const candidate = error as {
    errors?: Array<{ code?: unknown }>;
    clerkError?: unknown;
  };
  const code = candidate?.errors?.[0]?.code;
  return typeof code === "string" ? code : candidate?.clerkError === true ? "clerk_error" : "unknown";
}

function clerkErrorParamName(error: unknown) {
  const candidate = error as {
    errors?: Array<{
      paramName?: unknown;
      param_name?: unknown;
      meta?: {
        paramName?: unknown;
        param_name?: unknown;
      };
    }>;
  };
  const firstError = candidate?.errors?.[0];
  const paramName = firstError?.meta?.paramName
    ?? firstError?.meta?.param_name
    ?? firstError?.paramName
    ?? firstError?.param_name;
  return typeof paramName === "string" ? paramName : null;
}

function sendClerkError(
  res: Parameters<RequestHandler>[1],
  error: unknown,
  fallback: string,
) {
  const code = clerkErrorCode(error);
  const paramName = clerkErrorParamName(error);
  if (
    paramName === "email_address"
    && /not_enabled|not_allowed|configuration|unknown/.test(code)
  ) {
    res.status(422).json({
      error: "Email cannot be used because it is disabled by the current identity provider configuration.",
      code: "CLERK_EMAIL_NOT_ALLOWED",
    });
    return;
  }
  if (/identifier|username|email.*taken|already_exists|unique/.test(code)) {
    res.status(409).json({ error: "That username or email is already in use.", code: "DRIVER_IDENTIFIER_EXISTS" });
    return;
  }
  if (/password|pwned|breach/.test(code)) {
    res.status(400).json({
      error: "That password does not meet the configured password requirements.",
      code: "INVALID_DRIVER_PASSWORD",
    });
    return;
  }
  if (/missing|required/.test(code)) {
    const missingFieldMessage = {
      first_name: "First name is required by the current identity provider configuration.",
      last_name: "Last name is required by the current identity provider configuration.",
      email_address: "Email is required by the current identity provider configuration.",
    }[paramName ?? ""];
    res.status(422).json({
      error: missingFieldMessage
        ?? "The current identity provider configuration requires additional account information, such as first and last names.",
      code: "CLERK_CONFIGURATION_REQUIRED",
    });
    return;
  }
  if (/missing|required|not_enabled|not_allowed|configuration/.test(code)) {
    res.status(422).json({
      error: "The Clerk user configuration requires additional or different account information.",
      code: "CLERK_CONFIGURATION_REQUIRED",
    });
    return;
  }
  res.status(502).json({ error: fallback, code: "CLERK_REQUEST_FAILED" });
}

async function revokeUserSessions(userId: string) {
  let offset = 0;
  while (true) {
    const page = await clerkClient.sessions.getSessionList({ userId, limit: 100, offset });
    await Promise.all(page.data
      .filter(session => session.status === "active")
      .map(session => clerkClient.sessions.revokeSession(session.id)));
    if (page.data.length === 0) return;
    offset += page.data.length;
    if (page.data.length < 100 || offset >= page.totalCount) return;
  }
}

const requireDriverTarget: RequestHandler = async (req, res, next) => {
  const targetId = typeof req.params.id === "string" ? req.params.id : "";
  if (!targetId) {
    res.status(400).json({ error: "A driver account ID is required.", code: "INVALID_DRIVER_TARGET" });
    return;
  }
  if (targetId === res.locals.adminSubject) {
    res.status(403).json({ error: "Administrators cannot target their own account.", code: "INVALID_DRIVER_TARGET" });
    return;
  }
  try {
    const user = await clerkClient.users.getUser(targetId);
    if (!isDriver(user)) {
      res.status(403).json({ error: "Only provisioned driver accounts can be managed.", code: "INVALID_DRIVER_TARGET" });
      return;
    }
    res.locals.targetDriver = user;
    res.locals.targetSubject = targetId;
    next();
  } catch (error) {
    const code = clerkErrorCode(error);
    req.log.warn({ clerkCode: code, action: "verify_driver_target", targetSubject: req.params.id }, "Driver target verification failed");
    if (/not_found|resource_not_found/.test(code)) {
      res.status(404).json({ error: "Driver account not found.", code: "DRIVER_NOT_FOUND" });
      return;
    }
    res.status(502).json({ error: "The driver account could not be verified.", code: "CLERK_REQUEST_FAILED" });
  }
};

router.use("/admin", requireAdmin);
router.use("/admin", json());

router.get("/admin/access", (_req, res) => {
  res.json({
    authorized: true,
    role: res.locals.adminRole,
    capabilities: res.locals.adminRole === "admin"
      ? ["dispatch", "content", "identity", "roles", "history"]
      : [res.locals.adminRole === "dispatcher" ? "dispatch" : "content"],
  });
});

router.get("/admin/active-trips", async (_req, res) => {
  const rows = await db.select({
    busNumber: liveTripsTable.pairingCode,
    status: liveTripsTable.status,
    destinationAddress: liveTripsTable.destinationAddress,
    scheduledDepartureAt: liveTripsTable.scheduledDepartureAt,
    updatedAt: liveTripsTable.updatedAt,
  }).from(liveTripsTable).where(and(
    isNull(liveTripsTable.retiredAt),
    inArray(liveTripsTable.status, ["ready", "running"]),
  )).orderBy(desc(liveTripsTable.updatedAt));
  res.json(rows.map(row => ({
    ...row,
    pairedScreenCount: activePassengerDisplays(row.busNumber).length,
    scheduledDepartureAt: row.scheduledDepartureAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  })));
});

router.get("/admin/dispatch-assignments", async (req, res) => {
  await reconcileCurrentDispatchState();
  await releaseExpiredReadyAssignments();
  const raw = req.query;
  const from = typeof raw.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.from) ? raw.from : null;
  const to = typeof raw.to === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.to) ? raw.to : null;
  const coach = typeof raw.coach === "string" ? raw.coach.trim().toUpperCase() : "";
  const driver = typeof raw.driver === "string" ? raw.driver.trim() : "";
  const direction = typeof raw.direction === "string" ? raw.direction.trim() : "";
  const active = raw.active === "true" ? true : raw.active === "false" ? false : null;
  const filters = [
    from ? gte(dispatchAssignmentsTable.serviceDate, from) : undefined,
    to ? lte(dispatchAssignmentsTable.serviceDate, to) : undefined,
    coach ? eq(dispatchAssignmentsTable.busNumber, coach) : undefined,
    driver ? eq(dispatchAssignmentsTable.driverSubject, driver) : undefined,
    direction ? ilike(dispatchAssignmentsTable.direction, `%${direction}%`) : undefined,
    active === true ? isNull(dispatchAssignmentsTable.endedAt) : undefined,
    active === false ? sql`${dispatchAssignmentsTable.endedAt} IS NOT NULL` : undefined,
  ].filter(Boolean);
  const rows = await db.select({
    assignment: dispatchAssignmentsTable,
    liveStatus: liveTripsTable.status,
  }).from(dispatchAssignmentsTable)
    .leftJoin(liveTripsTable, eq(liveTripsTable.pairingCode, dispatchAssignmentsTable.busNumber))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(dispatchAssignmentsTable.assignedAt)).limit(500);
  res.json(rows.map(({ assignment: row, liveStatus }) => ({
    id: row.id,
    busNumber: row.busNumber,
    driverId: row.driverSubject,
    driverName: row.driverName,
    officialRunKey: row.officialRunKey,
    serviceDate: row.serviceDate,
    direction: row.direction,
    status: row.endedAt ? row.outcome : liveStatus ?? row.outcome,
    scheduledDepartureAt: row.scheduledDepartureAt.toISOString(),
    assignedAt: row.assignedAt.toISOString(),
    completedAt: row.endedAt?.toISOString() ?? null,
  })));
});

router.get("/admin/coaches", async (_req, res) => {
  const liveCoaches = await db.select({ busNumber: liveTripsTable.pairingCode }).from(liveTripsTable);
  await Promise.all(liveCoaches.map(coach => db.insert(fleetCoachesTable).values(coach).onConflictDoNothing()));
  const rows = await db.select().from(fleetCoachesTable)
    .orderBy(desc(fleetCoachesTable.active), asc(fleetCoachesTable.busNumber));
  res.json(rows);
});

router.post("/admin/coaches", async (req, res) => {
  const busNumber = typeof req.body?.busNumber === "string" ? req.body.busNumber.trim().toUpperCase() : "";
  const label = typeof req.body?.label === "string" ? req.body.label.trim().slice(0, 80) || null : null;
  const notes = typeof req.body?.notes === "string" ? req.body.notes.trim().slice(0, 1000) || null : null;
  if (!/^[A-Z0-9]{1,6}$/.test(busNumber)) {
    res.status(400).json({ error: "Enter a coach number using up to 6 letters or numbers." });
    return;
  }
  const [coach] = await db.insert(fleetCoachesTable).values({ busNumber, label, notes, active: true })
    .onConflictDoUpdate({
      target: fleetCoachesTable.busNumber,
      set: { label, notes, active: true, updatedAt: new Date() },
    }).returning();
  res.status(201).json(coach);
});

router.patch("/admin/coaches/:busNumber", async (req, res) => {
  const busNumber = req.params.busNumber.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,6}$/.test(busNumber) || typeof req.body?.active !== "boolean") {
    res.status(400).json({ error: "Choose a valid coach and status." });
    return;
  }
  const inactiveReason = typeof req.body?.inactiveReason === "string"
    ? req.body.inactiveReason.trim().slice(0, 240)
    : "";
  const returnToServiceDate = req.body?.returnToServiceDate == null || req.body.returnToServiceDate === ""
    ? null
    : typeof req.body.returnToServiceDate === "string" && isCalendarDate(req.body.returnToServiceDate)
      ? req.body.returnToServiceDate
      : undefined;
  if (!req.body.active && !inactiveReason) {
    res.status(400).json({ error: "Enter why this coach is inactive." });
    return;
  }
  if (!req.body.active && returnToServiceDate === undefined) {
    res.status(400).json({ error: "Choose a valid return-to-service date." });
    return;
  }
  const [activeAssignment] = await db.select({ id: dispatchAssignmentsTable.id })
    .from(dispatchAssignmentsTable).where(and(
      eq(dispatchAssignmentsTable.busNumber, busNumber),
      isNull(dispatchAssignmentsTable.endedAt),
    )).limit(1);
  if (!req.body.active && activeAssignment) {
    res.status(409).json({ error: "Release the coach's active assignment before marking it inactive." });
    return;
  }
  const [coach] = await db.update(fleetCoachesTable).set({
    active: req.body.active,
    ...(!req.body.active ? { inactiveReason, returnToServiceDate } : {}),
    updatedAt: new Date(),
  }).where(eq(fleetCoachesTable.busNumber, busNumber)).returning();
  if (!coach) {
    res.status(404).json({ error: "Coach not found." });
    return;
  }
  res.json(coach);
});

router.post("/admin/dispatch-assignments", async (req, res) => {
  const busNumber = typeof req.body?.busNumber === "string" ? req.body.busNumber.trim().toUpperCase() : "";
  const driverId = typeof req.body?.driverId === "string" ? req.body.driverId.trim() : "";
  const officialRunKey = typeof req.body?.officialRunKey === "string" ? req.body.officialRunKey.trim() : "";
  if (!/^[A-Z0-9]{1,6}$/.test(busNumber) || !driverId || officialRunKey.length < 8 || officialRunKey.length > 180) {
    res.status(400).json({ error: "Choose a valid published run, driver, and coach.", code: "INVALID_ASSIGNMENT" });
    return;
  }
  try {
    const driver = await clerkClient.users.getUser(driverId);
    if (!isDriver(driver) || driver.banned || driver.locked) {
      res.status(422).json({ error: "Choose an active driver account.", code: "DRIVER_UNAVAILABLE" });
      return;
    }
    const [profile] = await db.select().from(driverProfilesTable)
      .where(eq(driverProfilesTable.clerkSubject, driver.id)).limit(1);
    if (!profile) {
      res.status(422).json({ error: "This driver must finish profile setup before dispatch can assign a route.", code: "PROFILE_REQUIRED" });
      return;
    }
    const official = await resolveOfficialAssignment(officialRunKey);
    const passengerPairingCode = await generatePassengerPairingCode();

    const driverName = resolveDriverName(driver).displayName ?? driver.username ?? driver.id;
    const assignment = await db.transaction(async tx => {
      await lockOfficialAssignments(tx, official.equivalentRunKeys, driver.id);
      await tx.insert(liveTripsTable).values({ pairingCode: busNumber }).onConflictDoNothing();
      const [coach] = await tx.select().from(liveTripsTable)
        .where(eq(liveTripsTable.pairingCode, busNumber)).for("update");
      if (coach.status === "running" && coach.completedAt === null) {
        throw Object.assign(new Error("This coach is currently driving a route and cannot be reassigned."), { status: 409 });
      }
      const [runConflict] = await tx.select({ busNumber: liveTripsTable.pairingCode })
        .from(liveTripsTable).where(and(
          inArray(liveTripsTable.officialRunKey, official.equivalentRunKeys),
          isNull(liveTripsTable.completedAt),
          isNull(liveTripsTable.retiredAt),
          sql`${liveTripsTable.pairingCode} <> ${busNumber}`,
        )).limit(1);
      if (runConflict) {
        throw Object.assign(new Error(`This departure is already assigned to coach ${runConflict.busNumber}.`), { status: 409 });
      }
      const [driverConflict] = await tx.select({ busNumber: liveTripsTable.pairingCode })
        .from(liveTripsTable).where(and(
          eq(liveTripsTable.ownerSubject, driver.id),
          isNull(liveTripsTable.completedAt),
          isNull(liveTripsTable.retiredAt),
          inArray(liveTripsTable.status, ["ready", "running"]),
          sql`${liveTripsTable.pairingCode} <> ${busNumber}`,
        )).limit(1);
      if (driverConflict) {
        throw Object.assign(new Error(`This driver is already assigned to coach ${driverConflict.busNumber}.`), { status: 409 });
      }
      await tx.insert(fleetCoachesTable).values({ busNumber }).onConflictDoNothing();
      const [registeredCoach] = await tx.select().from(fleetCoachesTable)
        .where(eq(fleetCoachesTable.busNumber, busNumber)).for("update");
      if (!registeredCoach.active) {
        const reason = registeredCoach.inactiveReason ? `: ${registeredCoach.inactiveReason}` : "";
        const expectedReturn = registeredCoach.returnToServiceDate
          ? ` Expected back ${registeredCoach.returnToServiceDate}.`
          : "";
        throw Object.assign(new Error(`This coach is inactive${reason}.${expectedReturn}`), { status: 409 });
      }
      await tx.update(dispatchAssignmentsTable).set({
        endedAt: new Date(),
        outcome: "reassigned",
      }).where(and(
        eq(dispatchAssignmentsTable.busNumber, busNumber),
        isNull(dispatchAssignmentsTable.endedAt),
      ));
      const [updated] = await tx.update(liveTripsTable).set({
        ownerSubject: driver.id,
        passengerPairingCode,
        passengerLastSeenAt: null,
        chimeTestRequestedAt: null,
        officialRunKey: official.canonicalRunKey,
        scheduledDepartureAt: official.scheduledDepartureAt,
        destinationAddress: official.destination.address,
        destinationLat: official.destination.lat,
        destinationLng: official.destination.lng,
        intermediateStops: official.intermediateStops,
        routeGeometry: [],
        status: "ready",
        completedAt: null,
        retiredAt: null,
        updatedAt: new Date(),
      }).where(eq(liveTripsTable.pairingCode, busNumber)).returning();
      await tx.delete(pushSubscriptionsTable)
        .where(eq(pushSubscriptionsTable.pairingCode, busNumber));
      await tx.update(driverProfilesTable).set({
        unitNumber: busNumber,
        updatedAt: new Date(),
      }).where(eq(driverProfilesTable.clerkSubject, driver.id));
      await tx.insert(dispatchAssignmentsTable).values({
        busNumber,
        driverSubject: driver.id,
        driverName,
        officialRunKey: official.canonicalRunKey,
        ...runIdentity(official.canonicalRunKey),
        scheduledDepartureAt: official.scheduledDepartureAt,
        assignedBy: res.locals.adminSubject,
      });
      return updated;
    });
    req.log.info({
      action: "assign_published_run",
      adminSubject: res.locals.adminSubject,
      driverSubject: driver.id,
      busNumber,
      officialRunKey: official.canonicalRunKey,
    }, "Dispatch assignment audit");
    res.status(201).json(assignment);
  } catch (error) {
    const status = Number((error as { status?: number }).status) || 422;
    res.status(status).json({ error: error instanceof Error ? error.message : "The assignment could not be saved." });
  }
});

router.delete("/admin/dispatch-assignments/:busNumber", async (req, res) => {
  const busNumber = req.params.busNumber.trim().toUpperCase();
  const [row] = await db.select().from(liveTripsTable).where(and(
    eq(liveTripsTable.pairingCode, busNumber),
    isNull(liveTripsTable.retiredAt),
    inArray(liveTripsTable.status, ["ready", "running"]),
  )).limit(1);
  if (!row) {
    res.status(404).json({ error: "Assignment not found." });
    return;
  }
  if (row.status === "running" && row.completedAt === null) {
    res.status(409).json({ error: "A route in progress cannot be unassigned." });
    return;
  }
  await db.transaction(async tx => {
    await tx.update(liveTripsTable).set({
      ownerSubject: null,
      officialRunKey: null,
      scheduledDepartureAt: null,
      status: "idle",
      destinationAddress: "",
      destinationLat: null,
      destinationLng: null,
      intermediateStops: [],
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(liveTripsTable.pairingCode, busNumber));
    await tx.update(dispatchAssignmentsTable).set({
      endedAt: new Date(),
      outcome: "released",
    }).where(and(
      eq(dispatchAssignmentsTable.busNumber, busNumber),
      isNull(dispatchAssignmentsTable.endedAt),
    ));
  });
  res.status(204).end();
});

router.get("/admin/active-trips/:busNumber", async (req, res) => {
  const busNumber = req.params.busNumber.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,6}$/.test(busNumber)) {
    res.status(400).json({ error: "A valid bus number is required.", code: "INVALID_BUS_NUMBER" });
    return;
  }
  const [row] = await db.select().from(liveTripsTable).where(and(
    eq(liveTripsTable.pairingCode, busNumber),
    isNull(liveTripsTable.retiredAt),
    inArray(liveTripsTable.status, ["ready", "running"]),
  )).limit(1);
  if (!row) {
    res.status(404).json({ error: "This trip is no longer active.", code: "ACTIVE_TRIP_NOT_FOUND" });
    return;
  }
  res.json(await rowToPassengerTripWithOfficialNotes(row));
});

router.post("/admin/active-trips/:busNumber/disconnect-screens", async (req, res) => {
  const busNumber = req.params.busNumber.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,6}$/.test(busNumber)) {
    res.status(400).json({ error: "A valid bus number is required.", code: "INVALID_BUS_NUMBER" });
    return;
  }
  try {
    const { updated, displaysDisconnected } = await disconnectPassengerScreens(busNumber, {
      activeOnly: true,
    });
    req.log.info({
      action: "admin_disconnect_passenger_screens",
      adminSubject: res.locals.adminSubject,
      busNumber,
      displaysDisconnected,
    }, "Dispatch passenger-screen control audit");
    res.json({
      busNumber,
      pairingCode: updated.passengerPairingCode,
      disconnectedScreenCount: displaysDisconnected,
      pairedScreenCount: 0,
      status: updated.status,
      officialRunKey: updated.officialRunKey,
      startedAt: updated.startedAt?.toISOString() ?? null,
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (error) {
    res.status(Number((error as { status?: number }).status) || 500)
      .json({ error: error instanceof Error ? error.message : "Paired screens could not be logged out." });
  }
});

router.post("/admin/active-trips/:busNumber/start", async (req, res) => {
  const busNumber = req.params.busNumber.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,6}$/.test(busNumber)) {
    res.status(400).json({ error: "A valid bus number is required." });
    return;
  }
  try {
    const row = await startAssignedTrip(busNumber);
    req.log.info({ action: "admin_start_trip", adminSubject: res.locals.adminSubject, busNumber }, "Dispatch trip control audit");
    res.json({
      busNumber,
      status: row.status,
      startedAt: row.startedAt?.toISOString() ?? null,
      locationVisibility: locationVisibility(row),
    });
  } catch (error) {
    res.status(Number((error as { status?: number }).status) || 500)
      .json({ error: error instanceof Error ? error.message : "The trip could not be started." });
  }
});

router.post("/admin/active-trips/:busNumber/stop", async (req, res) => {
  const busNumber = req.params.busNumber.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,6}$/.test(busNumber)) {
    res.status(400).json({ error: "A valid bus number is required." });
    return;
  }
  try {
    const row = await stopActiveTrip(busNumber, true);
    req.log.info({ action: "admin_stop_trip", adminSubject: res.locals.adminSubject, busNumber }, "Dispatch trip control audit");
    res.json({
      busNumber,
      status: row.status,
      startedAt: row.startedAt?.toISOString() ?? null,
      locationVisibility: locationVisibility(row),
    });
  } catch (error) {
    res.status(Number((error as { status?: number }).status) || 500)
      .json({ error: error instanceof Error ? error.message : "The trip could not be stopped." });
  }
});

router.get("/admin/drivers", async (req, res) => {
  const rawOffset = Array.isArray(req.query.offset) ? req.query.offset[0] : req.query.offset;
  const offset = rawOffset === undefined ? 0 : Number(rawOffset);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    res.status(400).json({ error: "Offset must be a non-negative integer.", code: "INVALID_OFFSET" });
    return;
  }
  try {
    const page = await clerkClient.users.getUserList({ limit: 100, offset });
    const driverUsers = page.data.filter(isDriver);
    const profiles = driverUsers.length === 0
      ? []
      : await db.select({
        clerkSubject: driverProfilesTable.clerkSubject,
        unitNumber: driverProfilesTable.unitNumber,
        // to_jsonb keeps this read compatible with profiles created by older
        // schema variants without requiring or fabricating a value.
        displayName: sql<string | null>`coalesce(
          nullif(btrim(to_jsonb(${driverProfilesTable})->>'display_name'), ''),
          nullif(btrim(to_jsonb(${driverProfilesTable})->>'displayName'), ''),
          nullif(btrim(to_jsonb(${driverProfilesTable})->>'full_name'), ''),
          nullif(btrim(to_jsonb(${driverProfilesTable})->>'fullName'), ''),
          nullif(btrim(to_jsonb(${driverProfilesTable})->>'name'), '')
        )`,
      }).from(driverProfilesTable).where(inArray(
        driverProfilesTable.clerkSubject,
        driverUsers.map(driver => driver.id),
      ));
    const profilesBySubject = new Map(profiles.map(profile => [profile.clerkSubject, profile]));
    res.json({
      drivers: driverUsers.map(driver => publicDriver(driver, profilesBySubject.get(driver.id))),
      nextOffset: offset + page.data.length < page.totalCount ? offset + page.data.length : null,
    });
  } catch (error) {
    req.log.warn({ clerkCode: clerkErrorCode(error), action: "list_drivers" }, "Driver listing failed");
    sendClerkError(res, error, "Driver accounts could not be loaded.");
  }
});

router.post("/admin/drivers", async (req, res) => {
  const parsed = CreateAdminDriverBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter valid driver account information.", code: "INVALID_DRIVER_INPUT" });
    return;
  }
  try {
    const user = await clerkClient.users.createUser({
      username: parsed.data.username,
      password: parsed.data.password,
      ...(parsed.data.firstName ? { firstName: parsed.data.firstName } : {}),
      ...(parsed.data.lastName ? { lastName: parsed.data.lastName } : {}),
      ...(parsed.data.email ? { emailAddress: [parsed.data.email] } : {}),
      privateMetadata: { role: "driver", driverAccess: true },
    });
    req.log.info({ action: "create_driver", adminSubject: res.locals.adminSubject, targetSubject: user.id }, "Driver access audit");
    res.status(201).json({ driver: publicDriver(user) });
  } catch (error) {
    req.log.warn({ clerkCode: clerkErrorCode(error), action: "create_driver" }, "Driver creation failed");
    sendClerkError(res, error, "The driver account could not be created.");
  }
});

router.post("/admin/drivers/:id/disable", requireDriverTarget, async (req, res) => {
  const targetSubject = res.locals.targetSubject as string;
  let accountBanned = false;
  try {
    const user = await clerkClient.users.banUser(targetSubject);
    accountBanned = true;
    await revokeUserSessions(targetSubject);
    req.log.info({ action: "disable_driver", adminSubject: res.locals.adminSubject, targetSubject: user.id }, "Driver access audit");
    res.json({ driver: publicDriver(user) });
  } catch (error) {
    req.log.warn({ clerkCode: clerkErrorCode(error), action: "disable_driver", targetSubject: req.params.id }, "Driver disable failed");
    if (accountBanned) {
      res.status(502).json({
        error: "The account was disabled, but session revocation could not be verified. Retry disabling the account.",
        code: "DISABLE_PARTIAL_FAILURE",
      });
      return;
    }
    sendClerkError(res, error, "The driver account could not be disabled.");
  }
});

router.post("/admin/drivers/:id/enable", requireDriverTarget, async (req, res) => {
  const targetSubject = res.locals.targetSubject as string;
  const target = res.locals.targetDriver as ClerkUser;
  let accessMutationStarted = false;
  try {
    // Unlock first so a failed unban still leaves the identity disabled.
    if (target.locked) {
      accessMutationStarted = true;
      await clerkClient.users.unlockUser(targetSubject);
    }
    if (target.banned) {
      accessMutationStarted = true;
      await clerkClient.users.unbanUser(targetSubject);
    }
    const user = await clerkClient.users.getUser(targetSubject);
    if (user.banned || user.locked || !isDriver(user)) {
      throw new Error("account_remains_disabled");
    }
    req.log.info({ action: "enable_driver", adminSubject: res.locals.adminSubject, targetSubject: user.id }, "Driver access audit");
    res.json({ driver: publicDriver(user) });
  } catch (error) {
    req.log.warn({
      clerkCode: clerkErrorCode(error),
      action: "enable_driver",
      targetSubject: req.params.id,
      accessMutationStarted,
    }, "Driver enable failed");
    if (accessMutationStarted) {
      res.status(502).json({
        error: "Restoring driver access did not finish or could not be verified. Retry enabling the account.",
        code: "ENABLE_PARTIAL_FAILURE",
      });
      return;
    }
    sendClerkError(res, error, "The driver account could not be enabled.");
  }
});

router.post("/admin/drivers/:id/reset-access", requireDriverTarget, async (req, res) => {
  const parsed = ResetAdminDriverAccessBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid new password.", code: "INVALID_DRIVER_PASSWORD" });
    return;
  }
  const targetSubject = res.locals.targetSubject as string;
  let passwordChanged = false;
  try {
    await clerkClient.users.updateUser(targetSubject, {
      password: parsed.data.password,
      signOutOfOtherSessions: true,
    });
    passwordChanged = true;
    const target = res.locals.targetDriver as ClerkUser;
    // Revoke before restoring a banned account so a partial failure fails closed.
    await revokeUserSessions(targetSubject);
    if (target.banned) await clerkClient.users.unbanUser(targetSubject);
    if (target.locked) await clerkClient.users.unlockUser(targetSubject);
    const user = await clerkClient.users.getUser(targetSubject);
    if (user.banned || user.locked) {
      throw new Error("account_remains_disabled");
    }
    req.log.info({ action: "reset_driver_access", adminSubject: res.locals.adminSubject, targetSubject: user.id }, "Driver access audit");
    res.json({ driver: publicDriver(user) });
  } catch (error) {
    req.log.warn({
      clerkCode: clerkErrorCode(error),
      action: "reset_driver_access",
      targetSubject: req.params.id,
      passwordChanged,
    }, "Driver access reset failed");
    if (passwordChanged) {
      res.status(502).json({
        error: "The password was changed, but restoring access or revoking sessions did not finish. Retry the reset before giving the credentials to the driver.",
        code: "RESET_PARTIAL_FAILURE",
      });
      return;
    }
    sendClerkError(res, error, "Driver access could not be reset.");
  }
});

router.delete("/admin/drivers/:id", requireDriverTarget, async (req, res) => {
  const targetSubject = res.locals.targetSubject as string;
  const target = res.locals.targetDriver as ClerkUser;
  let accountDisabled = Boolean(target.banned);
  let sessionsRevoked = false;
  let coachesRetired = false;
  let profileDeleted = false;
  try {
    if (!accountDisabled) {
      await clerkClient.users.banUser(targetSubject);
      accountDisabled = true;
    }
    await revokeUserSessions(targetSubject);
    sessionsRevoked = true;
    await retireDriverOwnedCoaches(targetSubject);
    coachesRetired = true;
    await db.delete(driverProfilesTable).where(eq(driverProfilesTable.clerkSubject, targetSubject));
    profileDeleted = true;
    await clerkClient.users.deleteUser(targetSubject);
    req.log.info({ action: "delete_driver", adminSubject: res.locals.adminSubject, targetSubject }, "Driver access audit");
    res.status(204).end();
  } catch (error) {
    req.log.warn({
      clerkCode: clerkErrorCode(error),
      action: "delete_driver",
      targetSubject: req.params.id,
      accountDisabled,
      sessionsRevoked,
      coachesRetired,
      profileDeleted,
    }, "Driver deletion failed");
    if (accountDisabled) {
      res.status(502).json({
        error: "The driver account was disabled, but deletion did not finish. Retry deleting the account.",
        code: "DELETE_PARTIAL_FAILURE",
      });
      return;
    }
    sendClerkError(res, error, "The driver account could not be deleted.");
  }
});

export default router;
