import { doublePrecision, index, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const operationalReportsTable = pgTable("operational_reports", {
  id: text("id").primaryKey(),
  assignmentId: integer("assignment_id").notNull(),
  busNumber: varchar("bus_number", { length: 6 }).notNull(),
  driverSubject: text("driver_subject").notNull(),
  officialRunKey: varchar("official_run_key", { length: 180 }).notNull(),
  category: varchar("category", { length: 32 }).notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  locationObservedAt: timestamp("location_observed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by"),
  resolution: varchar("resolution", { length: 240 }),
}, (table) => ({
  assignmentCreatedLookup: index("operational_reports_assignment_created_idx").on(table.assignmentId, table.createdAt),
  unresolvedLookup: index("operational_reports_unresolved_idx").on(table.resolvedAt, table.createdAt),
}));

export const dispatchInstructionsTable = pgTable("dispatch_instructions", {
  id: text("id").primaryKey(),
  assignmentId: integer("assignment_id").notNull(),
  busNumber: varchar("bus_number", { length: 6 }).notNull(),
  driverSubject: text("driver_subject").notNull(),
  officialRunKey: varchar("official_run_key", { length: 180 }).notNull(),
  message: varchar("message", { length: 500 }).notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
}, (table) => ({
  driverCreatedLookup: index("dispatch_instructions_driver_created_idx").on(table.driverSubject, table.createdAt),
  assignmentCreatedLookup: index("dispatch_instructions_assignment_created_idx").on(table.assignmentId, table.createdAt),
}));

export const insertOperationalReportSchema = createInsertSchema(operationalReportsTable);
export const insertDispatchInstructionSchema = createInsertSchema(dispatchInstructionsTable);
export type OperationalReportRow = typeof operationalReportsTable.$inferSelect;
export type DispatchInstructionRow = typeof dispatchInstructionsTable.$inferSelect;