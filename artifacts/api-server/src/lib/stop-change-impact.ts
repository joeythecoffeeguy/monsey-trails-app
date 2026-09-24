import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  db,
  departureRemindersTable,
  liveTripsTable,
  passengerAlertsTable,
  type LiveTripRow,
} from "@workspace/db";

export type StopChangeKind = "create" | "update" | "delete";
export type StopChangeProposal = {
  kind: StopChangeKind;
  key?: string;
  areaId: number;
  areaName: string;
  canonicalLabel: string;
  sourceLabel: string;
  change?: Record<string, unknown>;
};

function relevantTrip(row: LiveTripRow, areaId: number) {
  if (!row.officialRunKey) return false;
  const [, , origin, destination] = row.officialRunKey.split("|").map(Number);
  return origin === areaId || destination === areaId;
}

export async function buildStopChangeImpact(proposal: StopChangeProposal) {
  const trips = (await db.select().from(liveTripsTable).where(and(
    isNotNull(liveTripsTable.officialRunKey),
    isNull(liveTripsTable.completedAt),
    isNull(liveTripsTable.retiredAt),
  ))).filter(row => relevantTrip(row, proposal.areaId));
  const active = trips.filter(row => row.status === "running");
  const upcoming = trips.filter(row => row.status === "ready");
  const pairingCodes = trips.map(row => row.pairingCode);
  const alerts = pairingCodes.length
    ? await db.select({ id: passengerAlertsTable.id })
      .from(passengerAlertsTable)
      .where(and(
        inArray(passengerAlertsTable.operatorPairingCode, pairingCodes),
        inArray(passengerAlertsTable.state, ["pending", "sending"]),
      ))
    : [];
  const departureReminders = await db.select({ id: departureRemindersTable.id })
    .from(departureRemindersTable)
    .where(and(
      eq(departureRemindersTable.state, "active"),
      inArray(departureRemindersTable.origin, [proposal.areaId]),
    ));
  const destinationReminders = await db.select({ id: departureRemindersTable.id })
    .from(departureRemindersTable)
    .where(and(
      eq(departureRemindersTable.state, "active"),
      inArray(departureRemindersTable.destination, [proposal.areaId]),
    ));
  const reminderIds = new Set([...departureReminders, ...destinationReminders].map(row => row.id));
  const routes = [...new Set(trips.map(row => row.officialRunKey!))].sort();
  const revisionSource = {
    proposal,
    trips: trips.map(row => ({
      pairingCode: row.pairingCode,
      officialRunKey: row.officialRunKey,
      status: row.status,
      destinationAddress: row.destinationAddress,
      intermediateStopIds: row.intermediateStops.map(stop => stop.id),
      scheduledDepartureAt: row.scheduledDepartureAt?.toISOString() ?? null,
    })).sort((a, b) => a.pairingCode.localeCompare(b.pairingCode)),
    alertIds: alerts.map(row => row.id).sort(),
    reminderIds: [...reminderIds].sort(),
  };
  const revision = createHash("sha256").update(JSON.stringify(revisionSource)).digest("hex");
  return {
    revision,
    generatedAt: new Date().toISOString(),
    change: { kind: proposal.kind, stopKey: proposal.key ?? null, stopName: proposal.canonicalLabel },
    affectedAreas: [{ areaId: proposal.areaId, areaName: proposal.areaName }],
    routes,
    upcomingTrips: upcoming.map(row => ({
      pairingCode: row.pairingCode,
      officialRunKey: row.officialRunKey!,
      scheduledDepartureAt: row.scheduledDepartureAt?.toISOString() ?? null,
    })),
    activeTrips: active.map(row => ({
      pairingCode: row.pairingCode,
      officialRunKey: row.officialRunKey!,
      finalStop: row.destinationAddress,
      liveRouteWillChange: false,
    })),
    serverEvidence: {
      activeTripAlerts: alerts.length,
      departureReminders: reminderIds.size,
      savedJourneys: null,
    },
    evidenceNotes: [
      "Active-trip alert and departure-reminder counts come from server records.",
      "Saved journeys and favorites are stored on passenger devices, so the server cannot count them.",
      active.length
        ? "Running coaches keep their current route and final stop. This change only affects later route construction."
        : "No running coach route will be changed.",
    ],
    mapWording: proposal.kind === "delete"
      ? "The stop marker will be removed from newly built passenger and driver routes after the change is applied."
      : "The stop marker and route label will use this location on newly built passenger and driver routes after the change is applied.",
  };
}