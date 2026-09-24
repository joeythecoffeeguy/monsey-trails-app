import { db, liveTripsTable } from "@workspace/db";
import { and, eq, gte, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";

export const activeOfficialAssignment = and(
  isNull(liveTripsTable.retiredAt),
  isNull(liveTripsTable.completedAt),
  isNotNull(liveTripsTable.ownerSubject),
  sql`${liveTripsTable.status} IN ('ready', 'running')`,
);

// A completed row may be newer (for example after an operator settings change).
// Keep it as a fallback, but never let it mask a currently assigned coach.
export const officialAssignmentPriority = sql<number>`CASE WHEN ${activeOfficialAssignment} THEN 1 ELSE 0 END`;

export async function lockOfficialAssignments(
  executor: { execute(query: ReturnType<typeof sql>): Promise<unknown> },
  equivalentRunKeys: string[],
  driverSubject?: string,
) {
  const runKey = [...equivalentRunKeys].sort()[0];
  const lockNames = [
    ...(runKey ? [`official-assignment:run:${runKey}`] : []),
    ...(driverSubject ? [`official-assignment:driver:${driverSubject}`] : []),
  ].sort();
  for (const lockName of lockNames) {
    await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockName}))`);
  }
}

export async function assignOfficialRun(
  code: string,
  subject: string,
  expectedUpdatedAt: Date,
  values: Partial<typeof liveTripsTable.$inferInsert> & { officialRunKey: string; scheduledDepartureAt: Date },
  equivalentRunKeys: string[] = [values.officialRunKey],
) {
  return db.transaction(async tx => {
    // All official assignments take the same transaction-scoped lock for a run,
    // including the no-existing-row case that ordinary row locks cannot protect.
    await lockOfficialAssignments(tx, equivalentRunKeys);
    const [conflict] = await tx.select({ code: liveTripsTable.pairingCode }).from(liveTripsTable).where(and(
      inArray(liveTripsTable.officialRunKey, equivalentRunKeys),
      ne(liveTripsTable.pairingCode, code),
      activeOfficialAssignment,
    )).limit(1);
    if (conflict) throw Object.assign(new Error("This published departure is already assigned to another active coach."), { status: 409 });
    const [existing] = await tx.select().from(liveTripsTable).where(and(
      eq(liveTripsTable.pairingCode, code),
      eq(liveTripsTable.ownerSubject, subject),
      inArray(liveTripsTable.officialRunKey, equivalentRunKeys),
      activeOfficialAssignment,
    )).limit(1);
    // Choosing the Monsey offer for a coach already driving the canonical New Square run
    // is the same assignment, not permission to reset its route and live state.
    if (existing?.status === "running") return existing;
    const [updated] = await tx.update(liveTripsTable).set({ ...values, updatedAt: new Date() }).where(and(
      eq(liveTripsTable.pairingCode, code),
      eq(liveTripsTable.ownerSubject, subject),
      // PostgreSQL may retain sub-millisecond precision that JavaScript Date
      // cannot represent. Compare the exact JavaScript millisecond window.
      gte(liveTripsTable.updatedAt, expectedUpdatedAt),
      lt(liveTripsTable.updatedAt, new Date(expectedUpdatedAt.getTime() + 1)),
      isNull(liveTripsTable.retiredAt),
    )).returning();
    if (!updated) throw Object.assign(new Error("The coach changed during this request. Refresh and try again."), { status: 409 });
    return updated;
  });
}