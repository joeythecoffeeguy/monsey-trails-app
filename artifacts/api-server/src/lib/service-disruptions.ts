import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { db, serviceDisruptionsTable, type ServiceDisruptionRow } from "@workspace/db";

export type PublicServiceDisruption = {
  id: string;
  communicationGroupId?: string | null;
  officialRunKey: string;
  type: "delay" | "detour" | "skipped_stop" | "boarding_change" | "cancellation";
  message: string;
  delayMinutes: number | null;
  stopName: string | null;
  targetCoachNumbers?: string[];
  startsAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export function publicServiceDisruption(row: ServiceDisruptionRow): PublicServiceDisruption {
  const targetCoachNumbers = (() => {
    if (!row.targetCoachNumbers) return [] as string[];
    try {
      const value = JSON.parse(row.targetCoachNumbers);
      return Array.isArray(value) ? value.filter(item => typeof item === "string") : [];
    } catch {
      return [];
    }
  })();
  return {
    id: row.id,
    communicationGroupId: row.communicationGroupId,
    officialRunKey: row.officialRunKey,
    type: row.type as "delay" | "detour" | "skipped_stop" | "boarding_change" | "cancellation",
    message: row.message,
    delayMinutes: row.delayMinutes,
    stopName: row.stopName,
    targetCoachNumbers,
    startsAt: row.startsAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}


export async function activeServiceDisruptions(
  runKeys: string | string[],
  now = new Date(),
  coachNumber?: string | null,
) {
  const keys = Array.isArray(runKeys) ? runKeys : [runKeys];
  if (!keys.length) return [];
  const rows = await db.select().from(serviceDisruptionsTable).where(and(
    keys.length === 1
      ? eq(serviceDisruptionsTable.officialRunKey, keys[0])
      : inArray(serviceDisruptionsTable.officialRunKey, keys),
    isNull(serviceDisruptionsTable.clearedAt),
    lte(serviceDisruptionsTable.startsAt, now),
    gt(serviceDisruptionsTable.expiresAt, now),
  ));
  return rows.map(publicServiceDisruption).filter(notice =>
    (notice.targetCoachNumbers?.length ?? 0) === 0
      || (Boolean(coachNumber) && notice.targetCoachNumbers!.includes(coachNumber!)));
}