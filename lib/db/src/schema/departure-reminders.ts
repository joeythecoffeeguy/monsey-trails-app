import { index, integer, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export type DepartureReminderKind = "once" | "weekly";
export type DepartureReminderChannel = "expo" | "web";
export type DepartureReminderState = "active" | "sending" | "delivered" | "cancelled" | "error";

/**
 * Server-owned departure reminders. Provider credentials deliberately live here
 * rather than on a browser timer so reminders can arrive while the app is closed.
 */
export const departureRemindersTable = pgTable("departure_reminders", {
  id: varchar("id", { length: 40 }).primaryKey(),
  deviceId: varchar("device_id", { length: 160 }).notNull(),
  // SHA-256 of a client-held installation capability. The capability itself is
  // never persisted, returned, or placed in a URL.
  ownerCapabilityHash: varchar("owner_capability_hash", { length: 64 }),
  kind: varchar("kind", { length: 12 }).$type<DepartureReminderKind>().notNull(),
  serviceDate: varchar("service_date", { length: 10 }),
  line: integer("line").notNull(),
  origin: integer("origin").notNull(),
  destination: integer("destination").notNull(),
  runId: varchar("run_id", { length: 100 }).notNull(),
  weekdays: jsonb("weekdays").$type<number[]>().notNull().default([]),
  leadMinutes: integer("lead_minutes").notNull().default(15),
  channel: varchar("channel", { length: 8 }).$type<DepartureReminderChannel>().notNull(),
  expoPushToken: varchar("expo_push_token", { length: 255 }),
  webEndpoint: text("web_endpoint"),
  webP256dh: text("web_p256dh"),
  webAuth: text("web_auth"),
  state: varchar("state", { length: 16 }).$type<DepartureReminderState>().notNull().default("active"),
  nextCheckAt: timestamp("next_check_at", { withTimezone: true }).notNull().defaultNow(),
  nextOccurrenceAt: timestamp("next_occurrence_at", { withTimezone: true }),
  // Keep the published service date separately: a 25:00 run occurs on the next
  // calendar day but must still be revalidated against the original service date.
  nextOccurrenceServiceDate: varchar("next_occurrence_service_date", { length: 10 }),
  lastOccurrenceDate: varchar("last_occurrence_date", { length: 10 }),
  lastScheduledDepartureAt: timestamp("last_scheduled_departure_at", { withTimezone: true }),
  lastNotifiedEventKey: varchar("last_notified_event_key", { length: 180 }),
  failureCount: integer("failure_count").notNull().default(0),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  dueLookup: index("departure_reminders_due_lookup_idx").on(table.state, table.nextCheckAt),
  deviceLookup: index("departure_reminders_device_lookup_idx").on(table.deviceId, table.createdAt),
  ownerLookup: index("departure_reminders_owner_lookup_idx").on(table.ownerCapabilityHash, table.deviceId),
}));

export type DepartureReminderRow = typeof departureRemindersTable.$inferSelect;