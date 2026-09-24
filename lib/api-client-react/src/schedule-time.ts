const NEW_YORK_TIME_ZONE = "America/New_York";

const newYorkDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NEW_YORK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const newYorkDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: NEW_YORK_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function dateParts(date: Date, formatter: Intl.DateTimeFormat) {
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function parseCalendarDate(date: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(0);
  candidate.setUTCFullYear(year, month - 1, day);
  candidate.setUTCHours(0, 0, 0, 0);

  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return [year, month, day];
}

function validClockParts(hour: string, minute: string, second: string) {
  return Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59;
}

function normalizePublishedWallClock(date: string, hour: string, minute: string, second: string) {
  const publishedHour = Number(hour);
  if (publishedHour > 47 || Number(minute) > 59 || Number(second) > 59) return null;
  return {
    date: addServiceDays(date, Math.floor(publishedHour / 24)),
    hour: String(publishedHour % 24).padStart(2, "0"),
    minute,
    second,
  };
}

function parseOffsetInstant(date: string, time: string): Date | null {
  const timeOnly = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(time);
  const dateTime = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(time);
  const match = timeOnly ?? dateTime;
  if (!match) return null;

  const embeddedDate = dateTime?.[1] ?? date;
  if (!parseCalendarDate(embeddedDate)) return null;

  const partOffset = dateTime ? 1 : 0;
  const hour = match[1 + partOffset];
  const minute = match[2 + partOffset];
  const second = match[3 + partOffset] ?? "00";
  const offset = match[5 + partOffset];
  if (!validClockParts(hour, minute, second)) return null;

  if (offset !== "Z") {
    const [, offsetHour, offsetMinute] = /^([+-])(\d{2}):(\d{2})$/.exec(offset)!;
    if (Number(offsetHour) > 23 || Number(offsetMinute) > 59) return null;
  }

  const clock = timeOnly ? time : time.slice(11);
  const candidate = new Date(`${embeddedDate}T${clock}`);
  return Number.isFinite(candidate.getTime()) ? candidate : null;
}

/**
 * Returns the current calendar date in the New York service timezone.
 */
export function getNewYorkServiceDate(now: Date = new Date()): string {
  const parts = dateParts(now, newYorkDateFormatter);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Resolves a published departure time to an instant.
 *
 * Offset-bearing ISO times are honored directly. Offset-free HH:mm and
 * HH:mm:ss values are interpreted as New York wall-clock times. Published
 * transit hours from 24 through 47 mean the following calendar day while
 * retaining the supplied service-date identity. On the fall DST transition
 * the later instant is used; nonexistent spring times fail closed.
 */
export function getScheduledDepartureInstant(date: string, time: string): Date | null {
  if (!parseCalendarDate(date)) return null;

  const value = time.trim();
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return parseOffsetInstant(date, value);
  }

  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;

  const [, hour, minute, second = "00"] = match;
  const normalized = normalizePublishedWallClock(date, hour, minute, second);
  if (!normalized) return null;

  const wallClock = `${normalized.date}T${normalized.hour}:${normalized.minute}:${normalized.second}`;
  const candidates = [4, 5]
    .map((offset) => new Date(`${wallClock}-0${offset}:00`))
    .filter((candidate) => {
      if (!Number.isFinite(candidate.getTime())) return false;
      const parts = dateParts(candidate, newYorkDateTimeFormatter);
      return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}` === wallClock;
    });

  return candidates.at(-1) ?? null;
}

/**
 * Filters today's runs to departures that have not reached their cutoff.
 */
export function getUpcomingScheduleRuns<
  T extends { scheduledTime: string; firstPickupTime?: string | null },
>(runs: T[], date: string, now: Date = new Date()): T[] {
  if (!parseCalendarDate(date)) return [];

  const today = getNewYorkServiceDate(now);
  if (date < today) return [];
  if (date > today) return runs;

  return runs.filter((run) => {
    const time = run.scheduledTime || run.firstPickupTime;
    if (!time) return false;
    const departure = getScheduledDepartureInstant(date, time);
    return departure !== null && departure.getTime() > now.getTime();
  });
}

/**
 * Adds whole service days using timezone-independent UTC calendar arithmetic.
 */
export function addServiceDays(date: string, days: number): string {
  const parts = parseCalendarDate(date);
  if (!parts) throw new RangeError("date must be a valid YYYY-MM-DD calendar date");
  if (!Number.isInteger(days)) throw new RangeError("days must be an integer");

  const [year, month, day] = parts;
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, day + days);
  result.setUTCHours(0, 0, 0, 0);

  const resultYear = String(result.getUTCFullYear()).padStart(4, "0");
  const resultMonth = String(result.getUTCMonth() + 1).padStart(2, "0");
  const resultDay = String(result.getUTCDate()).padStart(2, "0");
  return `${resultYear}-${resultMonth}-${resultDay}`;
}