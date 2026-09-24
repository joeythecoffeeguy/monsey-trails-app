import { describe, expect, it } from 'vitest';
import { adminStopMatchesRole, buildAdminStopUpdate } from './admin-stops';

describe('admin stop category grouping', () => {
  it('shows pickup-only and drop-off-only stops only in their matching route', () => {
    expect(adminStopMatchesRole({ category: 'pickup' }, 'pickup')).toBe(true);
    expect(adminStopMatchesRole({ category: 'pickup' }, 'dropoff')).toBe(false);
    expect(adminStopMatchesRole({ category: 'dropoff' }, 'pickup')).toBe(false);
    expect(adminStopMatchesRole({ category: 'dropoff' }, 'dropoff')).toBe(true);
  });

  it('shows stops categorized as both in both routes', () => {
    expect(adminStopMatchesRole({ category: 'both' }, 'pickup')).toBe(true);
    expect(adminStopMatchesRole({ category: 'both' }, 'dropoff')).toBe(true);
  });

  it('sends a category-only edit without resubmitting coordinates', () => {
    expect(buildAdminStopUpdate({
      address: 'Main Street',
      lat: 41.1,
      lng: -74.1,
      category: 'dropoff',
    }, { category: true })).toEqual({ category: 'dropoff' });
  });
});