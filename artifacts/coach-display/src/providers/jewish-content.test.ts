import { describe, expect, it } from 'vitest';
import { occursOnDate } from './jewish-content';

describe('Jewish calendar event dates', () => {
  it('shows an observance only on its actual local calendar date', () => {
    expect(occursOnDate('2026-09-18T18:43:00-04:00', '2026-09-18')).toBe(true);
    expect(occursOnDate('2026-09-18T18:43:00-04:00', '2026-09-16')).toBe(false);
  });
});