import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const driverProfilesTable = pgTable("driver_profiles", {
  clerkSubject: text("clerk_subject").primaryKey(),
  username: varchar("username", { length: 32 }).notNull(),
  usernameKey: varchar("username_key", { length: 32 }).notNull().unique("driver_profiles_username_key_key"),
  unitNumber: varchar("unit_number", { length: 20 }).notNull(),
  phoneNumber: varchar("phone_number", { length: 16 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDriverProfileSchema = createInsertSchema(driverProfilesTable);
export type DriverProfileRow = typeof driverProfilesTable.$inferSelect;