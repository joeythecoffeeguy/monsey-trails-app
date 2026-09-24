import { boolean, doublePrecision, index, jsonb, pgTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { liveTripsTable } from "./live-trips";

export type PassengerLiveActivityPhase = "pickup" | "onboard" | "ended" | "unavailable";
export type PassengerLiveActivityProps = {
  phase: PassengerLiveActivityPhase;
  lineName: string;
  stopName: string;
  etaLabel: string;
  coachNumber: string;
  status: string;
  updatedAt: string;
};

export const passengerLiveActivitiesTable = pgTable("passenger_live_activities", {
  id: varchar("id", { length: 40 }).primaryKey(),
  clientActivityId: varchar("client_activity_id", { length: 160 }).notNull(),
  ownerCapabilityHash: varchar("owner_capability_hash", { length: 64 }).notNull(),
  passengerCode: varchar("passenger_code", { length: 6 }).notNull(),
  operatorPairingCode: varchar("operator_pairing_code", { length: 6 })
    .notNull().references(() => liveTripsTable.pairingCode, { onDelete: "cascade" }),
  officialRunKey: varchar("official_run_key", { length: 180 }).notNull(),
  pickupStopId: varchar("pickup_stop_id", { length: 100 }).notNull(),
  dropoffStopId: varchar("dropoff_stop_id", { length: 100 }).notNull(),
  pickupStopName: varchar("pickup_stop_name", { length: 240 }).notNull(),
  dropoffStopName: varchar("dropoff_stop_name", { length: 240 }).notNull(),
  pickupStopLat: doublePrecision("pickup_stop_lat").notNull(),
  pickupStopLng: doublePrecision("pickup_stop_lng").notNull(),
  dropoffStopLat: doublePrecision("dropoff_stop_lat").notNull(),
  dropoffStopLng: doublePrecision("dropoff_stop_lng").notNull(),
  lineName: varchar("line_name", { length: 120 }).notNull(),
  coachNumber: varchar("coach_number", { length: 6 }).notNull(),
  pushToken: varchar("push_token", { length: 200 }),
  phase: varchar("phase", { length: 16 }).$type<PassengerLiveActivityPhase>().notNull().default("pickup"),
  active: boolean("active").notNull().default(true),
  lastProps: jsonb("last_props").$type<PassengerLiveActivityProps>(),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  activityOwnerUnique: uniqueIndex("passenger_live_activity_owner_client_idx")
    .on(table.ownerCapabilityHash, table.clientActivityId),
  tripLookup: index("passenger_live_activity_trip_lookup_idx")
    .on(table.operatorPairingCode, table.active),
  tokenLookup: index("passenger_live_activity_token_lookup_idx").on(table.active),
}));

export type PassengerLiveActivityRow = typeof passengerLiveActivitiesTable.$inferSelect;