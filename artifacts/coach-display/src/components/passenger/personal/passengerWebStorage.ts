import type { PassengerScheduleFilters } from './PersonalUnpairedView';
import type { PassengerJourney } from './usePassengerJourney';
import type { OfficialSchedule } from '@/providers/official-schedules';

const PREFERENCES_KEY = 'monsey-passenger-preferences-v1';
const HISTORY_KEY = 'monsey-passenger-history-v1';
const JOURNEY_PREFIX = 'monsey-passenger-journey:';
const SCHEDULE_PREFIX = 'monsey-passenger-schedule:';

export type PersonalLanguage = 'en' | 'yi' | 'he';
export interface PassengerPreferences {
  largeText: boolean;
  reducedMotion: boolean;
  language: PersonalLanguage;
}

export interface SavedPassengerTrip {
  runKey: string;
  departureTime: string;
  filters: PassengerScheduleFilters;
  originName?: string;
  destinationName?: string;
  pickupStop?: SavedPassengerStop;
  dropoffStop?: SavedPassengerStop;
  savedAt: string;
}

export interface SavedPassengerStop {
  id: string;
  label: string;
  note?: string;
  lat: number;
  lng: number;
}

const defaultPreferences: PassengerPreferences = {
  largeText: false,
  reducedMotion: false,
  language: 'en',
};

function storageAvailable() {
  return typeof window !== 'undefined' && Boolean(window.localStorage);
}

function readJson(key: string): unknown {
  if (!storageAvailable()) return null;
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  if (!storageAvailable()) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readPassengerPreferences(): PassengerPreferences {
  const value = readJson(PREFERENCES_KEY) as Partial<PassengerPreferences> | null;
  return {
    largeText: value?.largeText === true,
    reducedMotion: value?.reducedMotion === true,
    language: value?.language === 'yi' || value?.language === 'he' ? value.language : 'en',
  };
}

export function savePassengerPreferences(value: PassengerPreferences) {
  if (writeJson(PREFERENCES_KEY, value)) window.dispatchEvent(new CustomEvent('passenger-preferences'));
}

export function resetPassengerPreferences() {
  savePassengerPreferences(defaultPreferences);
}

function validTrip(value: unknown): value is SavedPassengerTrip {
  const trip = value as Partial<SavedPassengerTrip> | null;
  return Boolean(
    trip
    && isSafeRunKey(trip.runKey)
    && typeof trip.departureTime === 'string'
    && /^\d{1,2}:\d{2}/.test(trip.departureTime)
    && trip.filters
    && trip.filters.date === trip.runKey?.split('|')[0]
    && validSavedStop(trip.pickupStop)
    && validSavedStop(trip.dropoffStop)
  );
}

function validSavedStop(value: unknown) {
  if (value === undefined) return true;
  const stop = value as Partial<SavedPassengerStop> | null;
  return Boolean(
    stop
    && typeof stop.id === 'string'
    && stop.id.length > 0
    && stop.id.length <= 240
    && typeof stop.label === 'string'
    && stop.label.length > 0
    && stop.label.length <= 240
    && typeof stop.lat === 'number'
    && Number.isFinite(stop.lat)
    && Math.abs(stop.lat) <= 90
    && typeof stop.lng === 'number'
    && Number.isFinite(stop.lng)
    && Math.abs(stop.lng) <= 180
    && (stop.note === undefined || (typeof stop.note === 'string' && stop.note.length <= 500))
  );
}

function readHistory(): { favorites: SavedPassengerTrip[]; recent: SavedPassengerTrip[] } {
  const value = readJson(HISTORY_KEY) as { favorites?: unknown[]; recent?: unknown[] } | null;
  return {
    favorites: (value?.favorites ?? []).filter(validTrip).slice(0, 12),
    recent: (value?.recent ?? []).filter(validTrip).slice(0, 6),
  };
}

function writeHistory(value: ReturnType<typeof readHistory>) {
  if (writeJson(HISTORY_KEY, value)) window.dispatchEvent(new CustomEvent('passenger-history'));
}

export function readPassengerHistory() {
  return readHistory();
}

export function rememberPassengerTrip(trip: SavedPassengerTrip) {
  if (!validTrip(trip)) return;
  const history = readHistory();
  const identity = savedTripIdentity(trip);
  history.recent = [trip, ...history.recent.filter((item) => savedTripIdentity(item) !== identity)].slice(0, 6);
  history.favorites = history.favorites.map((item) => savedTripIdentity(item) === identity ? trip : item);
  writeHistory(history);
}

export function setPassengerFavorite(trip: SavedPassengerTrip, favorite: boolean) {
  if (!validTrip(trip)) return;
  const history = readHistory();
  history.favorites = favorite
    ? [trip, ...history.favorites.filter((item) => savedTripIdentity(item) !== savedTripIdentity(trip))].slice(0, 12)
    : history.favorites.filter((item) => savedTripIdentity(item) !== savedTripIdentity(trip));
  writeHistory(history);
}

export function isSafeRunKey(runKey: unknown): runKey is string {
  if (typeof runKey !== 'string' || runKey.length > 240) return false;
  const [date, line, origin, destination, runId, ...extra] = runKey.split('|');
  const serviceDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : null;
  return extra.length === 0
    && serviceDate !== null
    && !Number.isNaN(serviceDate.getTime())
    && serviceDate.toISOString().slice(0, 10) === date
    && /^(1|2|3)$/.test(line)
    && /^[1-9]\d{0,3}$/.test(origin)
    && /^[1-9]\d{0,3}$/.test(destination)
    && /^[A-Za-z0-9._:~-]{1,120}$/.test(runId);
}

export function savedTripIdentity(trip: Pick<SavedPassengerTrip, 'runKey' | 'pickupStop' | 'dropoffStop'>) {
  const stop = (value: SavedPassengerStop | undefined) => value
    ? `${value.lat.toFixed(5)}|${value.lng.toFixed(5)}|${value.label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`
    : '';
  return `${trip.runKey}|pickup:${stop(trip.pickupStop)}|dropoff:${stop(trip.dropoffStop)}`;
}

export function savePassengerJourney(runKey: string, journey: PassengerJourney) {
  if (!isSafeRunKey(runKey)) return;
  writeJson(`${JOURNEY_PREFIX}${runKey}`, {
    savedAt: new Date().toISOString(),
    journey,
  });
}

export function readPassengerJourney(runKey: string): (PassengerJourney & { offlineSavedAt: string }) | null {
  if (!isSafeRunKey(runKey)) return null;
  const value = readJson(`${JOURNEY_PREFIX}${runKey}`) as { savedAt?: unknown; journey?: PassengerJourney } | null;
  if (!value?.journey || typeof value.savedAt !== 'string' || value.journey.runKey !== runKey) return null;
  return {
    ...value.journey,
    trafficStatus: 'unavailable',
    trafficUpdatedAt: null,
    offlineSavedAt: value.savedAt,
  };
}

function scheduleKey(line: number, origin: number, destination: number, date: string) {
  return `${SCHEDULE_PREFIX}${date}|${line}|${origin}|${destination}`;
}

export function savePassengerSchedule(line: number, origin: number, destination: number, date: string, schedule: OfficialSchedule) {
  writeJson(scheduleKey(line, origin, destination, date), {
    savedAt: new Date().toISOString(),
    schedule,
  });
}

export function readPassengerSchedule(line: number, origin: number, destination: number, date: string): (OfficialSchedule & { offlineSavedAt: string }) | null {
  const value = readJson(scheduleKey(line, origin, destination, date)) as { savedAt?: unknown; schedule?: OfficialSchedule } | null;
  if (!value?.schedule || typeof value.savedAt !== 'string') return null;
  return { ...value.schedule, offlineSavedAt: value.savedAt };
}

export function clearSavedPassengerTimes() {
  if (!storageAvailable()) return;
  const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index));
  keys.forEach((key) => {
    if (key?.startsWith(JOURNEY_PREFIX) || key?.startsWith(SCHEDULE_PREFIX)) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // A browser blocking storage has nothing usable to clear.
      }
    }
  });
  window.dispatchEvent(new CustomEvent('passenger-saved-times-cleared'));
}
