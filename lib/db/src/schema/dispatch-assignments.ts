import { index, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const dispatchAssignmentsTable = pgTable("dispatch_assignments", {
  id: serial("id").primaryKey(),
  busNumber: varchar("bus_number", { length: 6 }).notNull(),
  driverSubject: text("driver_subject").notNull(),
  driverName: varchar("driver_name", { length: 120 }),
  officialRunKey: varchar("official_run_key", { length: 180 }).notNull(),
  serviceDate: varchar("service_date", { length: 10 }).notNull(),
  direction: varchar("direction", { length: 120 }).notNull(),
  scheduledDepartureAt: timestamp("scheduled_departure_at", { withTimezone: true }).notNull(),
  assignedBy: text("assigned_by"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  outcome: varchar("outcome", { length: 24 }).notNull().default("active"),
}, (table) => ({
  historyLookup: index("dispatch_assignments_history_lookup_idx").on(table.serviceDate, table.busNumber, table.driverSubject),
  activeCoachLookup: index("dispatch_assignments_active_coach_lookup_idx").on(table.busNumber, table.endedAt),
  activeRunLookup: index("dispatch_assignments_active_run_lookup_idx").on(table.officialRunKey, table.endedAt),
}));

export const insertDispatchAssignmentSchema = createInsertSchema(dispatchAssignmentsTable);
export type DispatchAssignmentRow = typeof dispatchAssignmentsTable.$inferSelect;