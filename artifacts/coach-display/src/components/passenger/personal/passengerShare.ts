import type { PassengerScheduleFilters } from './PersonalUnpairedView';
import { isSafeRunKey } from './passengerWebStorage';
import type { SavedPassengerStop } from './passengerWebStorage';
import { publicPassengerUrl } from '@workspace/passenger-stop-label';

export interface PassengerShareSelection {
  filters: PassengerScheduleFilters;
  runKey: string;
  departureTime: string;
  view: 'trip' | 'live';
  pickupStop?: SavedPassengerStop;
  dropoffStop?: SavedPassengerStop;
}

export function parsePassengerShare(search: string): PassengerShareSelection | null {
  const params = new URLSearchParams(search);
  const encodedRun = params.get('run');
  const departureTime = params.get('departure');
  const dateParam = params.get('date');
  const lineParam = params.get('line');
  const originParam = params.get('origin');
  const destinationParam = params.get('destination');
  const runKey = encodedRun?.includes('|')
    ? encodedRun
    : `${dateParam}|${lineParam}|${originParam}|${destinationParam}|${encodedRun}`;
  if (!isSafeRunKey(runKey) || !departureTime || !/^(?:[01]?\d|2[0-9]):[0-5]\d(?::[0-5]\d)?$/.test(departureTime)) return null;
  const [date, line, origin, destination] = runKey.split('|');
  if (
    params.get('date') !== date
    || params.get('line') !== line
    || params.get('origin') !== origin
    || params.get('destination') !== destination
  ) return null;
  const pickupStop = parseStop(params, 'pickup');
  const dropoffStop = parseStop(params, 'dropoff');
  return {
    filters: { date, line: Number(line), origin: Number(origin), destination: Number(destination) },
    runKey,
    departureTime,
    view: params.get('view') === 'live' ? 'live' : 'trip',
    ...(pickupStop ? { pickupStop } : {}),
    ...(dropoffStop ? { dropoffStop } : {}),
  };
}

export function passengerShareUrl(selection: PassengerShareSelection) {
  const params = new URLSearchParams({
    date: selection.filters.date,
    line: String(selection.filters.line),
    origin: String(selection.filters.origin),
    destination: String(selection.filters.destination),
    run: selection.runKey,
    departure: selection.departureTime,
  });
  if (selection.view === 'live') params.set('view', 'live');
  appendStop(params, 'pickup', selection.pickupStop);
  appendStop(params, 'dropoff', selection.dropoffStop);
  return publicPassengerUrl(params);
}

function appendStop(params: URLSearchParams, prefix: 'pickup' | 'dropoff', stop?: SavedPassengerStop) {
  if (!stop) return;
  params.set(prefix, stop.id);
  params.set(`${prefix}Label`, stop.label);
  params.set(`${prefix}Lat`, String(stop.lat));
  params.set(`${prefix}Lng`, String(stop.lng));
}

function parseStop(params: URLSearchParams, prefix: 'pickup' | 'dropoff'): SavedPassengerStop | null {
  const id = params.get(prefix);
  const label = params.get(`${prefix}Label`);
  const lat = Number(params.get(`${prefix}Lat`));
  const lng = Number(params.get(`${prefix}Lng`));
  if (!id || !label || !Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) return null;
  return { id, label, lat, lng };
}

export async function sharePassengerTrip(url: string, title: string) {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return 'shared' as const;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled' as const;
      throw error;
    }
  }
  if (!navigator.clipboard?.writeText) throw new Error('Sharing and clipboard access are unavailable in this browser.');
  await navigator.clipboard.writeText(url);
  return 'copied' as const;
}
