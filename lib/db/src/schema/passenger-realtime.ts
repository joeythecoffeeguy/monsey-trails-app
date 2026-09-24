import { boolean, index, integer, jsonb, pgTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { liveTripsTable } from "./live-trips";

export type PassengerRealtimeFlow = "disruption" | "approaching-pickup" | "transfer-risk";
export type PassengerRealtimeDeliveryState = "pending" | "sending" | "receipt_pending" | "delivered" | "failed";

export const passengerRealtimeSubscriptionsTable = pgTable("passenger_realtime_subscriptions", {
  id: varchar("id", { length: 40 }).primaryKey(),
  flow: varchar("flow", { length: 24 }).$type<PassengerRealtimeFlow>().notNull(),
  deviceId: varchar("device_id", { length: 160 }).notNull(),
  ownerCapabilityHash: varchar("owner_capability_hash", { length: 64 }).notNull(),
  passengerCode: varchar("passenger_code", { length: 6 }).notNull(),
  operatorPairingCode: varchar("operator_pairing_code", { length: 6 })
    .notNull().references(() => liveTripsTable.pairingCode, { onDelete: "cascade" }),
  officialRunKey: varchar("official_run_key", { length: 180 }).notNull(),
  selectedStopId: varchar("selected_stop_id", { length: 100 }).notNull().default(""),
  onwardRunKey: varchar("onward_run_key", { length: 180 }).notNull().default(""),
  transferAreaId: integer("transfer_area_id"),
  minimumBufferMinutes: integer("minimum_buffer_minutes"),
  expoPushToken: varchar("expo_push_token", { length: 255 }).notNull(),
  soundEnabled: boolean("sound_enabled").notNull().default(true),
  active: boolean("active").notNull().default(true),
  pickupAlertGeneration: integer("pickup_alert_generation").notNull().default(0),
  lastConnectionStatus: varchar("last_connection_status", { length: 16 }),
  lastTransferAlertAt: timestamp("last_transfer_alert_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerLookup: index("passenger_realtime_owner_lookup_idx").on(table.deviceId, table.ownerCapabilityHash),
  runLookup: index("passenger_realtime_run_lookup_idx").on(table.operatorPairingCode, table.flow, table.active),
  subscriptionIdentity: uniqueIndex("passenger_realtime_subscription_identity_idx").on(
    table.deviceId, table.ownerCapabilityHash, table.flow, table.officialRunKey, table.selectedStopId, table.onwardRunKey,
  ),
}));

export const passengerRealtimeDeliveriesTable = pgTable("passenger_realtime_deliveries", {
  id: varchar("id", { length: 40 }).primaryKey(),
  subscriptionId: varchar("subscription_id", { length: 40 }).notNull()
    .references(() => passengerRealtimeSubscriptionsTable.id, { onDelete: "cascade" }),
  eventKey: varchar("event_key", { length: 240 }).notNull(),
  payload: jsonb("payload").$type<{ title: string; body: string; screen: string; soundEnabled?: boolean }>().notNull(),
  expoPushToken: varchar("expo_push_token", { length: 255 }),
  expoTicketId: varchar("expo_ticket_id", { length: 80 }),
  state: varchar("state", { length: 16 }).$type<PassengerRealtimeDeliveryState>().notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  receiptAttempts: integer("receipt_attempts").notNull().default(0),
  nextReceiptCheckAt: timestamp("next_receipt_check_at", { withTimezone: true }),
  receiptError: varchar("receipt_error", { length: 500 }),
  lastError: varchar("last_error", { length: 500 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  eventIdentity: uniqueIndex("passenger_realtime_delivery_identity_idx").on(table.subscriptionId, table.eventKey),
  dueLookup: index("passenger_realtime_delivery_due_idx").on(table.state, table.updatedAt),
}));

export type PassengerRealtimeSubscriptionRow = typeof passengerRealtimeSubscriptionsTable.$inferSelect;
export type PassengerRealtimeDeliveryRow = typeof passengerRealtimeDeliveriesTable.$inferSelect;