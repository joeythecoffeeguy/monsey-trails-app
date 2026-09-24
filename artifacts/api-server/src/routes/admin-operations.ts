import { Router, type IRouter } from "express";
import { GetAdminOperationsExceptionsResponse } from "@workspace/api-zod";
import { db, dispatchAssignmentsTable, liveTripsTable } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { requireAdmin } from "./admin-drivers";
import { activePassengerDisplays } from "./trip";
import { activeServiceDisruptions, type PublicServiceDisruption } from "../lib/service-disruptions";

const router: IRouter = Router();

export const OPERATIONS_THRESHOLDS = {
  lateDepartureMinutes: 5,
  criticalLateDepartureMinutes: 15,
  staleGpsMinutes: 2,
  criticalGpsMinutes: 10,
} as const;

type ActiveOperationsRow = {
  busNumber: string;
  status: string;
  scheduledDepartureAt: Date | null;
  currentLat: number | null;
  currentLng: number | null;
  locationUpdatedAt: Date | null;
  passengerLastSeenAt: Date | null;
  officialRunKey: string | null;
  driverName: string | null;
  direction: string | null;
};

type OperationsException = {
  id: string;
  type: "late_departure" | "missing_gps" | "stale_gps" | "disconnected_display" | "active_disruption";
  severity: "critical" | "warning" | "info";
  busNumber: string;
  driverName: string | null;
  direction: string | null;
  title: string;
  detail: string;
  scheduledDepartureAt: string | null;
  lastSeenAt: string | null;
  action: { label: string; href: string };
};

const minuteCount = (milliseconds: number) => Math.max(0, Math.floor(milliseconds / 60_000));

export function deriveOperationsExceptions(
  rows: ActiveOperationsRow[],
  now = new Date(),
  connectedDisplayCount: (busNumber: string) => number = (busNumber) => activePassengerDisplays(busNumber, now.getTime()).length,
  disruptions: PublicServiceDisruption[] = [],
): OperationsException[] {
  const exceptions: OperationsException[] = [];

  for (const row of rows) {
    const common = {
      busNumber: row.busNumber,
      driverName: row.driverName,
      direction: row.direction,
      scheduledDepartureAt: row.scheduledDepartureAt?.toISOString() ?? null,
    };

    if (row.status === "ready" && row.scheduledDepartureAt) {
      const minutesLate = minuteCount(now.getTime() - row.scheduledDepartureAt.getTime());
      if (minutesLate >= OPERATIONS_THRESHOLDS.lateDepartureMinutes) {
        exceptions.push({
          ...common,
          id: `late-departure:${row.busNumber}`,
          type: "late_departure",
          severity: minutesLate >= OPERATIONS_THRESHOLDS.criticalLateDepartureMinutes ? "critical" : "warning",
          title: `Coach ${row.busNumber} has not departed`,
          detail: `Scheduled departure was ${minutesLate} minutes ago; the assigned trip is still ready.`,
          lastSeenAt: null,
          action: { label: "Open dispatch", href: "/admin/dispatch" },
        });
      }
    }

    if (row.status === "running") {
      if (row.currentLat === null || row.currentLng === null || !row.locationUpdatedAt) {
        exceptions.push({
          ...common,
          id: `missing-gps:${row.busNumber}`,
          type: "missing_gps",
          severity: "critical",
          title: `Coach ${row.busNumber} has no GPS fix`,
          detail: "This running trip has not supplied a complete recorded location.",
          lastSeenAt: row.locationUpdatedAt?.toISOString() ?? null,
          action: { label: "Open dispatch", href: "/admin/dispatch" },
        });
      } else {
        const gpsAgeMinutes = minuteCount(now.getTime() - row.locationUpdatedAt.getTime());
        if (gpsAgeMinutes >= OPERATIONS_THRESHOLDS.staleGpsMinutes) {
          exceptions.push({
            ...common,
            id: `stale-gps:${row.busNumber}`,
            type: "stale_gps",
            severity: gpsAgeMinutes >= OPERATIONS_THRESHOLDS.criticalGpsMinutes ? "critical" : "warning",
            title: `Coach ${row.busNumber} GPS is stale`,
            detail: `Last recorded location was ${gpsAgeMinutes} minutes ago.`,
            lastSeenAt: row.locationUpdatedAt.toISOString(),
            action: { label: "Open dispatch", href: "/admin/dispatch" },
          });
        }
      }
    }

    if (row.passengerLastSeenAt && connectedDisplayCount(row.busNumber) === 0) {
      const displayAgeMinutes = minuteCount(now.getTime() - row.passengerLastSeenAt.getTime());
      exceptions.push({
        ...common,
        id: `disconnected-display:${row.busNumber}`,
        type: "disconnected_display",
        severity: row.status === "running" ? "critical" : "warning",
        title: `Coach ${row.busNumber} passenger display is disconnected`,
        detail: `A passenger display was previously seen; its last recorded contact was ${displayAgeMinutes} minutes ago.`,
        lastSeenAt: row.passengerLastSeenAt.toISOString(),
        action: { label: "Open displays", href: "/admin/display" },
      });
    }

    for (const disruption of disruptions.filter(item => item.officialRunKey === row.officialRunKey)) {
      const disruptionLabel = disruption.type.replaceAll("_", " ");
      exceptions.push({
        ...common,
        id: `active-disruption:${row.busNumber}:${disruption.id}`,
        type: "active_disruption",
        severity: disruption.type === "cancellation" ? "critical" : "warning",
        title: `Coach ${row.busNumber} ${disruptionLabel}`,
        detail: disruption.message,
        lastSeenAt: disruption.updatedAt,
        action: { label: "Open dispatch", href: "/admin/dispatch" },
      });
    }
  }

  const severityRank = { critical: 0, warning: 1, info: 2 };
  return exceptions.sort((left, right) =>
    severityRank[left.severity] - severityRank[right.severity]
    || left.busNumber.localeCompare(right.busNumber));
}

router.get("/admin/operations/exceptions", requireAdmin, async (_req, res) => {
  const rows = await db.select({
    busNumber: liveTripsTable.pairingCode,
    status: liveTripsTable.status,
    scheduledDepartureAt: liveTripsTable.scheduledDepartureAt,
    currentLat: liveTripsTable.currentLat,
    currentLng: liveTripsTable.currentLng,
    locationUpdatedAt: liveTripsTable.locationUpdatedAt,
    passengerLastSeenAt: liveTripsTable.passengerLastSeenAt,
    officialRunKey: liveTripsTable.officialRunKey,
    driverName: dispatchAssignmentsTable.driverName,
    direction: dispatchAssignmentsTable.direction,
  }).from(liveTripsTable).leftJoin(
    dispatchAssignmentsTable,
    and(
      eq(dispatchAssignmentsTable.busNumber, liveTripsTable.pairingCode),
      isNull(dispatchAssignmentsTable.endedAt),
    ),
  ).where(and(
    isNull(liveTripsTable.completedAt),
    isNull(liveTripsTable.retiredAt),
    inArray(liveTripsTable.status, ["ready", "running"]),
  ));

  const now = new Date();
  const disruptions = await activeServiceDisruptions(
    rows.flatMap(row => row.officialRunKey ? [row.officialRunKey] : []),
    now,
  );
  const exceptions = deriveOperationsExceptions(rows, now, undefined, disruptions);
  const response = {
    generatedAt: now.toISOString(),
    thresholds: OPERATIONS_THRESHOLDS,
    summary: {
      total: exceptions.length,
      critical: exceptions.filter(item => item.severity === "critical").length,
      warning: exceptions.filter(item => item.severity === "warning").length,
      lateDepartures: exceptions.filter(item => item.type === "late_departure").length,
      gps: exceptions.filter(item => item.type === "missing_gps" || item.type === "stale_gps").length,
      disconnectedDisplays: exceptions.filter(item => item.type === "disconnected_display").length,
      activeDisruptions: exceptions.filter(item => item.type === "active_disruption").length,
      activeTrips: rows.length,
    },
    exceptions,
    disruptionIntegration: {
      status: "connected" as const,
      message: "Active structured disruption notices are included for current assigned trips.",
    },
  };

  res.set("Cache-Control", "no-store");
  res.json(GetAdminOperationsExceptionsResponse.parse(response));
});

export default router;