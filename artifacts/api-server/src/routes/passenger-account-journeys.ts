import { Router, type IRouter, type Request, type RequestHandler } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { randomUUID } from "node:crypto";
import {
  db,
  passengerAccountJourneysTable,
  type PassengerAccountJourneyRow,
} from "@workspace/db";
import { and, asc, count, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { SavePassengerAccountJourneyBody } from "@workspace/api-zod";

type JourneyInput = NonNullable<ReturnType<typeof parseJourneyInput>>;
type AuthResult = { userId: string | null; sessionId: string | null };
type Dependencies = {
  getAuth: (req: Request) => AuthResult;
  getSession: (sessionId: string) => Promise<{ status: string; userId: string }>;
  getUser: (userId: string) => Promise<{ banned: boolean; locked: boolean }>;
  list: (subject: string) => Promise<PassengerAccountJourneyRow[]>;
  save: (subject: string, input: JourneyInput) => Promise<PassengerAccountJourneyRow>;
  remove: (subject: string, id: string) => Promise<boolean>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJourneyInput(value: unknown) {
  if (!isPlainObject(value)) return null;
  const input = { ...value };
  if (typeof input.label === "string") input.label = input.label.trim();
  const parsed = SavePassengerAccountJourneyBody.strict().safeParse(input);
  if (!parsed.success) return null;
  for (const key of ["pickup", "dropoff"] as const) {
    const stop = parsed.data[key];
    const rawStop = input[key];
    if (stop && (!isPlainObject(rawStop) || Object.keys(rawStop).some(
      (stopKey) => !["id", "label", "kind", "lat", "lng"].includes(stopKey),
    ) || stop.kind !== key)) return null;
  }
  return parsed.data;
}

function routeKey(input: JourneyInput) {
  // Only route selection fields participate in identity. Names and coordinates
  // may be edited without creating a second saved route.
  return JSON.stringify([
    input.line,
    input.origin,
    input.destination,
    input.pickup?.id ?? null,
    input.dropoff?.id ?? null,
  ]);
}

function toResponse(row: PassengerAccountJourneyRow) {
  return {
    id: row.id,
    line: row.line,
    origin: row.origin,
    destination: row.destination,
    label: row.label,
    ...(row.pickup ? { pickup: row.pickup } : {}),
    ...(row.dropoff ? { dropoff: row.dropoff } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

const databaseDependencies: Pick<Dependencies, "list" | "save" | "remove"> = {
  async list(subject) {
    return db.select().from(passengerAccountJourneysTable)
      .where(eq(passengerAccountJourneysTable.clerkSubject, subject))
      .orderBy(asc(passengerAccountJourneysTable.createdAt));
  },
  async save(subject, input) {
    const key = routeKey(input);
    return db.transaction(async (tx) => {
      // Serialize writes per account so the cap cannot be bypassed by parallel requests.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${subject}))`);
      const [existing] = await tx.select().from(passengerAccountJourneysTable).where(and(
        eq(passengerAccountJourneysTable.clerkSubject, subject),
        eq(passengerAccountJourneysTable.routeKey, key),
      )).limit(1);
      if (existing) return existing;
      const [total] = await tx.select({ value: count() }).from(passengerAccountJourneysTable)
        .where(eq(passengerAccountJourneysTable.clerkSubject, subject));
      if (Number(total.value) >= 20) {
        const error = new Error("You can save up to 20 journeys.");
        (error as Error & { status?: number }).status = 409;
        throw error;
      }
      const [inserted] = await tx.insert(passengerAccountJourneysTable).values({
        id: randomUUID(),
        clerkSubject: subject,
        routeKey: key,
        line: input.line,
        origin: input.origin,
        destination: input.destination,
        label: input.label,
        pickup: input.pickup ?? null,
        dropoff: input.dropoff ?? null,
      }).returning();
      if (inserted) return inserted;
      // The unique key remains the final idempotency guard for simultaneous writers.
      const [conflict] = await tx.select().from(passengerAccountJourneysTable).where(and(
        eq(passengerAccountJourneysTable.clerkSubject, subject),
        eq(passengerAccountJourneysTable.routeKey, key),
      )).limit(1);
      if (!conflict) throw new Error("Journey could not be saved.");
      return conflict;
    });
  },
  async remove(subject, id) {
    const [deleted] = await db.delete(passengerAccountJourneysTable).where(and(
      eq(passengerAccountJourneysTable.id, id),
      eq(passengerAccountJourneysTable.clerkSubject, subject),
    )).returning({ id: passengerAccountJourneysTable.id });
    return Boolean(deleted);
  },
};

const clerkDependencies: Pick<Dependencies, "getAuth" | "getSession" | "getUser"> = {
  getAuth: (req) => {
    const auth = getAuth(req);
    return { userId: auth.userId, sessionId: auth.sessionId };
  },
  getSession: (sessionId) => clerkClient.sessions.getSession(sessionId),
  getUser: (userId) => clerkClient.users.getUser(userId),
};

export function createPassengerAccountJourneysRouter(
  dependencies: Dependencies = { ...clerkDependencies, ...databaseDependencies },
): IRouter {
  const router: IRouter = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  const requireAccount: RequestHandler = async (req, res, next) => {
    const { userId, sessionId } = dependencies.getAuth(req);
    if (!userId || !sessionId) {
      res.status(401).json({ error: "Sign in to save passenger journeys.", code: "AUTH_REQUIRED" });
      return;
    }
    try {
      const session = await dependencies.getSession(sessionId);
      if (session.status !== "active" || session.userId !== userId) {
        res.status(403).json({ error: "Your sign-in session is not active.", code: "SESSION_INVALID" });
        return;
      }
      const user = await dependencies.getUser(userId);
      if (user.banned || user.locked) {
        res.status(403).json({ error: "This account is restricted.", code: "ACCOUNT_RESTRICTED" });
        return;
      }
      res.locals.passengerAccountSubject = userId;
      next();
    } catch (error) {
      req.log?.warn({ err: error }, "Could not verify passenger account session");
      res.status(503).json({ error: "Account access could not be verified. Please try again." });
    }
  };

  router.get("/passenger/account/journeys", requireAccount, async (_req, res) => {
    const rows = await dependencies.list(res.locals.passengerAccountSubject as string);
    res.json({ journeys: rows.map(toResponse) });
  });

  router.post("/passenger/account/journeys", requireAccount, async (req, res) => {
    const input = parseJourneyInput(req.body);
    if (!input) {
      res.status(400).json({ error: "Enter a valid journey and stop selection." });
      return;
    }
    const row = await dependencies.save(res.locals.passengerAccountSubject as string, input);
    res.json({ journey: toResponse(row) });
  });

  router.delete("/passenger/account/journeys/:id", requireAccount, async (req, res) => {
    const id = req.params.id;
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      res.status(404).end();
      return;
    }
    const deleted = await dependencies.remove(
      res.locals.passengerAccountSubject as string,
      id,
    );
    if (!deleted) {
      res.status(404).json({ error: "Journey not found." });
      return;
    }
    res.status(204).end();
  });
  return router;
}

export default createPassengerAccountJourneysRouter();