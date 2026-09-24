import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

// Web Push subscriptions registered by passenger displays so stop alerts can
// reach a locked/backgrounded phone, not just a foreground browser tab.
export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: varchar("id", { length: 64 }).primaryKey(),
  pairingCode: varchar("pairing_code", { length: 6 }).notNull(),
  displayId: varchar("display_id", { length: 64 }).notNull(),
  stopKey: varchar("stop_key", { length: 160 }).notNull(),
  stopLabel: text("stop_label").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PushSubscriptionRow = typeof pushSubscriptionsTable.$inferSelect;

// Server-generated VAPID keypair, persisted so it survives restarts without
// needing to be handed to us as a secret; there is exactly one row.
export const pushVapidKeysTable = pgTable("push_vapid_keys", {
  id: varchar("id", { length: 16 }).primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PushVapidKeysRow = typeof pushVapidKeysTable.$inferSelect;
