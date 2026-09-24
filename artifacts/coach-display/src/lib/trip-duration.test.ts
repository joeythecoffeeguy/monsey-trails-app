import { describe, expect, it } from 'vitest';
import { formatTripDuration } from './trip-duration';

describe('formatTripDuration', () => {
  it.each([
    [0, '0 min'],
    [59, '59 min'],
    [60, '1 hr'],
    [63, '1 hr, 3 min'],
    [100, '1 hr, 40 min'],
    [120, '2 hr'],
    [185, '3 hr, 5 min'],
    [NaN, 'Duration unavailable'],
    [-1, 'Duration unavailable'],
  ])('formats %s minutes as %s', (minutes, expected) => {
    expect(formatTripDuration(minutes)).toBe(expected);
  });
});