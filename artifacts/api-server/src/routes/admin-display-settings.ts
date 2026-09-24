import { Router, json, type IRouter } from "express";
import { createHash } from "node:crypto";
import {
  adminDisplayReceiptsTable,
  adminDisplaySettingsTable,
  db,
  liveTripsTable,
  type AdminDisplayAnnouncement,
  type AdminDisplaySlide,
} from "@workspace/db";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { activePassengerDisplays, activePassengerDisplaySessionGeneration } from "./trip";
import { requireAdminCapability } from "../middlewares/admin-role-policy";

const router: IRouter = Router();
const BUS_NUMBER = /^[A-Z0-9]{1,6}$/;
const LANGUAGES = new Set(["en", "yi", "he"]);
export const DISPLAY_SLIDES = [
  "welcome", "map", "weather", "traffic", "daf", "jewish-calendar",
  "announcements", "destinations-info", "fares-info", "passenger-guide",
  "contact-info", "charging-amenities", "safety",
] as const satisfies readonly AdminDisplaySlide[];
const DISPLAY_SLIDE_SET = new Set<string>(DISPLAY_SLIDES);

function normalizeBusNumber(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function validAnnouncements(value: unknown): value is AdminDisplayAnnouncement[] {
  return Array.isArray(value) && value.length <= 20 && value.every(item => {
    if (!item || typeof item !== "object") return false;
    const announcement = item as Record<string, unknown>;
    return typeof announcement.id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(announcement.id)
      && typeof announcement.title === "string" && announcement.title.trim().length > 0 && announcement.title.length <= 100
      && typeof announcement.message === "string" && announcement.message.trim().length > 0 && announcement.message.length <= 500
      && typeof announcement.active === "boolean";
  }) && new Set(value.map(item => item.id)).size === value.length;
}

export async function displaySettingsForBus(busNumber: string) {
  const [settings] = await db.select().from(adminDisplaySettingsTable)
    .where(eq(adminDisplaySettingsTable.busNumber, busNumber)).limit(1);
  return settings ?? null;
}

router.use("/admin/display", json());

router.get("/admin/display", requireAdminCapability("access"), async (_req, res): Promise<void> => {
  const trips = await db.select().from(liveTripsTable).where(and(
    isNull(liveTripsTable.retiredAt),
    inArray(liveTripsTable.status, ["ready", "running"]),
  ));
  res.json(trips.map(trip => ({
    busNumber: trip.pairingCode,
    status: trip.status,
    destinationAddress: trip.destinationAddress,
    pairedScreenCount: activePassengerDisplays(trip.pairingCode).length,
  })));
});

router.get("/admin/display/:busNumber", requireAdminCapability("access"), async (req, res): Promise<void> => {
  const busNumber = normalizeBusNumber(req.params.busNumber);
  if (!BUS_NUMBER.test(busNumber)) {
    res.status(400).json({ error: "A valid coach number is required." });
    return;
  }
  const [trip] = await db.select({
    busNumber: liveTripsTable.pairingCode,
    passengerPairingCode: liveTripsTable.passengerPairingCode,
  })
    .from(liveTripsTable).where(and(
      eq(liveTripsTable.pairingCode, busNumber),
      isNull(liveTripsTable.retiredAt),
      inArray(liveTripsTable.status, ["ready", "running"]),
    )).limit(1);
  if (!trip) {
    res.status(404).json({ error: "That coach does not have a current trip." });
    return;
  }
  const settings = await displaySettingsForBus(busNumber);
  const generation = trip.passengerPairingCode
    ? createHash("sha256").update(`passenger-pairing:${trip.passengerPairingCode}`).digest("hex")
    : "";
  const receipts = generation ? await db.select().from(adminDisplayReceiptsTable)
    .where(and(
      eq(adminDisplayReceiptsTable.busNumber, busNumber),
      eq(adminDisplayReceiptsTable.pairingGeneration, generation),
    )) : [];
  const connected = activePassengerDisplays(busNumber);
  res.json({
    settings: settings ?? {
      busNumber,
      version: 0,
      enabledSlides: [...DISPLAY_SLIDES],
      passengerLanguage: "en",
      rotationIntervalSeconds: 15,
      announcements: [],
      updatedAt: null,
    },
    screens: connected.map(screen => {
      const currentSessionGeneration = activePassengerDisplaySessionGeneration(busNumber, screen.id);
      const receipt = receipts.find(item =>
        item.displayId === screen.id
        && item.sessionGeneration === currentSessionGeneration);
      return {
        id: screen.id,
        audioReady: screen.audioReady,
        latestReceivedVersion: receipt?.receivedVersion ?? null,
        receivedAt: receipt?.receivedAt?.toISOString() ?? null,
      };
    }),
  });
});

router.put("/admin/display/:busNumber", requireAdminCapability("content"), async (req, res): Promise<void> => {
  const busNumber = normalizeBusNumber(req.params.busNumber);
  const enabledSlides = req.body?.enabledSlides;
  const passengerLanguage = req.body?.passengerLanguage;
  const rotationIntervalSeconds = req.body?.rotationIntervalSeconds;
  const announcements = req.body?.announcements;
  if (!BUS_NUMBER.test(busNumber)
    || !Array.isArray(enabledSlides) || enabledSlides.length < 1
    || enabledSlides.some(value => typeof value !== "string" || !DISPLAY_SLIDE_SET.has(value))
    || new Set(enabledSlides).size !== enabledSlides.length
    || !LANGUAGES.has(passengerLanguage)
    || !Number.isInteger(rotationIntervalSeconds) || rotationIntervalSeconds < 5 || rotationIntervalSeconds > 300
    || !validAnnouncements(announcements)) {
    res.status(400).json({ error: "Choose at least one valid slide, a supported language, a duration from 5 to 300 seconds, and valid announcements." });
    return;
  }
  const now = new Date();
  const normalizedAnnouncements = announcements.map(item => ({
    ...item, title: item.title.trim(), message: item.message.trim(),
  }));
  const [settings] = await db.insert(adminDisplaySettingsTable).values({
    busNumber,
    version: 1,
    enabledSlides,
    passengerLanguage,
    rotationIntervalSeconds,
    announcements: normalizedAnnouncements,
    updatedBy: res.locals.adminSubject,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: adminDisplaySettingsTable.busNumber,
    set: {
      version: sql`${adminDisplaySettingsTable.version} + 1`,
      enabledSlides,
      passengerLanguage,
      rotationIntervalSeconds,
      announcements: normalizedAnnouncements,
      updatedBy: res.locals.adminSubject,
      updatedAt: now,
    },
  }).returning();
  await db.update(liveTripsTable).set({
    passengerLanguage,
    rotationIntervalSeconds,
    announcements: normalizedAnnouncements,
    updatedAt: now,
  }).where(and(eq(liveTripsTable.pairingCode, busNumber), isNull(liveTripsTable.retiredAt)));
  res.json(settings);
});

router.post("/admin/display/:busNumber/emergency", requireAdminCapability("dispatch"), async (req, res): Promise<void> => {
  const busNumber = normalizeBusNumber(req.params.busNumber);
  const enabled = req.body?.enabled;
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const confirmation = req.body?.confirmation;
  if (!BUS_NUMBER.test(busNumber) || typeof enabled !== "boolean" || !message || message.length > 500
    || confirmation !== `EMERGENCY ${busNumber}`) {
    res.status(400).json({ error: `Emergency takeover requires the exact confirmation “EMERGENCY ${busNumber}” and a message.` });
    return;
  }
  const [trip] = await db.update(liveTripsTable).set({
    emergencyOverride: enabled,
    emergencyMessage: message,
    updatedAt: new Date(),
  }).where(and(eq(liveTripsTable.pairingCode, busNumber), isNull(liveTripsTable.retiredAt))).returning();
  if (!trip) {
    res.status(404).json({ error: "That coach does not have a current trip." });
    return;
  }
  res.json({ emergencyOverride: trip.emergencyOverride, emergencyMessage: trip.emergencyMessage });
});

export default router;