import { boolean, doublePrecision, index, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export interface StoredTripStop {
  id: string;
  address: string;
  lat: number;
  lng: number;
  eta?: string;
  /** Public response decoration; official notes are not persisted. */
  note?: string;
}

export interface StoredRouteCoordinate {
  lat: number;
  lng: number;
}

export interface StoredAnnouncement {
  id: string;
  title: string;
  message: string;
  active: boolean;
}

export const liveTripsTable = pgTable("live_trips", {
  pairingCode: varchar("pairing_code", { length: 6 }).primaryKey(),
  status: varchar("status", { length: 16 }).notNull().default("idle"),
  destinationAddress: text("destination_address").notNull().default(""),
  destinationLat: doublePrecision("destination_lat"),
  destinationLng: doublePrecision("destination_lng"),
  intermediateStops: jsonb("intermediate_stops").$type<StoredTripStop[]>().notNull().default([]),
  routeGeometry: jsonb("route_geometry").$type<StoredRouteCoordinate[]>().notNull().default([]),
  originLat: doublePrecision("origin_lat"),
  originLng: doublePrecision("origin_lng"),
  currentLat: doublePrecision("current_lat"),
  currentLng: doublePrecision("current_lng"),
  locationUpdatedAt: timestamp("location_updated_at", { withTimezone: true }),
  totalDistanceMiles: doublePrecision("total_distance_miles"),
  remainingDistanceMiles: doublePrecision("remaining_distance_miles"),
  eta: timestamp("eta", { withTimezone: true }),
  speedMph: doublePrecision("speed_mph"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  emergencyOverride: boolean("emergency_override").notNull().default(false),
  emergencyMessage: text("emergency_message").notNull().default("Please remain seated and follow all instructions from the driver."),
  routeId: varchar("route_id", { length: 24 }).notNull().default("route-1"),
  displayMode: varchar("display_mode", { length: 24 }).notNull().default("auto"),
  passengerLanguage: varchar("passenger_language", { length: 8 }).notNull().default("en"),
  rotationIntervalSeconds: doublePrecision("rotation_interval_seconds").notNull().default(15),
  arrivalSoundsEnabled: boolean("arrival_sounds_enabled").notNull().default(true),
  announcements: jsonb("announcements").$type<StoredAnnouncement[]>().notNull().default([]),
  passengerLastSeenAt: timestamp("passenger_last_seen_at", { withTimezone: true }),
  chimeTestRequestedAt: timestamp("chime_test_requested_at", { withTimezone: true }),
  lastPushNotifiedStopKey: varchar("last_push_notified_stop_key", { length: 160 }),
  retiredAt: timestamp("retired_at", { withTimezone: true }),
  passengerPairingCode: varchar("replacement_pairing_code", { length: 6 }),
  officialRunKey: varchar("official_run_key", { length: 180 }),
  ownerSubject: text("owner_subject"),
  scheduledDepartureAt: timestamp("scheduled_departure_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  officialRunLookup: index("live_trips_official_run_lookup_idx").on(table.officialRunKey, table.retiredAt),
}));

export type LiveTripRow = typeof liveTripsTable.$inferSelect;