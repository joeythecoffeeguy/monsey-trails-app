import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, varchar } from "drizzle-orm/pg-core";

export type AdminDisplaySlide =
  | "welcome" | "map" | "weather" | "traffic" | "daf" | "jewish-calendar"
  | "announcements" | "destinations-info" | "fares-info" | "passenger-guide"
  | "contact-info" | "charging-amenities" | "safety";

export interface AdminDisplayAnnouncement {
  id: string;
  title: string;
  message: string;
  active: boolean;
}

export const adminDisplaySettingsTable = pgTable("admin_display_settings", {
  busNumber: varchar("bus_number", { length: 6 }).primaryKey(),
  version: integer("version").notNull().default(1),
  enabledSlides: jsonb("enabled_slides").$type<AdminDisplaySlide[]>().notNull().default([]),
  passengerLanguage: varchar("passenger_language", { length: 8 }).notNull().default("en"),
  rotationIntervalSeconds: integer("rotation_interval_seconds").notNull().default(15),
  announcements: jsonb("announcements").$type<AdminDisplayAnnouncement[]>().notNull().default([]),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adminDisplayReceiptsTable = pgTable("admin_display_receipts", {
  busNumber: varchar("bus_number", { length: 6 }).notNull(),
  displayId: varchar("display_id", { length: 80 }).notNull(),
  pairingGeneration: varchar("pairing_generation", { length: 64 }).notNull(),
  sessionGeneration: varchar("session_generation", { length: 64 }),
  receivedVersion: integer("received_version").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  connected: boolean("connected").notNull().default(true),
}, (table) => ({
  pk: primaryKey({ columns: [table.busNumber, table.displayId] }),
}));