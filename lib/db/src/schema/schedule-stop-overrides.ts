import { boolean, index, integer, pgTable, timestamp, text, varchar, doublePrecision } from "drizzle-orm/pg-core";

export const scheduleStopOverridesTable = pgTable("schedule_stop_overrides", {
  key: varchar("key", { length: 320 }).primaryKey(),
  areaId: varchar("area_id", { length: 16 }).notNull(),
  areaName: varchar("area_name", { length: 120 }).notNull(),
  canonicalLabel: varchar("canonical_label", { length: 240 }).notNull(),
  sourceLabel: varchar("source_label", { length: 240 }).notNull(),
  address: varchar("address", { length: 320 }),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  category: varchar("category", { length: 16 }).notNull().default("both"),
  isCustom: boolean("is_custom").notNull().default(false),
  suppressed: boolean("suppressed").notNull().default(false),
  sequence: integer("sequence").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
}, (table) => ({
  areaLookup: index("schedule_stop_overrides_area_lookup_idx").on(table.areaId),
}));

export type ScheduleStopOverrideRow = typeof scheduleStopOverridesTable.$inferSelect;