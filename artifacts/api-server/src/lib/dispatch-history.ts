import { db, dispatchAssignmentsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";

export type DispatchOutcome = "completed" | "expired" | "released" | "reassigned";

export async function finishActiveDispatchAssignment(
  busNumber: string,
  outcome: DispatchOutcome,
) {
  await db.update(dispatchAssignmentsTable).set({
    endedAt: new Date(),
    outcome,
  }).where(and(
    eq(dispatchAssignmentsTable.busNumber, busNumber),
    isNull(dispatchAssignmentsTable.endedAt),
  ));
}