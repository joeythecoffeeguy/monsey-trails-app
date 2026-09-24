import { describe, expect, it } from 'vitest';
import { MOCK_ROUTES } from './api-interfaces';

describe('operator route choices', () => {
  it('offers Monsey service to Midtown, Boro Park, and Williamsburg in both directions', () => {
    const routeLabels = Object.values(MOCK_ROUTES).map(
      ({ origin, destination }) => `${origin} → ${destination}`,
    );

    expect(routeLabels).toEqual([
      'Monsey → Midtown',
      'Monsey → Boro Park',
      'Monsey → Williamsburg',
      'Midtown → Monsey',
      'Boro Park → Monsey',
      'Williamsburg → Monsey',
    ]);
  });
});