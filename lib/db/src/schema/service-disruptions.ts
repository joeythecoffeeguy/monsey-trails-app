import { index, integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const serviceDisruptionsTable = pgTable("service_disruptions", {
  id: uuid("id").primaryKey(),
  communicationGroupId: uuid("communication_group_id"),
  officialRunKey: varchar("official_run_key", { length: 180 }).notNull(),
  type: varchar("type", { length: 24 }).notNull(),
  message: text("message").notNull(),
  delayMinutes: integer("delay_minutes"),
  stopName: varchar("stop_name", { length: 160 }),
  targetCoachNumbers: text("target_coach_numbers"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  clearedAt: timestamp("cleared_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  activeRunLookup: index("service_disruptions_active_run_lookup_idx")
    .on(table.officialRunKey, table.clearedAt, table.startsAt, table.expiresAt),
  communicationGroupLookup: index("service_disruptions_communication_group_lookup_idx")
    .on(table.communicationGroupId, table.clearedAt),
}));

export const insertServiceDisruptionSchema = createInsertSchema(serviceDisruptionsTable);
export type ServiceDisruptionRow = typeof serviceDisruptionsTable.$inferSelect;