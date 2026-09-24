import { Router, type IRouter } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import {
  db,
  dispatchAssignmentsTable,
  dispatchInstructionsTable,
  fleetCoachesTable,
  liveTripsTable,
  operationalReportsTable,
  serviceDisruptionsTable,
} from "@workspace/db";
import { requireAdminCapability } from "../middlewares/admin-role-policy";
import { activePassengerDisplays } from "./trip";

const router: IRouter = Router();
const BUS_NUMBER = /^[A-Z0-9]{1,6}$/;
const GPS_STALE_AFTER_MS = 2 * 60 * 1000;
const DISPLAY_STALE_AFTER_MS = 90 * 1000;

function iso(value: Date | null | undefined) {
  return value?.toISOString() ?? null;
}

router.get("/admin/coaches/:busNumber/detail", requireAdminCapability("dispatch"), async (req, res): Promise<void> => {
  const rawBusNumber = Array.isArray(req.params.busNumber) ? req.params.busNumber[0] : req.params.busNumber;
  const busNumber = (rawBusNumber ?? "").trim().toUpperCase();
  if (!BUS_NUMBER.test(busNumber)) {
    res.status(400).json({ error: "A valid coach number is required.", code: "INVALID_BUS_NUMBER" });
    return;
  }

  const [coach] = await db.select().from(fleetCoachesTable)
    .where(eq(fleetCoachesTable.busNumber, busNumber)).limit(1);
  if (!coach) {
    res.status(404).json({ error: "Coach not found.", code: "COACH_NOT_FOUND" });
    return;
  }

  const [trip, history] = await Promise.all([
    db.select().from(liveTripsTable).where(eq(liveTripsTable.pairingCode, busNumber)).limit(1)
      .then(rows => rows[0] ?? null),
    db.select().from(dispatchAssignmentsTable)
      .where(eq(dispatchAssignmentsTable.busNumber, busNumber))
      .orderBy(desc(dispatchAssignmentsTable.assignedAt)).limit(100),
  ]);
  const assignment = history.find(item => item.endedAt === null) ?? null;
  const assignmentIds = history.map(item => item.id);
  const runKeys = [...new Set(history.map(item => item.officialRunKey))];

  const [reports, instructions, notices] = await Promise.all([
    assignmentIds.length
      ? db.select().from(operationalReportsTable)
        .where(inArray(operationalReportsTable.assignmentId, assignmentIds))
        .orderBy(desc(operationalReportsTable.createdAt)).limit(100)
      : [],
    assignmentIds.length
      ? db.select().from(dispatchInstructionsTable)
        .where(inArray(dispatchInstructionsTable.assignmentId, assignmentIds))
        .orderBy(desc(dispatchInstructionsTable.createdAt)).limit(100)
      : [],
    runKeys.length
      ? db.select().from(serviceDisruptionsTable)
        .where(inArray(serviceDisruptionsTable.officialRunKey, runKeys))
        .orderBy(desc(serviceDisruptionsTable.createdAt)).limit(100)
      : [],
  ]);

  const now = Date.now();
  const gpsAgeMs = trip?.locationUpdatedAt ? Math.max(0, now - trip.locationUpdatedAt.getTime()) : null;
  const displayAgeMs = trip?.passengerLastSeenAt ? Math.max(0, now - trip.passengerLastSeenAt.getTime()) : null;
  const pairedScreenCount = activePassengerDisplays(busNumber).length;

  res.json({
    generatedAt: new Date(now).toISOString(),
    coach,
    assignment: assignment ? {
      id: assignment.id,
      driverId: assignment.driverSubject,
      driverName: assignment.driverName,
      officialRunKey: assignment.officialRunKey,
      direction: assignment.direction,
      scheduledDepartureAt: assignment.scheduledDepartureAt.toISOString(),
      assignedAt: assignment.assignedAt.toISOString(),
    } : null,
    trip: trip ? {
      status: trip.status,
      destinationAddress: trip.destinationAddress,
      scheduledDepartureAt: iso(trip.scheduledDepartureAt),
      startedAt: iso(trip.startedAt),
      completedAt: iso(trip.completedAt),
      updatedAt: trip.updatedAt.toISOString(),
      gps: {
        lat: trip.currentLat,
        lng: trip.currentLng,
        speedMph: trip.speedMph,
        observedAt: iso(trip.locationUpdatedAt),
        ageMs: gpsAgeMs,
        state: gpsAgeMs === null ? "missing" : gpsAgeMs > GPS_STALE_AFTER_MS ? "stale" : "fresh",
      },
      display: {
        pairedScreenCount,
        lastSeenAt: iso(trip.passengerLastSeenAt),
        state: pairedScreenCount > 0
          ? "connected"
          : displayAgeMs === null
            ? "never_seen"
            : displayAgeMs > DISPLAY_STALE_AFTER_MS ? "disconnected" : "recently_seen",
      },
    } : null,
    reports: reports.map(item => ({
      id: item.id,
      assignmentId: item.assignmentId,
      category: item.category,
      location: { lat: item.latitude, lng: item.longitude },
      locationObservedAt: item.locationObservedAt.toISOString(),
      createdAt: item.createdAt.toISOString(),
      resolvedAt: iso(item.resolvedAt),
      resolution: item.resolution,
    })),
    instructions: instructions.map(item => ({
      id: item.id,
      assignmentId: item.assignmentId,
      message: item.message,
      createdAt: item.createdAt.toISOString(),
      deliveredAt: iso(item.deliveredAt),
      acknowledgedAt: iso(item.acknowledgedAt),
    })),
    notices: notices.map(item => ({
      id: item.id,
      officialRunKey: item.officialRunKey,
      type: item.type,
      message: item.message,
      startsAt: item.startsAt.toISOString(),
      expiresAt: item.expiresAt.toISOString(),
      clearedAt: iso(item.clearedAt),
    })),
    history: history.map(item => ({
      id: item.id,
      driverId: item.driverSubject,
      driverName: item.driverName,
      officialRunKey: item.officialRunKey,
      serviceDate: item.serviceDate,
      direction: item.direction,
      scheduledDepartureAt: item.scheduledDepartureAt.toISOString(),
      assignedAt: item.assignedAt.toISOString(),
      endedAt: iso(item.endedAt),
      outcome: item.outcome,
    })),
  });
});

export default router;