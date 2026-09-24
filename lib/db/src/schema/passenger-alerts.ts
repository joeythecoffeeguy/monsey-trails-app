import { boolean, index, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { liveTripsTable } from "./live-trips";

export type PassengerAlertLeadTime = "time-15m" | "time-5m" | "time-2m" | "arriving-now" | "distance-0.5mi";
export type PassengerAlertState = "pending" | "sending" | "delivered" | "expired";

export const passengerAlertsTable = pgTable("passenger_alerts", {
  id: varchar("id", { length: 40 }).primaryKey(),
  operatorPairingCode: varchar("operator_pairing_code", { length: 6 })
    .notNull()
    .references(() => liveTripsTable.pairingCode, { onDelete: "cascade" }),
  passengerCode: varchar("passenger_code", { length: 6 }).notNull(),
  deviceId: varchar("device_id", { length: 160 }).notNull(),
  expoPushToken: varchar("expo_push_token", { length: 255 }).notNull(),
  selectedStopId: varchar("selected_stop_id", { length: 80 }).notNull(),
  leadTime: varchar("lead_time", { length: 24 }).$type<PassengerAlertLeadTime>().notNull(),
  soundEnabled: boolean("sound_enabled").notNull().default(true),
  state: varchar("state", { length: 16 }).$type<PassengerAlertState>().notNull().default("pending"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  activeDevice: uniqueIndex("passenger_alerts_active_device_idx").on(
    table.operatorPairingCode, table.passengerCode, table.deviceId,
  ),
  tripLookup: index("passenger_alerts_trip_lookup_idx").on(table.operatorPairingCode, table.state),
}));

export type PassengerAlertRow = typeof passengerAlertsTable.$inferSelect;