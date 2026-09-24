import { Clock3, MapPinned, Radio, WifiOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { LiveTrip } from '@/providers/live-trip';

export const LIVE_GPS_MAX_AGE_MS = 90_000;

export type LocationConfidence = {
  kind: 'live' | 'schedule' | 'unavailable';
  label: 'Live GPS' | 'Schedule estimate' | 'Location temporarily unavailable';
  ageLabel: string | null;
};

function timestampAge(timestamp: string | null | undefined, now: number) {
  if (!timestamp) return null;
  const updatedAt = new Date(timestamp).getTime();
  const ageMs = now - updatedAt;
  return Number.isFinite(ageMs) && ageMs >= 0 ? ageMs : null;
}

export function formatLocationUpdateAge(ageMs: number) {
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds} sec ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr${hours === 1 ? '' : 's'} ago`;
}

export function getLocationConfidence(
  trip: Pick<LiveTrip, 'status' | 'locationVisibility' | 'currentLocation' | 'locationUpdatedAt'>,
  now = Date.now(),
): LocationConfidence {
  const ageMs = timestampAge(trip.locationUpdatedAt, now);
  const hasPosition = Boolean(
    trip.currentLocation
    && Number.isFinite(trip.currentLocation.lat)
    && Number.isFinite(trip.currentLocation.lng),
  );
  const hasFreshVisibleGps = trip.status === 'running'
    && trip.locationVisibility === 'live'
    && hasPosition
    && ageMs !== null
    && ageMs <= LIVE_GPS_MAX_AGE_MS;

  if (hasFreshVisibleGps) {
    return {
      kind: 'live',
      label: 'Live GPS',
      ageLabel: `Updated ${formatLocationUpdateAge(ageMs)}`,
    };
  }

  if (trip.locationVisibility === 'before_departure' || trip.status === 'ready') {
    return { kind: 'schedule', label: 'Schedule estimate', ageLabel: null };
  }

  return {
    kind: 'unavailable',
    label: 'Location temporarily unavailable',
    ageLabel: ageMs === null ? null : `Last GPS update ${formatLocationUpdateAge(ageMs)}`,
  };
}

export function LocationConfidenceIndicator({
  trip,
  now,
  tone = 'light',
  className = '',
}: {
  trip: Pick<LiveTrip, 'status' | 'locationVisibility' | 'currentLocation' | 'locationUpdatedAt'>;
  now?: number;
  tone?: 'light' | 'dark';
  className?: string;
}) {
  const [clock, setClock] = useState(() => now ?? Date.now());

  useEffect(() => {
    if (now !== undefined) {
      setClock(now);
      return;
    }
    const timer = window.setInterval(() => setClock(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [now]);

  const confidence = useMemo(() => getLocationConfidence(trip, clock), [clock, trip]);
  const Icon = confidence.kind === 'live' ? Radio : confidence.kind === 'schedule' ? MapPinned : WifiOff;
  const color = confidence.kind === 'live'
    ? tone === 'dark' ? 'text-green-300' : 'text-green-700'
    : confidence.kind === 'schedule'
      ? tone === 'dark' ? 'text-primary' : 'text-secondary'
      : tone === 'dark' ? 'text-amber-300' : 'text-amber-800';

  return (
    <div
      className={`inline-flex min-w-0 items-center gap-2 rounded-full border border-current/20 bg-background/25 px-3 py-1.5 ${color} ${className}`}
      aria-label={[confidence.label, confidence.ageLabel].filter(Boolean).join('. ')}
      aria-live="polite"
      data-location-confidence={confidence.kind}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="whitespace-nowrap text-xs font-black">{confidence.label}</span>
      {confidence.ageLabel && (
        <>
          <span aria-hidden="true" className="opacity-40">•</span>
          <span className="flex min-w-0 items-center gap-1 whitespace-nowrap text-xs font-semibold opacity-80">
            <Clock3 className="h-3 w-3 shrink-0" />
            {confidence.ageLabel}
          </span>
        </>
      )}
    </div>
  );
}