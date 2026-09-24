import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export const adminActionHistoryTable = pgTable("admin_action_history", {
  id: uuid("id").primaryKey(),
  actorSubject: text("actor_subject").notNull(),
  actorRole: varchar("actor_role", { length: 24 }).notNull(),
  capability: varchar("capability", { length: 24 }).notNull(),
  action: varchar("action", { length: 120 }).notNull(),
  targetType: varchar("target_type", { length: 48 }),
  targetId: text("target_id"),
  before: jsonb("before").$type<Record<string, unknown> | null>(),
  after: jsonb("after").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  recentActions: index("admin_action_history_recent_idx").on(table.createdAt),
  actorActions: index("admin_action_history_actor_idx").on(table.actorSubject, table.createdAt),
}));

export type AdminActionHistoryRow = typeof adminActionHistoryTable.$inferSelect;