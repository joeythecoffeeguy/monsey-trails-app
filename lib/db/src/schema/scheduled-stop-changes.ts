import { index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export type ScheduledStopChangeKind = "create" | "update" | "delete";
export type ScheduledStopChangeState = "queued" | "applied" | "cancelled" | "failed";

export const scheduledStopChangesTable = pgTable("scheduled_stop_changes", {
  id: varchar("id", { length: 40 }).primaryKey(),
  kind: varchar("kind", { length: 12 }).$type<ScheduledStopChangeKind>().notNull(),
  stopKey: varchar("stop_key", { length: 320 }),
  change: jsonb("change").$type<Record<string, unknown>>().notNull().default({}),
  applyAt: timestamp("apply_at", { withTimezone: true }).notNull(),
  state: varchar("state", { length: 16 }).$type<ScheduledStopChangeState>().notNull().default("queued"),
  requestedBy: text("requested_by").notNull(),
  confirmedImpactRevision: varchar("confirmed_impact_revision", { length: 64 }).notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  dueLookup: index("scheduled_stop_changes_due_lookup_idx").on(table.state, table.applyAt),
}));

export type ScheduledStopChangeRow = typeof scheduledStopChangesTable.$inferSelect;