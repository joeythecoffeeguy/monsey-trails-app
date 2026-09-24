import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const passengerInfoTable = pgTable("passenger_info", {
  id: text("id").primaryKey(),
  content: jsonb("content").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
  sourceFingerprint: text("source_fingerprint"),
  detectedFingerprint: text("detected_fingerprint"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
});