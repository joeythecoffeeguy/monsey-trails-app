import { describe, expect, it } from 'vitest';
import { getOfficialRouteTemplate } from './official-schedules';

const run = (routeSymbol: string) => ({ routeSymbol, routeCode: routeSymbol, secondarySymbol: '' });

describe('official route templates', () => {
  it('orders Manhattan pickups before official Monsey return dropoffs', () => {
    const template = getOfficialRouteTemplate(5, 2, run('1P'));
    expect(template?.points[0].name).toBe('5th Avenue & 42nd Street');
    expect(template?.points.at(-1)?.name).toBe('New Square');
    expect(template?.points.every((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))).toBe(true);
  });

  it('uses the direction-specific route 8 dropoff order', () => {
    const template = getOfficialRouteTemplate(3, 2, run('8'));
    const names = template?.points.map((point) => point.name) ?? [];
    expect(names.indexOf('Maple Avenue & Route 45')).toBeLessThan(names.indexOf('Route 59 & Augusta Avenue'));
    expect(names.at(-1)).toBe('New Square');
  });

  it.each([1, 3, 4, 5, 6])('has verified non-Monsey pickup coordinates for service area %s', (originId) => {
    const template = getOfficialRouteTemplate(originId, 5, run('1'));
    expect(template?.points.length).toBeGreaterThan(0);
    expect(template?.points.every((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))).toBe(true);
  });
});