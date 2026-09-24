import { boolean, date, index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const fleetCoachesTable = pgTable("fleet_coaches", {
  busNumber: varchar("bus_number", { length: 6 }).primaryKey(),
  label: varchar("label", { length: 80 }),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  inactiveReason: varchar("inactive_reason", { length: 240 }),
  returnToServiceDate: date("return_to_service_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  activeLookup: index("fleet_coaches_active_lookup_idx").on(table.active, table.busNumber),
}));

export const insertFleetCoachSchema = createInsertSchema(fleetCoachesTable);
export type FleetCoachRow = typeof fleetCoachesTable.$inferSelect;