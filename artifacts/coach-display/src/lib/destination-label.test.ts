import { describe, expect, it } from 'vitest';
import { formatPassengerDestination } from './destination-label';

describe('formatPassengerDestination', () => {
  it('replaces a Brooklyn street address with its neighborhood when no cross street is provided', () => {
    expect(formatPassengerDestination(
      '1214, 48th Street, Borough Park, Brooklyn, Kings County, City of New York, New York, 11219, United States',
    )).toBe('Boro Park');
  });

  it('keeps a locality-only destination useful', () => {
    expect(formatPassengerDestination('Monsey, Town of Ramapo, Rockland County, New York, United States'))
      .toBe('Monsey');
  });

  it('does not show a full combined house number and street', () => {
    expect(formatPassengerDestination(
      '1214 48th Street, Borough Park, Brooklyn, Kings County, New York, United States',
    )).toBe('Boro Park');
  });

  it('combines both streets in a geocoded intersection', () => {
    expect(formatPassengerDestination(
      '18th Avenue, 49th Street, Borough Park, Brooklyn, Kings County, New York, United States',
    )).toBe('18th Avenue & 49th Street');
  });
});