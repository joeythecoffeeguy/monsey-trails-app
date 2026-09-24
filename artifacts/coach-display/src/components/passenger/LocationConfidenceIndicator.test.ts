import { describe, expect, it } from 'vitest';
import { formatLocationUpdateAge, getLocationConfidence } from './LocationConfidenceIndicator';

const now = new Date('2026-09-23T12:00:00.000Z').getTime();

function trip(overrides: Record<string, unknown> = {}) {
  return {
    status: 'running',
    locationVisibility: 'live',
    currentLocation: { lat: 41.1112, lng: -74.0685 },
    locationUpdatedAt: '2026-09-23T11:59:35.000Z',
    ...overrides,
  } as Parameters<typeof getLocationConfidence>[0];
}

describe('passenger location confidence', () => {
  it('labels a recent privacy-visible position as live GPS with its age', () => {
    expect(getLocationConfidence(trip(), now)).toEqual({
      kind: 'live',
      label: 'Live GPS',
      ageLabel: 'Updated 25 sec ago',
    });
  });

  it('labels the pre-departure route as a schedule estimate without exposing GPS age', () => {
    expect(getLocationConfidence(trip({
      status: 'ready',
      locationVisibility: 'before_departure',
      currentLocation: null,
    }), now)).toEqual({
      kind: 'schedule',
      label: 'Schedule estimate',
      ageLabel: null,
    });
  });

  it('does not call a stale or privacy-hidden position live', () => {
    expect(getLocationConfidence(trip({
      locationUpdatedAt: '2026-09-23T11:57:00.000Z',
    }), now)).toEqual({
      kind: 'unavailable',
      label: 'Location temporarily unavailable',
      ageLabel: 'Last GPS update 3 min ago',
    });
    expect(getLocationConfidence(trip({
      locationVisibility: 'unavailable',
      currentLocation: null,
    }), now).kind).toBe('unavailable');
  });

  it('formats updating ages without false precision', () => {
    expect(formatLocationUpdateAge(4_000)).toBe('just now');
    expect(formatLocationUpdateAge(61_000)).toBe('1 min ago');
    expect(formatLocationUpdateAge(7_200_000)).toBe('2 hrs ago');
  });
});