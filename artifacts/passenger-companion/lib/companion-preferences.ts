import type { OfficialSchedule, OfficialScheduleRun } from '@workspace/api-client-react';
import { PUBLIC_PASSENGER_APP_URL } from '@workspace/passenger-stop-label';

export type PassengerLanguage = 'en' | 'yi' | 'he';

export type RouteChoice = {
  line: number;
  origin: number;
  destination: number;
  label: string;
  pickup?: StopChoice | null;
  dropoff?: StopChoice | null;
};

export type StopChoice = {
  id: string;
  label: string;
  kind: 'pickup' | 'dropoff';
  lat: number;
  lng: number;
};

export type SavedSchedule = {
  key: string;
  savedAt: string;
  schedule: OfficialSchedule;
};

export const companionStorageKeys = {
  language: 'passenger.language',
  largeText: 'passenger.largeText',
  reduceMotion: 'passenger.reduceMotion',
  favorites: 'passenger.favorites',
  recents: 'passenger.recents',
  scheduleCache: 'passenger.scheduleCache.v1',
} as const;

export function routeChoiceKey(choice: Pick<RouteChoice, 'line' | 'origin' | 'destination'>) {
  const exact = choice as Pick<RouteChoice, 'line' | 'origin' | 'destination' | 'pickup' | 'dropoff'>;
  return `${choice.line}|${choice.origin}|${choice.destination}|${exact.pickup?.id ?? ''}|${exact.dropoff?.id ?? ''}`;
}

export function scheduleCacheKey(params: { line: number; origin: number; destination: number; date: string }) {
  return `${routeChoiceKey(params)}|${params.date}`;
}

export function prependUniqueChoice(items: RouteChoice[], choice: RouteChoice, limit = 6) {
  const key = routeChoiceKey(choice);
  return [choice, ...items.filter(item => routeChoiceKey(item) !== key)].slice(0, limit);
}

export function toggleFavorite(items: RouteChoice[], choice: RouteChoice) {
  const key = routeChoiceKey(choice);
  return items.some(item => routeChoiceKey(item) === key)
    ? items.filter(item => routeChoiceKey(item) !== key)
    : [choice, ...items];
}

export function encodeRunLink(selection: {
  date: string;
  line: number;
  origin: number;
  destination: number;
  runId: string;
  scheduledTime?: string | null;
  pickup?: StopChoice | null;
  dropoff?: StopChoice | null;
}, baseUrl = PUBLIC_PASSENGER_APP_URL) {
  const query = new URLSearchParams({
    date: selection.date,
    line: String(selection.line),
    origin: String(selection.origin),
    destination: String(selection.destination),
    run: selection.runId,
  });
  if (selection.scheduledTime) query.set('departure', selection.scheduledTime);
  if (selection.pickup) {
    query.set('pickup', selection.pickup.id);
    query.set('pickupLabel', selection.pickup.label);
    query.set('pickupLat', String(selection.pickup.lat));
    query.set('pickupLng', String(selection.pickup.lng));
  }
  if (selection.dropoff) {
    query.set('dropoff', selection.dropoff.id);
    query.set('dropoffLabel', selection.dropoff.label);
    query.set('dropoffLat', String(selection.dropoff.lat));
    query.set('dropoffLng', String(selection.dropoff.lng));
  }
  return `${baseUrl}?${query.toString()}`;
}

export function decodeRunLink(url: string) {
  try {
    const parsed = new URL(url);
    const date = parsed.searchParams.get('date');
    const encodedRun = parsed.searchParams.get('run');
    const line = Number(parsed.searchParams.get('line'));
    const origin = Number(parsed.searchParams.get('origin'));
    const destination = Number(parsed.searchParams.get('destination'));
    if (!date || !encodedRun || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || ![line, origin, destination].every(Number.isInteger)) return null;
    const runParts = encodedRun.split('|');
    const runId = runParts.length === 5 ? runParts[4] : encodedRun;
    if (runParts.length === 5 && (
      runParts[0] !== date || Number(runParts[1]) !== line
      || Number(runParts[2]) !== origin || Number(runParts[3]) !== destination
    )) return null;
    if (!/^[A-Za-z0-9._:~-]{1,120}$/.test(runId)) return null;
    const pickupId = parsed.searchParams.get('pickup');
    const dropoffId = parsed.searchParams.get('dropoff');
    const pickupLat = Number(parsed.searchParams.get('pickupLat'));
    const pickupLng = Number(parsed.searchParams.get('pickupLng'));
    const dropoffLat = Number(parsed.searchParams.get('dropoffLat'));
    const dropoffLng = Number(parsed.searchParams.get('dropoffLng'));
    const pickup = pickupId && validCoordinates(pickupLat, pickupLng)
      ? { id: pickupId, label: parsed.searchParams.get('pickupLabel') || pickupId, kind: 'pickup' as const, lat: pickupLat, lng: pickupLng }
      : null;
    const dropoff = dropoffId && validCoordinates(dropoffLat, dropoffLng)
      ? { id: dropoffId, label: parsed.searchParams.get('dropoffLabel') || dropoffId, kind: 'dropoff' as const, lat: dropoffLat, lng: dropoffLng }
      : null;
    return {
      date, runId, line, origin, destination,
      pickup,
      dropoff,
    };
  } catch {
    return null;
  }
}

function validCoordinates(lat: number, lng: number) {
  return Number.isFinite(lat) && Math.abs(lat) <= 90
    && Number.isFinite(lng) && Math.abs(lng) <= 180;
}

export function runTimingLabel(run: OfficialScheduleRun) {
  switch (run.departureStatus) {
    case 'delayed':
      return run.delayMinutes && run.delayMinutes > 0
        ? `Estimated · ${run.delayMinutes} min late`
        : 'Estimated · delayed';
    case 'on_time':
      return 'Live estimate · on time';
    case 'live_estimate':
      return 'Live estimate · no published arrival';
    case 'unavailable':
      return 'Scheduled time · live estimate unavailable';
    case 'completed':
      return 'Completed';
    default:
      return 'Scheduled departure';
  }
}

export function invalidateOfflineScheduleStatuses(schedule: OfficialSchedule): OfficialSchedule {
  return {
    ...schedule,
    runs: schedule.runs.map(run => ({
      ...run,
      departureStatus: 'unavailable' as const,
      delayMinutes: null,
    })),
  };
}

export function followingDayLabel(serviceDate: string, isoOrTime: string | null | undefined) {
  if (!isoOrTime) return '';
  if (/^(2[4-9]|[3-9]\d):/.test(isoOrTime)) return ' · next calendar day';
  if (!isoOrTime.includes('T')) return '';
  const service = new Date(`${serviceDate}T12:00:00`);
  const instant = new Date(isoOrTime);
  if (!Number.isFinite(service.getTime()) || !Number.isFinite(instant.getTime())) return '';
  return instant.getDate() !== service.getDate() ? ' · next calendar day' : '';
}