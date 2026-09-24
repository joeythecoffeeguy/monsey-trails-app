import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusRouteGeometry, MapProgressView } from './MapProgressView';

const routeGeometry = [
  { lat: 41.1112, lng: -74.0685 },
  { lat: 40.95, lng: -74.03 },
  { lat: 40.7549, lng: -73.984 },
];

vi.mock('@/lib/store', () => ({
  useSettingsStore: (selector: (value: { routeId: string }) => unknown) =>
    selector({ routeId: 'route-1' }),
}));

vi.mock('@/providers/api-interfaces', () => ({
  useTrafficData: () => ({
    state: 'live',
    travelTimeMinutes: 24,
  }),
  useGPSData: () => ({
    route: {
      destination: 'Midtown',
      stops: [
          {
            id: 'origin',
            name: 'Boro Park',
            location: routeGeometry[0],
            eta: new Date(Date.now() - 30 * 60_000),
            scheduledArrival: new Date(Date.now() - 30 * 60_000),
            status: 'departed',
            isDestination: false,
          },
          {
            id: 'intermediate',
            name: 'New Square',
            location: routeGeometry[1],
            eta: new Date(Date.now() + 15 * 60_000),
            scheduledArrival: new Date(Date.now() + 15 * 60_000),
            status: 'on-time',
            isDestination: false,
          },
        {
          id: 'midtown',
          name: 'Midtown',
          location: routeGeometry[2],
          eta: new Date(Date.now() + 30 * 60_000),
          scheduledArrival: new Date(Date.now() + 30 * 60_000),
          status: 'on-time',
          isDestination: true,
        },
      ],
    },
  }),
}));

vi.mock('@/providers/live-trip', () => ({
  useLiveTrip: () => ({
    passengerLanguage: 'en',
    locationVisibility: 'live',
    scheduledDepartureAt: '2026-09-16T15:00:00.000Z',
    currentLocation: routeGeometry[0],
    origin: routeGeometry[0],
    routeGeometry,
    remainingDistanceMiles: 28.4,
  }),
}));

vi.mock('./LiveCoachMap', () => ({
  LiveCoachMap: ({ coach, route, nextStop, stops }: {
    coach: { lat: number; lng: number } | null;
    route: Array<{ lat: number; lng: number }>;
    nextStop: { lat: number; lng: number } | null;
    stops: Array<{ location: { lat: number; lng: number } }>;
  }) => (
    <div
      role="img"
      aria-label="Live coach route map"
      data-coach={coach ? `${coach.lat},${coach.lng}` : ''}
      data-route-points={route.length}
      data-next-stop={nextStop ? `${nextStop.lat},${nextStop.lng}` : ''}
      data-stop-coordinates={stops.map(({ location }) => `${location.lat},${location.lng}`).join('|')}
    />
  ),
}));

afterEach(cleanup);

describe('MapProgressView live map', () => {
  it('limits a long route to a coach-focused window', () => {
    const focused = focusRouteGeometry(routeGeometry, routeGeometry[0], routeGeometry[2], 5);

    expect(focused[0]).toEqual(routeGeometry[0]);
    expect(focused.length).toBeLessThan(routeGeometry.length);
  });

  it('passes the live coach, focused route, and next stop to MapLibre', () => {
    render(<MapProgressView />);
    const map = screen.getByRole('img', { name: 'Live coach route map' });

    expect(map.getAttribute('data-coach')).toBe('41.1112,-74.0685');
    expect(Number(map.getAttribute('data-route-points'))).toBeGreaterThan(1);
    expect(map.getAttribute('data-next-stop')).toBe('');
    expect(map.getAttribute('data-stop-coordinates')).toBe(
      '41.1112,-74.0685|40.95,-74.03|40.7549,-73.984',
    );
  });

  it('renders every scheduled stop in order with its own ETA', () => {
    render(<MapProgressView />);

    expect(screen.getByTestId('sequence-item-origin').textContent).toContain('Boro Park');
    expect(screen.getByTestId('sequence-item-intermediate').textContent).toContain('New Square');
    expect(screen.getByTestId('sequence-item-midtown').textContent).toContain('Midtown');

    const rows = ['origin', 'intermediate', 'midtown'].map((id) => screen.getByTestId(`sequence-item-${id}`));
    const etaText = rows.map((row) => row.textContent ?? '');
    expect(new Set(etaText).size).toBe(3);
    expect(screen.getByTestId('sequence-item-midtown').textContent?.toLowerCase()).toContain('final destination');
  });
});