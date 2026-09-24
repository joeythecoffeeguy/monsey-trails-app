import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Footer } from './Footer';

const state = vi.hoisted(() => ({
  status: 'ready' as 'ready' | 'running',
  locationUpdatedAt: undefined as string | undefined,
  trafficState: 'live' as 'live' | 'stale',
}));

vi.mock('@/lib/store', () => ({
  useSettingsStore: (selector: (value: { routeId: string }) => unknown) => selector({ routeId: 'route-1' }),
}));

vi.mock('@/providers/live-trip', () => ({
  useLiveTrip: () => ({
    status: state.status,
    passengerLanguage: 'en',
    destinationAddress: 'Albany, New York',
    totalDistanceMiles: state.status === 'running' ? 20 : null,
    remainingDistanceMiles: state.status === 'running' ? 10 : null,
    locationVisibility: state.status === 'running' ? 'live' : 'before_departure',
    currentLocation: state.status === 'running' ? { lat: 41.1112, lng: -74.0685 } : null,
    locationUpdatedAt: state.locationUpdatedAt,
  }),
}));

vi.mock('@/providers/api-interfaces', () => ({
  useGPSData: () => ({
    connectivity: 'strong',
    locationStatus: 'live',
    route: {
      origin: 'Monsey',
      stops: [{
        id: 'mock-stop',
        name: 'Midtown',
        eta: new Date('2026-09-16T14:30:00Z'),
        status: 'on-time',
      }],
    },
  }),
  useTrafficData: () => ({
    state: state.status === 'running' ? state.trafficState : 'stale',
    arrivalTime: state.status === 'running' && state.trafficState === 'live'
      ? new Date('2026-09-16T14:37:00Z')
      : null,
  }),
}));

describe('Footer trip state', () => {
  beforeEach(() => {
    state.status = 'ready';
    state.locationUpdatedAt = undefined;
    state.trafficState = 'live';
  });

  afterEach(cleanup);

  it('shows the configured destination without a mock ETA before departure', () => {
    render(<Footer />);

    expect(screen.getAllByText('Albany').length).toBeGreaterThan(0);
    expect(screen.queryByText('Midtown')).toBeNull();
    expect(screen.queryByText('ETA')).toBeNull();
    expect(screen.getByText('Awaiting departure')).toBeTruthy();
    expect(screen.getByText('Schedule estimate')).toBeTruthy();
  });

  it('shows the live next stop and ETA while the trip is running', () => {
    state.status = 'running';
    state.locationUpdatedAt = new Date().toISOString();
    render(<Footer />);

    expect(screen.getByText('Midtown')).toBeTruthy();
    expect(screen.getByText('ETA')).toBeTruthy();
    expect(screen.getByTestId('text-footer-eta').textContent).toMatch(/10:37 AM|2:37 PM/);
    expect(screen.getByText('Monsey')).toBeTruthy();
    expect(screen.getByText('Live GPS')).toBeTruthy();
    expect(screen.getByText('Updated just now')).toBeTruthy();
  });

  it('does not present the stored non-traffic ETA when live traffic is unavailable', () => {
    state.status = 'running';
    state.trafficState = 'stale';
    render(<Footer />);

    expect(screen.getByTestId('text-footer-eta').textContent).toBe('Updating traffic…');
    expect(screen.queryByText(/10:30 AM|2:30 PM/)).toBeNull();
  });
});