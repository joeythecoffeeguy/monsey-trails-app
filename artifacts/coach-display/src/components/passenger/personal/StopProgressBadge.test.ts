import { describe, expect, it } from 'vitest';
import { progressBadgeDetails } from './StopProgressBadge';

describe('passenger stop progress badges', () => {
  it('uses green Departed for completed pickups and orange Arrived for completed drop-offs', () => {
    expect(progressBadgeDetails({
      id: 'pickup',
      address: 'Pickup',
      lat: 41,
      lng: -74,
      eta: null,
      status: 'completed',
      kind: 'pickup',
    }, null)).toEqual({ label: 'Departed', tone: 'green', pulse: false });

    expect(progressBadgeDetails({
      id: 'dropoff',
      address: 'Drop-off',
      lat: 41,
      lng: -74,
      eta: null,
      status: 'completed',
      kind: 'dropoff',
    }, null)).toEqual({ label: 'Arrived', tone: 'orange', pulse: false });
  });

  it('shows a pulsing arrival countdown only for a current stop within two miles', () => {
    const now = new Date('2026-09-23T12:00:00.000Z').getTime();
    const progress = {
      id: 'pickup',
      address: 'Pickup',
      lat: 41,
      lng: -74,
      eta: '2026-09-23T12:08:00.000Z',
      status: 'current' as const,
      kind: 'pickup' as const,
    };

    expect(progressBadgeDetails(progress, { lat: 41.02, lng: -74 }, now))
      .toEqual({ label: 'Arriving in 8 min', tone: 'green', pulse: true });
    expect(progressBadgeDetails(progress, { lat: 41.1, lng: -74 }, now)).toBeNull();
  });
});