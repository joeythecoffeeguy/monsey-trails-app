import type { PassengerTripActivityProps } from '@/components/lib/passenger-trip-activity';

type ProgressStop = {
  id: string;
  status: string;
  eta?: string | null;
};

type TripActivityInput = {
  lineName: string;
  coachNumber: string;
  pickupStopId: string;
  pickupLabel: string;
  dropoffStopId: string;
  dropoffLabel: string;
  tripStatus: string;
  locationIsLive: boolean;
  locationUpdatedAt?: string | null;
  progress?: ProgressStop[] | null;
};

const MAX_GPS_AGE_MS = 90_000;

export function passengerTripActivityProps(input: TripActivityInput, now = Date.now()): PassengerTripActivityProps {
  const pickup = input.progress?.find(stop => stop.id === input.pickupStopId);
  const dropoff = input.progress?.find(stop => stop.id === input.dropoffStopId);
  const ended = ['stopped', 'ended', 'completed'].includes(input.tripStatus)
    || dropoff?.status === 'completed';
  const onboard = !ended && pickup?.status === 'completed';
  const target = onboard ? dropoff : pickup;
  const updated = input.locationUpdatedAt ? Date.parse(input.locationUpdatedAt) : NaN;
  const fresh = input.tripStatus === 'running'
    && input.locationIsLive
    && Number.isFinite(updated)
    && updated <= now
    && now - updated <= MAX_GPS_AGE_MS;
  const eta = target?.eta ? Date.parse(target.eta) : NaN;
  const hasEta = fresh && Number.isFinite(eta) && eta >= now - 60_000;
  const minutes = hasEta ? Math.max(0, Math.ceil((eta - now) / 60_000)) : null;

  return {
    phase: ended ? 'ended' : fresh ? (onboard ? 'onboard' : 'pickup') : 'unavailable',
    lineName: input.lineName,
    stopName: onboard ? input.dropoffLabel : input.pickupLabel,
    etaLabel: ended ? 'Trip ended' : minutes === null ? 'Check app' : minutes <= 1 ? 'Arriving' : `${minutes} min`,
    coachNumber: input.coachNumber,
    status: ended
      ? 'Trip complete'
      : input.tripStatus !== 'running'
        ? 'Trip status unavailable'
        : !fresh
          ? 'Location unavailable'
          : onboard
            ? 'To your drop-off'
            : 'To your pickup',
    // Keep the actual GPS timestamp so ActivityKit marks an old snapshot stale.
    updatedAt: fresh ? input.locationUpdatedAt! : Number.isFinite(updated) ? input.locationUpdatedAt! : new Date(0).toISOString(),
  };
}