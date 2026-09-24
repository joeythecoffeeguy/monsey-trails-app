import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PassengerDisplay from './passenger';
import OperatorPanel from './operator';
import { useSettingsStore } from '@/lib/store';

const { arriveAtNextDestination, liveTrip, playArrivalChime } = vi.hoisted(() => ({
  arriveAtNextDestination: vi.fn(),
  liveTrip: {
    status: 'running' as 'running' | 'stopped',
    emergencyOverride: false,
    emergencyMessage: '',
    routeId: 'route-1',
    routeGeometry: [] as Array<{ lat: number; lng: number }>,
    displayMode: 'auto',
    passengerLanguage: 'en',
    rotationIntervalSeconds: 5,
    arrivalSoundsEnabled: true,
    chimeTestRequestedAt: null,
    startedAt: '2026-09-16T12:00:00.000Z',
    intermediateStops: [] as Array<{ id: string; address: string; lat: number; lng: number; eta: string | null }>,
    destination: { lat: 40.73, lng: -74.006 },
    destinationAddress: 'Final Avenue & Terminal Road',
    currentLocation: { lat: 40.70, lng: -74.006 },
    origin: { lat: 40.70, lng: -74.006 },
    totalDistanceMiles: 3,
    remainingDistanceMiles: 3 as number | null,
    speedMph: 20 as number | null,
    eta: null as string | null,
    passengerDisplays: [],
    updatedAt: '2026-09-16T12:00:00.000Z',
  },
  playArrivalChime: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@/providers/driver-profile', () => ({
  useDriverProfileQuery: vi.fn(() => ({ data: { username: 'test_driver' }, refetch: vi.fn() })),
  useUpdateDriverProfile: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock('@clerk/react', async () => {
  const actual = await vi.importActual('@clerk/react');
  return {
    ...actual,
    useAuth: vi.fn(() => ({ isLoaded: true, userId: 'user_operator' })),
    useUser: vi.fn(() => ({ user: { id: 'user_operator', username: 'operator1' } })),
    useClerk: vi.fn(() => ({ signOut: vi.fn() })),
    ClerkProvider: ({ children }: any) => <>{children}</>,
  };
});

vi.mock('@workspace/api-client-react', async () => {
  const actual = await vi.importActual('@workspace/api-client-react');
  return {
    ...actual,
    useGetAdminAccess: vi.fn(() => ({ data: { authorized: false }, isLoading: false, isError: false })),
  };
});

vi.mock('@/providers/live-trip', () => ({
  arriveAtNextDestination,
  configureTripRoute: vi.fn(),
  connectOperatorToBus: vi.fn(),
  exitDevelopmentDisplayPreview: vi.fn(),
  getDisplayBusNumber: () => '9923',
  getOperatorBusNumber: () => '9923',
  getOperatorPairingCode: () => '4821',
  logoutOperator: vi.fn(),
  pairDisplayWithBus: vi.fn(),
  publishTripLocation: vi.fn(() => Promise.resolve()),
  reportPassengerAudioStatus: vi.fn(() => Promise.resolve()),
  resolveDestination: vi.fn(),
  startLiveTrip: vi.fn(),
  stopLiveTrip: vi.fn(),
  suggestDestinations: vi.fn(() => Promise.resolve([])),
  testPassengerChime: vi.fn(),
  updateEmergencySettings: vi.fn(),
  updateTripDisplaySettings: vi.fn(() => Promise.resolve()),
  useLiveTrip: () => liveTrip,
  useLiveTripRefreshStatus: () => ({ isRefreshing: false, lastSuccessfulRefreshAt: Date.now(), lastRefreshFailed: false }),
  LIVE_TRIP_REFRESH_INTERVAL_MS: 3000,
}));

vi.mock('@/lib/arrival-chime', () => ({
  playArrivalChime,
  unlockArrivalChimes: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@/components/passenger/Header', () => ({
  Header: ({ activeMode }: { activeMode: string }) => <div data-testid="active-mode">{activeMode}</div>,
}));
vi.mock('@/components/passenger/Footer', () => ({ Footer: () => <div>Footer</div> }));
vi.mock('@/components/passenger/EmergencyOverlay', () => ({ EmergencyOverlay: () => null }));
vi.mock('@/components/passenger/views/WelcomeView', () => ({ WelcomeView: () => <div>Welcome</div> }));
vi.mock('@/components/passenger/views/MapProgressView', () => ({
  MapProgressView: () => <div>Map</div>,
  focusRouteGeometry: (geo: any) => geo,
}));
vi.mock('@/components/passenger/views/WeatherView', () => ({ WeatherView: () => <div>Weather</div> }));
vi.mock('@/components/passenger/views/TrafficView', () => ({ TrafficView: () => <div>Traffic</div> }));
vi.mock('@/components/passenger/views/DailyDafView', () => ({ DailyDafView: () => <div>Daf</div> }));
vi.mock('@/components/passenger/views/JewishCalendarView', () => ({ JewishCalendarView: () => <div>Calendar</div> }));
vi.mock('@/components/passenger/views/AnnouncementsView', () => ({ AnnouncementsView: () => <div>Announcements</div> }));
vi.mock('@/components/passenger/views/SafetyBriefingView', () => ({ SafetyBriefingView: () => <div>Safety</div> }));

vi.mock('@/hooks/use-media-query', () => ({
  useMediaQuery: () => true, // force mounted view
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function renderWithProviders(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const res = render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
  return { ...res, rerender: (newUi: React.ReactNode) => res.rerender(<QueryClientProvider client={queryClient}>{newUi}</QueryClientProvider>) };
}

function SimulatedJourney() {
  return (
    <>
      <OperatorPanel />
      <PassengerDisplay />
    </>
  );
}

describe('simulated GPS stop journey', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(liveTrip, {
      status: 'running',
      intermediateStops: [
        { id: 'first', address: 'First Street & Oak Avenue', lat: 40.71, lng: -74.006, eta: null },
        { id: 'second', address: 'Second Street & Pine Avenue', lat: 40.72, lng: -74.006, eta: null },
      ],
      destination: { lat: 40.73, lng: -74.006 },
      currentLocation: { lat: 40.70, lng: -74.006 },
      speedMph: 20,
      eta: null,
      startedAt: '2026-09-16T12:00:00.000Z',
    });
    playArrivalChime.mockClear();
    arriveAtNextDestination.mockReset();
    arriveAtNextDestination.mockImplementation(async (
      expectedStopIdentity: string,
      expectedStartedAt: string,
    ) => {
      const arrivedStop = liveTrip.intermediateStops[0];
      const currentStopIdentity = arrivedStop?.id
        ?? `${liveTrip.destination.lat}:${liveTrip.destination.lng}`;
      if (
        expectedStopIdentity !== currentStopIdentity
        || expectedStartedAt !== liveTrip.startedAt
      ) {
        throw new Error('This stop was already advanced by another operator screen.');
      }
      if (arrivedStop) {
        liveTrip.intermediateStops = liveTrip.intermediateStops.slice(1);
        liveTrip.eta = null;
        return {
          trip: { ...liveTrip },
          arrivedAt: arrivedStop.address,
          nextDestination: liveTrip.intermediateStops[0]?.address ?? liveTrip.destinationAddress,
          tripComplete: false,
        };
      }
      liveTrip.status = 'stopped';
      liveTrip.speedMph = 0;
      return {
        trip: { ...liveTrip },
        arrivedAt: liveTrip.destinationAddress,
        nextDestination: null,
        tripComplete: true,
      };
    });
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn(),
        watchPosition: vi.fn(() => 1),
        clearWatch: vi.fn(),
      },
    });
    useSettingsStore.setState({ displayMode: 'auto', rotationIntervalSeconds: 5, announcements: [] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rotates, announces each approach and arrival, advances after dwell, and completes at the destination', async () => {
    const view = renderWithProviders(<SimulatedJourney />);
    expect(screen.getByTestId('active-mode').textContent).toBe('welcome');

    liveTrip.currentLocation = { lat: 40.704, lng: -74.006 };
    view.rerender(<SimulatedJourney />);
    expect(screen.getByTestId('active-mode').textContent).toBe('next-stop');
    expect(playArrivalChime).toHaveBeenLastCalledWith('approaching');

    liveTrip.currentLocation = { lat: 40.7095, lng: -74.006 };
    liveTrip.speedMph = 2;
    view.rerender(<SimulatedJourney />);
    expect(playArrivalChime).toHaveBeenLastCalledWith('arriving');
    await act(async () => vi.advanceTimersByTime(15_000));
    expect(liveTrip.intermediateStops[0].id).toBe('first');

    liveTrip.currentLocation = { lat: 40.71, lng: -74.006 };
    view.rerender(<SimulatedJourney />);
    await act(async () => vi.advanceTimersByTime(15_000));
    view.rerender(<SimulatedJourney />);
    expect(liveTrip.intermediateStops[0].id).toBe('second');
    expect(screen.getByTestId('active-mode').textContent).not.toBe('next-stop');

    liveTrip.currentLocation = { lat: 40.714, lng: -74.006 };
    liveTrip.speedMph = 20;
    view.rerender(<SimulatedJourney />);
    expect(screen.getByTestId('active-mode').textContent).toBe('next-stop');
    expect(playArrivalChime).toHaveBeenLastCalledWith('approaching');

    liveTrip.currentLocation = { lat: 40.7195, lng: -74.006 };
    liveTrip.speedMph = 2;
    view.rerender(<SimulatedJourney />);
    expect(playArrivalChime).toHaveBeenLastCalledWith('arriving');

    liveTrip.currentLocation = { lat: 40.72, lng: -74.006 };
    view.rerender(<SimulatedJourney />);
    await act(async () => vi.advanceTimersByTime(15_000));
    view.rerender(<SimulatedJourney />);
    expect(liveTrip.intermediateStops).toHaveLength(0);
    expect(screen.getByTestId('active-mode').textContent).not.toBe('next-stop');

    liveTrip.currentLocation = { lat: 40.724, lng: -74.006 };
    liveTrip.speedMph = 20;
    view.rerender(<SimulatedJourney />);
    expect(screen.getByTestId('active-mode').textContent).toBe('next-stop');
    expect(playArrivalChime).toHaveBeenLastCalledWith('approaching');

    liveTrip.currentLocation = { lat: 40.7295, lng: -74.006 };
    liveTrip.speedMph = 2;
    view.rerender(<SimulatedJourney />);
    expect(playArrivalChime).toHaveBeenLastCalledWith('arriving');

    liveTrip.currentLocation = { lat: 40.73, lng: -74.006 };
    view.rerender(<SimulatedJourney />);
    await act(async () => vi.advanceTimersByTime(15_000));
    view.rerender(<SimulatedJourney />);
    expect(liveTrip.status).toBe('stopped');
    expect(screen.getByTestId('active-mode').textContent).toBe('welcome');
  }, 20_000);

  it('does not skip the following stop when two operator screens finish the same dwell', async () => {
    liveTrip.currentLocation = { lat: 40.71, lng: -74.006 };
    liveTrip.speedMph = 2;
    renderWithProviders(
      <>
        <OperatorPanel />
        <OperatorPanel />
      </>,
    );

    await act(async () => vi.advanceTimersByTime(15_000));

    expect(arriveAtNextDestination).toHaveBeenCalledTimes(2);
    expect(arriveAtNextDestination).toHaveBeenNthCalledWith(
      1,
      'first',
      '2026-09-16T12:00:00.000Z',
    );
    expect(arriveAtNextDestination).toHaveBeenNthCalledWith(
      2,
      'first',
      '2026-09-16T12:00:00.000Z',
    );
    expect(liveTrip.intermediateStops.map((stop) => stop.id)).toEqual(['second']);
  }, 20_000);
});