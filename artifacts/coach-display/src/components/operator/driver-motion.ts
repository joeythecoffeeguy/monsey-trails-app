export type DriverMotionState = 'moving' | 'stopped-unconfirmed' | 'unknown';

const SPEED_FRESHNESS_MS = 15_000;
const MOVING_THRESHOLD_MPH = 3;
const STOPPED_THRESHOLD_MPH = 1;

export function getDriverMotionState({
  speedMph,
  locationUpdatedAt,
  now = Date.now(),
}: {
  speedMph: number | null | undefined;
  locationUpdatedAt: string | null | undefined;
  now?: number;
}): DriverMotionState {
  if (speedMph == null || !Number.isFinite(speedMph) || !locationUpdatedAt) return 'unknown';
  const measuredAt = new Date(locationUpdatedAt).getTime();
  if (!Number.isFinite(measuredAt) || now - measuredAt < 0 || now - measuredAt > SPEED_FRESHNESS_MS) return 'unknown';
  if (speedMph > MOVING_THRESHOLD_MPH) return 'moving';
  if (speedMph <= STOPPED_THRESHOLD_MPH) return 'stopped-unconfirmed';
  return 'unknown';
}
