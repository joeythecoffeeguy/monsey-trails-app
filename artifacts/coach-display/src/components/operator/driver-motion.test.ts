import { describe, expect, it } from 'vitest';
import { getDriverMotionState } from './driver-motion';

describe('getDriverMotionState', () => {
  const now = new Date('2026-09-23T12:00:00.000Z').getTime();

  it('never treats missing or stale speed as stopped', () => {
    expect(getDriverMotionState({ speedMph: null, locationUpdatedAt: null, now })).toBe('unknown');
    expect(getDriverMotionState({
      speedMph: 0,
      locationUpdatedAt: '2026-09-23T11:59:30.000Z',
      now,
    })).toBe('unknown');
  });

  it('requires a fresh low-speed reading before offering stopped confirmation', () => {
    expect(getDriverMotionState({
      speedMph: 0.5,
      locationUpdatedAt: '2026-09-23T11:59:55.000Z',
      now,
    })).toBe('stopped-unconfirmed');
  });

  it('identifies a moving coach from a fresh reading', () => {
    expect(getDriverMotionState({
      speedMph: 18,
      locationUpdatedAt: '2026-09-23T11:59:55.000Z',
      now,
    })).toBe('moving');
  });
});