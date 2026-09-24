import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export type PassengerAccountJourneyStop = {
  id: string;
  label: string;
  kind: "pickup" | "dropoff";
  lat: number;
  lng: number;
};

export const passengerAccountJourneysTable = pgTable("passenger_account_journeys", {
  id: varchar("id", { length: 36 }).primaryKey(),
  clerkSubject: text("clerk_subject").notNull(),
  routeKey: varchar("route_key", { length: 512 }).notNull(),
  line: integer("line").notNull(),
  origin: integer("origin").notNull(),
  destination: integer("destination").notNull(),
  label: varchar("label", { length: 120 }).notNull(),
  pickup: jsonb("pickup").$type<PassengerAccountJourneyStop>(),
  dropoff: jsonb("dropoff").$type<PassengerAccountJourneyStop>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerRoute: uniqueIndex("passenger_account_journeys_owner_route_idx").on(table.clerkSubject, table.routeKey),
  ownerCreated: index("passenger_account_journeys_owner_created_idx").on(table.clerkSubject, table.createdAt),
}));

export type PassengerAccountJourneyRow = typeof passengerAccountJourneysTable.$inferSelect;