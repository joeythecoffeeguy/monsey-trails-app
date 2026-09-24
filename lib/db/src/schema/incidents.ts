import { index, integer, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const incidentsTable = pgTable("incidents", {
  id: uuid("id").primaryKey(),
  title: varchar("title", { length: 160 }).notNull(),
  description: text("description").notNull(),
  severity: varchar("severity", { length: 16 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("identified"),
  operationalReportId: text("operational_report_id"),
  replacementAssignmentId: integer("replacement_assignment_id"),
  openedBy: text("opened_by").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolution: text("resolution"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  statusUpdatedLookup: index("incidents_status_updated_idx").on(table.status, table.updatedAt),
  reportLookup: index("incidents_operational_report_idx").on(table.operationalReportId),
}));

export const incidentAffectedAssignmentsTable = pgTable("incident_affected_assignments", {
  incidentId: uuid("incident_id").notNull(),
  assignmentId: integer("assignment_id").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  key: primaryKey({ columns: [table.incidentId, table.assignmentId] }),
  assignmentLookup: index("incident_affected_assignment_idx").on(table.assignmentId),
}));

export const incidentEventsTable = pgTable("incident_events", {
  id: uuid("id").primaryKey(),
  incidentId: uuid("incident_id").notNull(),
  eventType: varchar("event_type", { length: 40 }).notNull(),
  note: text("note").notNull(),
  actorSubject: text("actor_subject").notNull(),
  evidenceType: varchar("evidence_type", { length: 40 }),
  evidenceId: text("evidence_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  incidentTimeline: index("incident_events_timeline_idx").on(table.incidentId, table.createdAt),
}));

export const insertIncidentSchema = createInsertSchema(incidentsTable);
export const insertIncidentEventSchema = createInsertSchema(incidentEventsTable);
export type IncidentRow = typeof incidentsTable.$inferSelect;
export type IncidentEventRow = typeof incidentEventsTable.$inferSelect;