import { index, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

/**
 * Browser push subscriptions owned by administrators. These are deliberately
 * separate from passenger subscriptions so a test can never target a passenger
 * device identifier.
 */
export const adminNotificationDevicesTable = pgTable("admin_notification_devices", {
  id: varchar("id", { length: 40 }).primaryKey(),
  adminSubject: varchar("admin_subject", { length: 160 }).notNull(),
  capabilityHash: varchar("capability_hash", { length: 64 }).notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  state: varchar("state", { length: 16 }).$type<"registered" | "accepted" | "invalid" | "error">().notNull().default("registered"),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastAcceptedAt: timestamp("last_accepted_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerCapability: uniqueIndex("admin_notification_devices_owner_capability_idx")
    .on(table.adminSubject, table.capabilityHash),
  ownerUpdated: index("admin_notification_devices_owner_updated_idx")
    .on(table.adminSubject, table.updatedAt),
}));

export type AdminNotificationDeviceRow = typeof adminNotificationDevicesTable.$inferSelect;