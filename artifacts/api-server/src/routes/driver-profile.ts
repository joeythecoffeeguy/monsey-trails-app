import { Router, type IRouter, type RequestHandler } from "express";
import { randomInt } from "node:crypto";
import { clerkClient, getAuth } from "@clerk/express";
import { db, dispatchAssignmentsTable, driverProfilesTable, liveTripsTable, pushSubscriptionsTable } from "@workspace/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { GetDriverScheduledTripsResponse, UpdateDriverProfileBody } from "@workspace/api-zod";
import { isTrustedDriverRequest } from "../lib/driver-request-origin";
import { finishActiveDispatchAssignment } from "../lib/dispatch-history";
import { fetchOfficialSchedule } from "./schedule";

const router: IRouter = Router();
export function normalizeProfile(input: unknown, assignedUsername?: string) {
  const body = input as Record<string, unknown> | null;
  const username = assignedUsername?.trim()
    || (typeof body?.username === "string" ? body.username.trim() : "");
  const unitNumber = typeof body?.unitNumber === "string" ? body.unitNumber.trim() : "";
  const rawPhone = typeof body?.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) throw new Error("Username must be 3–32 letters, numbers, underscores, dots, or hyphens.");
  if (!unitNumber || unitNumber.length > 20 || /[\x00-\x1f]/.test(unitNumber)) throw new Error("Unit number is required and must be at most 20 characters.");
  if (!/^\+?[\d () .-]+$/.test(rawPhone)) throw new Error("Enter a valid US or international phone number.");
  const digits = rawPhone.replace(/\D/g, "");
  const phoneNumber = rawPhone.startsWith("+") ? `+${digits}`
    : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : "";
  if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) throw new Error("Enter a valid US number or international number beginning with +.");
  return { username, unitNumber, phoneNumber };
}

async function getProvisionedDriverIdentity(subject: string, sessionId: string) {
  const session = await clerkClient.sessions.getSession(sessionId);
  if (session.status !== "active" || session.userId !== subject) return null;
  const user = await clerkClient.users.getUser(subject);
  const privateMetadata = user.privateMetadata as { driverAccess?: unknown; role?: unknown };
  const hasDriverAccess = privateMetadata.driverAccess === true || privateMetadata.role === "driver";
  if (!hasDriverAccess || user.banned || user.locked) return null;
  const username = user.username?.trim() || "";
  if (!username) {
    throw new Error("Your driver account has no username assigned. Contact an administrator.");
  }
  return { username };
}

export const requireDriver: RequestHandler = async (req, res, next) => {
  const auth = getAuth(req);
  const subject = auth.userId;
  const sessionId = auth.sessionId;
  if (!subject || !sessionId) {
    res.status(401).json({ error: "Sign in to your driver account.", code: "AUTH_REQUIRED" });
    return;
  }
  if (!isTrustedDriverRequest(req)) {
    res.status(403).json({ error: "Driver requests must come from this application's trusted origin.", code: "UNTRUSTED_ORIGIN" });
    return;
  }
  try {
    const identity = await getProvisionedDriverIdentity(subject, sessionId);
    if (!identity) {
      res.status(403).json({
        error: "This account has not been provisioned for driver access. Contact an administrator.",
        code: "DRIVER_ACCESS_REQUIRED",
      });
      return;
    }
    res.locals.driverUsername = identity.username;
  } catch (error) {
    if ((error as Error).message.includes("no username assigned")) {
      res.status(403).json({ error: (error as Error).message, code: "DRIVER_USERNAME_REQUIRED" });
      return;
    }
    req.log.error({ err: error, driverSubject: subject }, "Could not verify driver provisioning");
    res.status(503).json({
      error: "Driver access could not be verified. Please try again.",
      code: "DRIVER_ACCESS_UNAVAILABLE",
    });
    return;
  }
  res.locals.driverSubject = subject;
  next();
};

const requireAuthenticatedDriverSubject: RequestHandler = (req, res, next) => {
  const subject = getAuth(req).userId;
  if (!subject) {
    res.status(401).json({ error: "Sign in to your driver account.", code: "AUTH_REQUIRED" });
    return;
  }
  if (!isTrustedDriverRequest(req)) {
    res.status(403).json({ error: "Driver requests must come from this application's trusted origin.", code: "UNTRUSTED_ORIGIN" });
    return;
  }
  res.locals.driverSubject = subject;
  next();
};

export const requireDriverProfile: RequestHandler = async (req, res, next) => {
  let authenticated = false;
  await requireDriver(req, res, () => { authenticated = true; });
  if (!authenticated) return;
  const [profile] = await db.select().from(driverProfilesTable)
    .where(eq(driverProfilesTable.clerkSubject, res.locals.driverSubject)).limit(1);
  if (!profile) {
    res.status(403).json({ error: "Complete your driver profile before operating a coach.", code: "PROFILE_REQUIRED" });
    return;
  }
  next();
};

// Fail-closed retirement shared by normal sign-out and administrative account
// deletion. The owner predicate is essential: never release another driver's
// coach while cleaning up one identity.
export async function retireDriverOwnedCoaches(subject: string) {
  const coaches = await db.select({ busNumber: liveTripsTable.pairingCode })
    .from(liveTripsTable).where(eq(liveTripsTable.ownerSubject, subject));
  await db.update(liveTripsTable).set({
    ownerSubject: null, retiredAt: new Date(), completedAt: new Date(), status: "stopped",
    currentLat: null, currentLng: null, locationUpdatedAt: null, originLat: null, originLng: null, routeGeometry: [],
    speedMph: null, eta: null, passengerLastSeenAt: null, chimeTestRequestedAt: null,
    updatedAt: new Date(),
  }).where(eq(liveTripsTable.ownerSubject, subject));
  await Promise.all(coaches
    .filter((coach): coach is { busNumber: string } => typeof coach.busNumber === "string")
    .map(coach => finishActiveDispatchAssignment(coach.busNumber, "released")));
}

async function disconnectDriverScreens(subject: string) {
  const coaches = await db.select().from(liveTripsTable)
    .where(eq(liveTripsTable.ownerSubject, subject));
  for (const coach of coaches) {
    let passengerPairingCode = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = String(randomInt(1000, 10_000));
      if (candidate === coach.passengerPairingCode) continue;
      const [conflict] = await db.select({ code: liveTripsTable.pairingCode })
        .from(liveTripsTable).where(eq(liveTripsTable.passengerPairingCode, candidate)).limit(1);
      if (!conflict) {
        passengerPairingCode = candidate;
        break;
      }
    }
    if (!passengerPairingCode) throw new Error("Could not revoke paired passenger screens.");
    await db.transaction(async tx => {
      const [updated] = await tx.update(liveTripsTable).set({
        passengerPairingCode,
        passengerLastSeenAt: null,
        chimeTestRequestedAt: null,
        updatedAt: new Date(),
      }).where(and(
        eq(liveTripsTable.pairingCode, coach.pairingCode),
        eq(liveTripsTable.ownerSubject, subject),
        coach.passengerPairingCode === null
          ? isNull(liveTripsTable.passengerPairingCode)
          : eq(liveTripsTable.passengerPairingCode, coach.passengerPairingCode),
      )).returning({ busNumber: liveTripsTable.pairingCode });
      if (!updated) throw new Error("A coach assignment changed during sign-out.");
      await tx.delete(pushSubscriptionsTable)
        .where(eq(pushSubscriptionsTable.pairingCode, coach.pairingCode));
    });
  }
}

router.get("/driver/profile", requireDriver, async (_req, res) => {
  res.set("Cache-Control", "no-store");
  const [profile] = await db.select({
    username: driverProfilesTable.username,
    unitNumber: driverProfilesTable.unitNumber,
    phoneNumber: driverProfilesTable.phoneNumber,
  }).from(driverProfilesTable).where(eq(driverProfilesTable.clerkSubject, res.locals.driverSubject)).limit(1);
  res.json({ profile: profile ?? null });
});

router.get("/driver/scheduled-trips", requireDriverProfile, async (_req, res): Promise<void> => {
  const subject = res.locals.driverSubject as string;
  const rows = await db.select({
    busNumber: liveTripsTable.pairingCode,
    officialRunKey: liveTripsTable.officialRunKey,
    scheduledDepartureAt: liveTripsTable.scheduledDepartureAt,
    destinationAddress: liveTripsTable.destinationAddress,
    intermediateStops: liveTripsTable.intermediateStops,
    status: liveTripsTable.status,
    dispatchAssignmentId: dispatchAssignmentsTable.id,
  }).from(liveTripsTable)
    .leftJoin(dispatchAssignmentsTable, and(
      eq(dispatchAssignmentsTable.busNumber, liveTripsTable.pairingCode),
      eq(dispatchAssignmentsTable.driverSubject, subject),
      isNull(dispatchAssignmentsTable.endedAt),
    ))
    .where(and(
      eq(liveTripsTable.ownerSubject, subject),
      isNull(liveTripsTable.completedAt),
      isNull(liveTripsTable.retiredAt),
      inArray(liveTripsTable.status, ["ready", "running"]),
    ))
    .orderBy(asc(liveTripsTable.scheduledDepartureAt));

  const scheduleRequests = new Map<string, ReturnType<typeof fetchOfficialSchedule>>();
  const scheduleForRunKey = (runKey: string) => {
    const [date = "", line = "", origin = "", destination = ""] = runKey.split("|");
    const requestKey = `${date}|${line}|${origin}|${destination}`;
    let request = scheduleRequests.get(requestKey);
    if (!request) {
      request = fetchOfficialSchedule({
        date,
        line: Number(line),
        origin: Number(origin),
        destination: Number(destination),
      });
      scheduleRequests.set(requestKey, request);
    }
    return request;
  };
  const trips = await Promise.all(rows.flatMap(row => {
    if (!row.officialRunKey || !row.scheduledDepartureAt) return [];
    const scheduledDepartureAt = row.scheduledDepartureAt;
    const [serviceDate = "", , origin = "", destination = "", runId = ""] = row.officialRunKey.split("|");
    const areaNames: Record<string, string> = {
      "1": "New Square", "2": "Monsey", "3": "Boro Park", "4": "Williamsburg",
      "5": "Manhattan", "6": "Wall Street", "7": "Lakewood (Westgate)",
      "8": "Lakewood (Sq. Kennedy)", "9": "Flatbush", "10": "Kiryas Yoel",
      "11": "B&H", "12": "Crown Heights",
    };
    return [scheduleForRunKey(row.officialRunKey)
      .then(schedule => {
        const publishedRun = schedule.runs.find((run: { id: string }) => run.id === runId);
        return {
          scheduleKeysAvailable: Boolean(publishedRun),
          displayKeys: publishedRun?.displayKeys ?? [],
          keyLegend: schedule.keyLegend,
        };
      })
      .catch(() => ({
        scheduleKeysAvailable: false,
        displayKeys: [],
        keyLegend: [],
      }))
      .then(scheduleKeys => ({
      busNumber: row.busNumber,
      officialRunKey: row.officialRunKey,
      serviceDate,
      direction: `${areaNames[origin] ?? origin} → ${areaNames[destination] ?? destination}`,
      status: row.status as "ready" | "running",
      scheduledDepartureAt: scheduledDepartureAt.toISOString(),
      destinationAddress: row.destinationAddress,
      stopCount: Array.isArray(row.intermediateStops) ? row.intermediateStops.length : 0,
      assignmentSource: row.dispatchAssignmentId ? "dispatch" as const : "driver" as const,
      ...scheduleKeys,
    }))];
  }));
  res.set("Cache-Control", "no-store");
  res.json(GetDriverScheduledTripsResponse.parse(trips));
});

router.put("/driver/profile", requireDriver, async (req, res) => {
  res.set("Cache-Control", "no-store");
  let profile;
  try {
    const assignedUsername = res.locals.driverUsername as string;
    profile = normalizeProfile(req.body, assignedUsername);
  }
  catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  const validated = UpdateDriverProfileBody.safeParse(profile);
  if (!validated.success) { res.status(400).json({ error: "Enter all required profile fields." }); return; }
  try {
    const values = { ...profile, usernameKey: profile.username.toLowerCase(), updatedAt: new Date() };
    await db.insert(driverProfilesTable).values({ clerkSubject: res.locals.driverSubject, ...values })
      .onConflictDoUpdate({ target: driverProfilesTable.clerkSubject, set: values });
    res.json({ profile });
  } catch (error) {
    if ((error as { cause?: { code?: string }; code?: string }).cause?.code === "23505"
      || (error as { code?: string }).code === "23505") {
      res.status(409).json({ error: "That username is already in use." });
      return;
    }
    throw error;
  }
});

// Revoke paired screens before the browser calls Clerk signOut().
// This endpoint does not manage or replace Clerk's authentication session. It
// deliberately requires authentication and trusted origin, but not current
// driver provisioning. Dispatch remains the sole owner of assignment release.
router.post("/driver/release-coaches", requireAuthenticatedDriverSubject, async (_req, res) => {
  await disconnectDriverScreens(res.locals.driverSubject);
  res.status(204).end();
});

export default router;
