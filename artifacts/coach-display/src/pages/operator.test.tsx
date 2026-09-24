import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OperatorPanel from './operator';

const { arriveAtNextDestination, assignmentQueryState, clearOperatorSession, clearTripRoute, configureTripRoute, connectOperatorToBus, liveTripState, logoutPairedScreens, publishTripLocation, signOut, startLiveTrip, suggestDestinations, updateTripAnnouncements, updateTripDisplaySettings } = vi.hoisted(() => ({
  assignmentQueryState: {
    data: [] as Array<Record<string, unknown>>,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  },
  liveTripState: {
    status: 'en_route',
    destinationAddress: 'Test Destination',
    destination: { lat: 0, lng: 0 },
    intermediateStops: [],
    routeGeometry: [],
    origin: null,
    currentLocation: null,
    totalDistanceMiles: null,
    remainingDistanceMiles: null,
    eta: null,
    speedMph: null,
    startedAt: null,
    emergencyOverride: false,
    emergencyMessage: 'Please remain seated.',
    routeId: 'route-1',
    displayMode: 'auto',
    passengerLanguage: 'en',
    rotationIntervalSeconds: 15,
    arrivalSoundsEnabled: true,
    announcements: [] as Array<{ id: string; title: string; message: string; active: boolean }>,
    passengerDisplays: [],
    updatedAt: new Date(0).toISOString(),
    officialRunKey: 'run-1',
  },
  arriveAtNextDestination: vi.fn(),
  clearOperatorSession: vi.fn(),
  clearTripRoute: vi.fn(() => Promise.resolve()),
  configureTripRoute: vi.fn(() => Promise.resolve()),
  connectOperatorToBus: vi.fn(),
  logoutPairedScreens: vi.fn(() => Promise.resolve({
    busNumber: '9923',
    pairingCode: '5932',
    trip: {},
  })),
  publishTripLocation: vi.fn(() => Promise.resolve()),
  signOut: vi.fn(() => Promise.resolve()),
  startLiveTrip: vi.fn(() => Promise.resolve()),
  suggestDestinations: vi.fn(() => Promise.resolve([] as Array<{
    id: string;
    label: string;
    lat: number;
    lng: number;
    type: string;
  }>)),
  updateTripAnnouncements: vi.fn(() => Promise.resolve()),
  updateTripDisplaySettings: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/providers/driver-profile', () => ({
  useDriverProfileQuery: vi.fn(() => ({ data: { username: 'test_driver' }, refetch: vi.fn() })),
  useUpdateDriverProfile: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

vi.mock('@clerk/react', async () => {
  const actual = await vi.importActual('@workspace/api-client-react');
  return {
    ...actual,
    useAuth: vi.fn(() => ({ isLoaded: true, userId: 'user_operator' })),
    useUser: vi.fn(() => ({ user: { id: 'user_operator', username: 'operator1' } })),
    useClerk: vi.fn(() => ({ signOut })),
    ClerkProvider: ({ children }: any) => <>{children}</>,
  };
});

vi.mock('@workspace/api-client-react', async () => {
  const actual = await vi.importActual('@workspace/api-client-react');
  return {
    ...actual,
    useGetAdminAccess: vi.fn(() => ({ data: { authorized: false }, isLoading: false, isError: false })),
    useGetDriverScheduledTrips: vi.fn(() => assignmentQueryState),
  };
});

vi.mock('@/providers/live-trip', () => ({
  arriveAtNextDestination,
  clearOperatorSession,
  clearTripRoute,
  configureTripRoute,
  connectOperatorToBus,
  createPassengerQrInvite: vi.fn(() => Promise.resolve({
    token: 'test-qr-token',
    expiresAt: '2026-09-17T21:00:00.000Z',
  })),
  getOperatorBusNumber: () => '9923',
  getOperatorPairingCode: () => '4821',
  LIVE_TRIP_REFRESH_INTERVAL_MS: 3_000,
  logoutOperator: vi.fn(),
  logoutPairedScreens,
  publishTripLocation,
  resolveDestination: vi.fn(),
  startLiveTrip,
  stopLiveTrip: vi.fn(),
  suggestDestinations,
  updateEmergencySettings: vi.fn(),
  updateTripAnnouncements,
  updateTripDisplaySettings,
  useLiveTrip: () => liveTripState,
  useLiveTripRefreshStatus: () => ({
    isRefreshing: false,
    lastSuccessfulRefreshAt: Date.now(),
    lastRefreshFailed: false,
  }),
}));

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

function openOperatorTab(name: 'Home' | 'Trips' | 'Map' | 'More') {
  fireEvent.click(screen.getAllByRole('button', { name })[0]);
}

describe('OperatorPanel arrival sound settings', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    vi.stubGlobal('confirm', vi.fn(() => true));
    Object.assign(liveTripState, {
      status: 'idle',
      destinationAddress: '',
      destination: null,
      intermediateStops: [],
      currentLocation: null,
      speedMph: null,
      locationUpdatedAt: null,
      arrivalSoundsEnabled: true,
      announcements: [],
      passengerDisplays: [],
      updatedAt: new Date(0).toISOString(),
    });
    updateTripDisplaySettings.mockClear();
    updateTripAnnouncements.mockClear();
    clearTripRoute.mockClear();
    configureTripRoute.mockReset();
    configureTripRoute.mockResolvedValue(undefined);
    suggestDestinations.mockReset();
    suggestDestinations.mockResolvedValue([]);
    clearOperatorSession.mockClear();
    signOut.mockClear();
    arriveAtNextDestination.mockReset();
    startLiveTrip.mockReset();
    startLiveTrip.mockResolvedValue(undefined);
    publishTripLocation.mockClear();
    connectOperatorToBus.mockReset();
    logoutPairedScreens.mockClear();
    Object.assign(assignmentQueryState, {
      data: [],
      isLoading: false,
      isError: false,
      isFetching: false,
    });
    assignmentQueryState.refetch.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows an in-order Arrived action beside every stop, including the final destination', async () => {
    Object.assign(liveTripState, {
      status: 'running',
      destinationAddress: 'Final Avenue & Terminal Road',
      destination: { lat: 40.73, lng: -74.006 },
      intermediateStops: [
        { id: 'first', address: 'First Street & Oak Avenue', lat: 40.71, lng: -74.006, eta: null },
        { id: 'second', address: 'Second Street & Pine Avenue', lat: 40.72, lng: -74.006, eta: null },
      ],
      startedAt: '2026-09-16T12:00:00.000Z',
      currentLocation: null,
      speedMph: 0,
      locationUpdatedAt: new Date().toISOString(),
    });
    arriveAtNextDestination.mockResolvedValue({
      trip: { ...liveTripState },
      arrivedAt: 'First Street & Oak Avenue',
      nextDestination: 'Second Street & Pine Avenue',
      tripComplete: false,
    });
    const view = renderWithProviders(<OperatorPanel />);
    openOperatorTab('Trips');

    const first = screen.getByTestId('button-arrived-stop-0') as HTMLButtonElement;
    const second = screen.getByTestId('button-arrived-stop-1') as HTMLButtonElement;
    const final = screen.getByTestId('button-arrived-final') as HTMLButtonElement;
    expect(screen.getByTestId('arrival-order-guidance').textContent).toContain('Complete stops in order');
    expect(first.disabled).toBe(false);
    expect(second.disabled).toBe(true);
    expect(final.disabled).toBe(true);
    fireEvent.click(second);
    fireEvent.click(final);
    expect(arriveAtNextDestination).not.toHaveBeenCalled();

    fireEvent.click(first);
    await waitFor(() => expect(arriveAtNextDestination).toHaveBeenCalledWith(
      'first',
      '2026-09-16T12:00:00.000Z',
    ));

    arriveAtNextDestination.mockClear();
    liveTripState.intermediateStops = [];
    arriveAtNextDestination.mockImplementation(async () => {
      const completedTrip = { ...liveTripState, status: 'stopped', destination: null, destinationAddress: '' };
      Object.assign(liveTripState, completedTrip);
      return {
        trip: completedTrip,
        arrivedAt: 'Final Avenue & Terminal Road',
        nextDestination: null,
        tripComplete: true,
      };
    });
    view.rerender(<OperatorPanel />);
    const enabledFinal = screen.getByTestId('button-arrived-final') as HTMLButtonElement;
    expect(enabledFinal.disabled).toBe(false);
    fireEvent.click(enabledFinal);
    await waitFor(() => expect(arriveAtNextDestination).toHaveBeenCalledWith(
      '40.73:-74.006',
      '2026-09-16T12:00:00.000Z',
    ));
    expect((await screen.findByTestId('arrival-notice')).textContent).toContain('Trip complete');
    expect(screen.queryByTestId('button-arrived-final')).toBeNull();
  });

  it('starts without a GPS fix, keeps manual arrivals available, and recovers tracking on retry', async () => {
    Object.assign(liveTripState, {
      status: 'ready',
      destinationAddress: 'Final Avenue & Terminal Road',
      destination: { lat: 40.73, lng: -74.006 },
      intermediateStops: [
        { id: 'first', address: 'First Street & Oak Avenue', lat: 40.71, lng: -74.006, eta: null },
      ],
      startedAt: null,
      currentLocation: null,
      officialRunKey: 'run-1',
    });
    startLiveTrip.mockImplementation(async () => {
      Object.assign(liveTripState, {
        status: 'running',
        startedAt: '2026-09-16T12:00:00.000Z',
         speedMph: 0,
         locationUpdatedAt: new Date().toISOString(),
      });
    });
    const getCurrentPosition = vi.fn()
      .mockImplementationOnce((_success, error) => error({ code: 1, message: 'denied' }))
      .mockImplementationOnce((success) => success({
        coords: { latitude: 40.7, longitude: -74.0, speed: 10 },
        timestamp: Date.now(),
      }));
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition,
        watchPosition: vi.fn(() => 7),
        clearWatch: vi.fn(),
      },
    });

    renderWithProviders(<OperatorPanel />);
    fireEvent.click(screen.getByTestId('button-start-trip'));
    await waitFor(() => expect(startLiveTrip).toHaveBeenCalledWith());
    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Exit Navigation' }));
    await waitFor(() => expect(screen.getByTestId('gps-message').textContent).toContain('permission is blocked'));

    openOperatorTab('Trips');
    expect((screen.getByTestId('button-arrived-stop-0') as HTMLButtonElement).disabled).toBe(false);

    openOperatorTab('Home');
    fireEvent.click(screen.getByRole('button', { name: /Enable.*retry GPS/i }));
    await waitFor(() => expect(publishTripLocation).toHaveBeenCalledWith(
      { lat: 40.7, lng: -74 },
      expect.closeTo(22.3694, 4),
    ));
    expect(screen.getByTestId('gps-message').textContent).toContain('GPS is live');
  });

  it('keeps a server-side mute after an already-paired page reloads', async () => {
    const { rerender } = renderWithProviders(<OperatorPanel />);

    Object.assign(liveTripState, {
      arrivalSoundsEnabled: false,
      updatedAt: '2026-09-16T15:00:00.000Z',
    });
    rerender(<OperatorPanel />);
    openOperatorTab('More');

    const soundToggle = await screen.findByRole('switch', { name: 'Enable arrival sounds' });

    const saveChanges = screen.getByRole('button', { name: 'Save Display Changes' });
    await waitFor(() => expect(soundToggle.getAttribute('data-state')).toBe('unchecked'));

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '20' } });
    await waitFor(() => expect((saveChanges as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveChanges);

    await waitFor(() => {
      expect(updateTripDisplaySettings).toHaveBeenCalledWith(expect.objectContaining({
        arrivalSoundsEnabled: false,
      }));
    });
    expect(screen.getByText('Configuration saved')).toBeTruthy();
  });

  it('shows blocked passenger audio with recovery instructions', () => {
    Object.assign(liveTripState, {
      passengerDisplays: [{ id: 'display-one', audioReady: false }],
    });

    renderWithProviders(<OperatorPanel />);
    openOperatorTab('Home');

    expect(screen.getByText('Audio blocked (1)')).toBeTruthy();
  });

  it.skip('clears a configured route from passenger displays', async () => {
    Object.assign(liveTripState, {
      status: 'ready',
      destinationAddress: 'Midtown Manhattan',
      destination: { lat: 40.75, lng: -73.99 },
      intermediateStops: [{ id: 'stop-1', address: 'Fort Lee', lat: 40.85, lng: -73.97, eta: null }],
      routeGeometry: [{ lat: 40.85, lng: -73.97 }, { lat: 40.75, lng: -73.99 }],
      officialRunKey: 'run-1',
    });
    renderWithProviders(<OperatorPanel />);
    openOperatorTab('More');

    fireEvent.click(screen.getByRole('button', { name: 'Clear Route' }));

    await waitFor(() => expect(clearTripRoute).toHaveBeenCalledTimes(1));
  });

  it.skip('adds a selected intersection before the destination without replacing the ready trip', async () => {
    Object.assign(liveTripState, {
      status: 'ready',
      destinationAddress: 'Midtown Terminal, New York, NY',
      destination: { lat: 40.75, lng: -73.99 },
      intermediateStops: [
        { id: 'saved-stop', address: 'Main Street & Maple Avenue, Monsey, NY', lat: 41.11, lng: -74.06 },
      ],
      officialRunKey: 'official-run-22',
      updatedAt: '2026-09-18T10:00:00.000Z',
    });
    suggestDestinations.mockResolvedValue([
      { id: 'new-stop', label: '18th Avenue & 49th Street, Brooklyn, NY', lat: 40.63, lng: -74.01, type: 'Cross Street' },
    ]);
    renderWithProviders(<OperatorPanel />);
    openOperatorTab('Trips');

    fireEvent.click(screen.getByRole('button', { name: 'Add stop' }));
    const stopInputs = screen.getAllByPlaceholderText('Enter an address, intersection, or Plus Code');
    fireEvent.change(stopInputs[1], { target: { value: '18th Avenue & 49th Street' } });
    fireEvent.click(await screen.findByRole('option', { name: /18th Avenue & 49th Street/i }, { timeout: 2_000 }));
    expect(screen.getAllByText('Address or Plus Code selected')).toHaveLength(2);
    const saveStops = screen.getByRole('button', { name: 'Save stops' });
    await waitFor(() => expect((saveStops as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveStops);

    await waitFor(() => expect(configureTripRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        address: 'Midtown Terminal, New York, NY',
        lat: 40.75,
        lng: -73.99,
      }),
      [
        expect.objectContaining({ id: 'saved-stop', address: 'Main Street & Maple Avenue, Monsey, NY' }),
        expect.objectContaining({ address: '18th Avenue & 49th Street, Brooklyn, NY' }),
      ],
      'official-run-22',
    ));
    expect(screen.getByText('Midtown Terminal, New York, NY')).toBeTruthy();
  });

  it.skip('saves selected Plus Code center coordinates unchanged for an intermediate stop', async () => {
    Object.assign(liveTripState, {
      status: 'ready',
      destinationAddress: 'Midtown Terminal, New York, NY',
      destination: { lat: 40.75, lng: -73.99 },
      intermediateStops: [],
      officialRunKey: 'official-run-plus-code',
      updatedAt: '2026-09-18T10:05:00.000Z',
    });
    suggestDestinations.mockResolvedValue([{
      id: 'plus-code-849VCWC8+R9',
      label: '849VCWC8+R9 Plus Code — 37.422062, -122.084063 (≈14 m area center, not exact curbside)',
      lat: 37.422062499999996,
      lng: -122.0840625,
      type: 'Plus Code',
    }]);
    renderWithProviders(<OperatorPanel />);
    openOperatorTab('Trips');

    fireEvent.click(screen.getByRole('button', { name: 'Add stop' }));
    fireEvent.change(screen.getByPlaceholderText('Enter an address, intersection, or Plus Code'), {
      target: { value: '849VCWC8+R9 Mountain View, CA' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /849VCWC8\+R9 Plus Code/i }, { timeout: 2_000 }));
    fireEvent.click(screen.getByRole('button', { name: 'Save stops' }));

    await waitFor(() => expect(configureTripRoute).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 40.75, lng: -73.99 }),
      [expect.objectContaining({
        id: expect.any(String),
        lat: 37.422062499999996,
        lng: -122.0840625,
      })],
      'official-run-plus-code',
    ));
  });

  it.skip('saves a selected full Plus Code as the final destination without changing stops or official run', async () => {
    Object.assign(liveTripState, {
      status: 'ready',
      destinationAddress: 'Original Terminal, New York, NY',
      destination: { lat: 40.75, lng: -73.99 },
      intermediateStops: [
        { id: 'kept-stop', address: 'Kept Stop, Monsey, NY', lat: 41.111, lng: -74.067 },
      ],
      officialRunKey: 'official-run-destination-plus',
      updatedAt: '2026-09-18T10:06:00.000Z',
    });
    suggestDestinations.mockResolvedValue([{
      id: 'plus-code-849VCWC8+R9',
      label: '849VCWC8+R9 Plus Code — 37.422062, -122.084063 (≈14 m area center, not exact curbside)',
      lat: 37.422062499999996,
      lng: -122.0840625,
      type: 'Plus Code',
    }]);
    renderWithProviders(<OperatorPanel />);
    openOperatorTab('Trips');

    fireEvent.click(screen.getByRole('button', { name: 'Edit final destination' }));
    fireEvent.change(screen.getByPlaceholderText('Enter a destination address, intersection, or Plus Code'), {
      target: { value: '849VCWC8+R9 Mountain View, CA' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /849VCWC8\+R9 Plus Code/i }, { timeout: 2_000 }));
    fireEvent.click(screen.getByRole('button', { name: 'Save destination' }));

    await waitFor(() => expect(configureTripRoute).toHaveBeenCalledWith(
      {
        id: 'plus-code-849VCWC8+R9',
        address: expect.stringContaining('849VCWC8+R9 Plus Code'),
        lat: 37.422062499999996,
        lng: -122.0840625,
      },
      [{
        id: 'kept-stop',
        address: 'Kept Stop, Monsey, NY',
        lat: 41.111,
        lng: -74.067,
      }],
      'official-run-destination-plus',
    ));
    expect(window.confirm).toHaveBeenCalledWith(
      'Change the final navigation point? The official departure assignment will stay the same.',
    );
  });

  it.skip('cancels a final destination edit without saving or replacing the old destination', async () => {
    Object.assign(liveTripState, {
      status: 'ready',
      destinationAddress: 'Original Terminal, New York, NY',
      destination: { lat: 40.75, lng: -73.99 },
      intermediateStops: [],
      officialRunKey: 'official-run-cancel-destination',
      updatedAt: '2026-09-18T10:07:00.000Z',
    });
    renderWithProviders(<OperatorPanel />);
    openOperatorTab('Trips');

    fireEvent.click(screen.getByRole('button', { name: 'Edit final destination' }));
    fireEvent.change(screen.getByPlaceholderText('Enter a destination address, intersection, or Plus Code'), {
      target: { value: '849VCWC8+R9' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel destination edit' }));

    expect(configureTripRoute).not.toHaveBeenCalled();
    expect(screen.getByText('Original Terminal, New York, NY')).toBeTruthy();
    expect(screen.queryByPlaceholderText('Enter a destination address, intersection, or Plus Code')).toBeNull();
  });

  it.skip('edits, reorders, and removes stops while keeping the assigned run and final destination', async () => {
    Object.assign(liveTripState, {
      status: 'ready',
      destinationAddress: 'Port Authority, New York, NY',
      destination: { lat: 40.7569, lng: -73.9903 },
      intermediateStops: [
        { id: 'stop-a', address: 'First Stop, Monsey, NY', lat: 41.1, lng: -74.05 },
        { id: 'stop-b', address: 'Second Stop, Spring Valley, NY', lat: 41.11, lng: -74.04 },
        { id: 'stop-c', address: 'Third Stop, Nanuet, NY', lat: 41.09, lng: -74.01 },
      ],
      officialRunKey: 'official-run-24',
      updatedAt: '2026-09-18T10:30:00.000Z',
    });
    suggestDestinations.mockResolvedValue([
      { id: 'edited-address', label: 'Route 59 & Main Street, Monsey, NY', lat: 41.111, lng: -74.067, type: 'Cross Street' },
    ]);
    renderWithProviders(<OperatorPanel />);
    openOperatorTab('Trips');

    fireEvent.change(screen.getAllByPlaceholderText('Enter an address, intersection, or Plus Code')[0], {
      target: { value: 'Route 59 and Main Street' },
    });
    fireEvent.click(await screen.findByRole('option', { name: /Route 59 & Main Street/i }, { timeout: 2_000 }));
    fireEvent.click(screen.getByRole('button', { name: 'Move stop 1 later' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove stop 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save stops' }));

    await waitFor(() => expect(configureTripRoute).toHaveBeenCalledWith(
      {
        id: 'saved-destination',
        address: 'Port Authority, New York, NY',
        lat: 40.7569,
        lng: -73.9903,
      },
      [
        expect.objectContaining({ id: 'stop-b', address: 'Second Stop, Spring Valley, NY' }),
        expect.objectContaining({
          id: 'stop-a',
          address: 'Route 59 & Main Street, Monsey, NY',
          lat: 41.111,
          lng: -74.067,
        }),
      ],
      'official-run-24',
    ));
    expect(screen.getByText('Port Authority, New York, NY')).toBeTruthy();
  });

  it.skip('retries a failed stop edit without losing its official assignment or final destination', async () => {
    Object.assign(liveTripState, {
      status: 'ready',
      destinationAddress: 'Boro Park Terminal, Brooklyn, NY',
      destination: { lat: 40.64, lng: -73.99 },
      intermediateStops: [
        { id: 'saved-stop', address: 'Old Stop, Monsey, NY', lat: 41.1, lng: -74.05 },
      ],
      officialRunKey: 'official-run-23',
      updatedAt: '2026-09-18T11:00:00.000Z',
    });
    suggestDestinations.mockResolvedValue([
      { id: 'edited-stop', label: 'Route 45 & Maple Avenue, Monsey, NY', lat: 41.12, lng: -74.07, type: 'Cross Street' },
    ]);
    configureTripRoute.mockRejectedValueOnce(new Error('Route update could not be saved.'));
    renderWithProviders(<OperatorPanel />);
    openOperatorTab('Trips');

    const stopInput = screen.getByPlaceholderText('Enter an address, intersection, or Plus Code');
    fireEvent.change(stopInput, { target: { value: 'Route 45 and Maple Avenue' } });
    fireEvent.click(await screen.findByRole('option', { name: /Route 45 & Maple Avenue/i }, { timeout: 2_000 }));
    const saveStops = screen.getByRole('button', { name: 'Save stops' });
    await waitFor(() => expect((saveStops as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveStops);

    await waitFor(() => expect(configureTripRoute).toHaveBeenCalledWith(
      expect.objectContaining({ address: 'Boro Park Terminal, Brooklyn, NY' }),
      [expect.objectContaining({ address: 'Route 45 & Maple Avenue, Monsey, NY' })],
      'official-run-23',
    ));
    expect((screen.getByPlaceholderText('Enter an address, intersection, or Plus Code') as HTMLInputElement).value)
      .toBe('Route 45 & Maple Avenue, Monsey, NY');
    expect(screen.getByText('Unsaved stop changes')).toBeTruthy();
    expect(screen.getByText('Boro Park Terminal, Brooklyn, NY')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save stops' }));

    await waitFor(() => expect(configureTripRoute).toHaveBeenCalledTimes(2));
    for (const call of configureTripRoute.mock.calls) {
      expect(call).toEqual([
        {
          id: 'saved-destination',
          address: 'Boro Park Terminal, Brooklyn, NY',
          lat: 40.64,
          lng: -73.99,
        },
        [expect.objectContaining({
          id: 'saved-stop',
          address: 'Route 45 & Maple Avenue, Monsey, NY',
          lat: 41.12,
          lng: -74.07,
        })],
        'official-run-23',
      ]);
    }
    await waitFor(() => expect(screen.getByText('Stops match the saved ready trip')).toBeTruthy());
    expect(screen.getByText('Boro Park Terminal, Brooklyn, NY')).toBeTruthy();
  });

  it('does not offer stop editing while a trip is running', () => {
    Object.assign(liveTripState, {
      status: 'running',
      destinationAddress: 'Midtown Manhattan',
      destination: { lat: 40.75, lng: -73.99 },
      intermediateStops: [
        { id: 'active-stop', address: 'Fort Lee, NJ', lat: 40.85, lng: -73.97, eta: null },
      ],
      officialRunKey: 'official-run-active',
      speedMph: 0,
      locationUpdatedAt: new Date().toISOString(),
    });

    renderWithProviders(<OperatorPanel />);
    openOperatorTab('Trips');

    expect(screen.getByText('Trip Stops')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add stop' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save stops' })).toBeNull();
    expect(screen.queryByPlaceholderText('Enter an address, intersection, or Plus Code')).toBeNull();
  });

  it('releases the owned coach and returns account sign-out to driver login', async () => {
    const accountChanged = vi.fn();
    window.addEventListener('driver-account-changed', accountChanged);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))));
    renderWithProviders(<OperatorPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ redirectUrl: '/sign-in' }));
    expect(fetch).toHaveBeenCalledWith('/api/driver/release-coaches', { method: 'POST' });
    expect(clearOperatorSession).toHaveBeenCalledTimes(1);
    expect(accountChanged).toHaveBeenCalledTimes(1);
    window.removeEventListener('driver-account-changed', accountChanged);
  });

  it('saves announcement drafts explicitly for the optional passenger slide', async () => {
    renderWithProviders(<OperatorPanel />);
    openOperatorTab('More');
    const editAnnouncementsTab = screen.getByRole('tab', { name: 'Announcements' });
    fireEvent.mouseDown(editAnnouncementsTab, { button: 0, ctrlKey: false });
    fireEvent.click(editAnnouncementsTab);

    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(updateTripAnnouncements).not.toHaveBeenCalled();

    const headerInput = screen.getByRole('textbox', { name: 'Edit header for New Announcement' });
    fireEvent.change(headerInput, { target: { value: 'Pickup Update' } });

    const previewTab = screen.getByRole('tab', { name: 'Preview' });
    fireEvent.mouseDown(previewTab, { button: 0, ctrlKey: false });
    fireEvent.click(previewTab);
    expect(screen.getByText('Passenger Information')).toBeTruthy();
    expect(screen.getAllByText('Pickup Update').length).toBeGreaterThan(0);

    const visibilityTab = screen.getByRole('tab', { name: 'Show / Hide' });
    fireEvent.mouseDown(visibilityTab, { button: 0, ctrlKey: false });
    fireEvent.click(visibilityTab);
    const visibilitySwitch = screen.getByRole('switch', { name: 'Show Pickup Update in main slides' });
    fireEvent.click(visibilitySwitch);
    expect(screen.getByText('Hide from main slides')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save Announcements' }));
    await waitFor(() => {
      expect(updateTripAnnouncements).toHaveBeenLastCalledWith([
        expect.objectContaining({
          title: 'Pickup Update',
          message: 'Enter details here',
          active: false,
        }),
      ]);
    });
    expect(await screen.findByText('All announcements saved')).toBeTruthy();

    fireEvent.mouseDown(editAnnouncementsTab, { button: 0, ctrlKey: false });
    fireEvent.click(editAnnouncementsTab);
    fireEvent.click(screen.getByRole('button', { name: 'Delete announcement' }));
    expect(updateTripAnnouncements).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save Announcements' }));
    await waitFor(() => {
      expect(updateTripAnnouncements).toHaveBeenLastCalledWith([]);
    });
  });

  it('switches operator sections and can return to the starting section', () => {
    renderWithProviders(<OperatorPanel />);

    expect(screen.getByText('Coach Connection')).toBeTruthy();
    openOperatorTab('Trips');
    expect(screen.getByText('Trip Stops')).toBeTruthy();
    expect(screen.queryByText('Coach Connection')).toBeNull();

    openOperatorTab('Home');
    expect(screen.getByText('Coach Connection')).toBeTruthy();
    expect(screen.queryByText('Trip Stops')).toBeNull();
  });

  it('keeps top-level setup and editing controls open while a trip is running', () => {
    Object.assign(liveTripState, {
      status: 'running',
      speedMph: 18,
      locationUpdatedAt: new Date().toISOString(),
    });

    renderWithProviders(<OperatorPanel />);

    expect(screen.getByText('Coach Connection')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Trips' }).length).toBeGreaterThan(0);
    expect(screen.queryByText('Setup controls are hidden while the coach may be moving.')).toBeNull();
  });

  it('leads Home with the signed-in driver dispatch assignment and uses the safe coach connection flow', async () => {
    assignmentQueryState.data = [{
      busNumber: '7712',
      officialRunKey: '2026-09-18|1|2|5|run-8',
      serviceDate: '2026-09-18',
      direction: 'Monsey → Manhattan',
      status: 'ready',
      scheduledDepartureAt: '2026-09-18T13:30:00.000Z',
      destinationAddress: 'Midtown Manhattan',
      stopCount: 8,
      assignmentSource: 'dispatch',
      displayKeys: ['B', 'R'],
      keyLegend: [
        { key: 'B', meaning: 'Goes to Boro Park.' },
        { key: 'R', meaning: 'Picks up and drops off at B&H Photo.' },
      ],
      scheduleKeysAvailable: true,
    }];
    connectOperatorToBus.mockResolvedValue({
      busNumber: '7712',
      pairingCode: '4821',
      trip: {
        ...liveTripState,
        status: 'ready',
        officialRunKey: '2026-09-18|1|2|5|run-8',
        destinationAddress: 'Midtown Manhattan',
        destination: { lat: 40.75, lng: -73.99 },
      },
    });

    renderWithProviders(<OperatorPanel />);

    expect(screen.getByRole('heading', { name: 'Dispatch-assigned trips' })).toBeTruthy();
    expect(screen.getByText('Dispatch assigned')).toBeTruthy();
    expect(screen.getByText('Monsey → Manhattan')).toBeTruthy();
    expect(screen.getByLabelText('Schedule keys B, R')).toBeTruthy();
    expect(screen.getByText('Schedule key meanings')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download schedule PDF' })).toBeTruthy();
    const assignedTrips = screen.getByRole('heading', { name: 'Dispatch-assigned trips' });
    const coachConnection = screen.getByText('Coach Connection');
    expect(assignedTrips.compareDocumentPosition(coachConnection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Use assigned coach' }));
    await waitFor(() => expect(connectOperatorToBus).toHaveBeenCalledWith('7712'));
    expect(await screen.findByText('Current trip')).toBeTruthy();
  });

  it('shows an invalid synthetic dispatch coach instead of silently dropping the selection', () => {
    assignmentQueryState.data = [{
      busNumber: 'SYN-101',
      officialRunKey: '2026-09-18|1|2|5|run-synthetic',
      serviceDate: '2026-09-18',
      direction: 'Monsey → Manhattan',
      status: 'ready',
      scheduledDepartureAt: '2026-09-18T13:30:00.000Z',
      destinationAddress: 'Midtown Manhattan',
      stopCount: 8,
      assignmentSource: 'dispatch',
      displayKeys: [],
      keyLegend: [],
      scheduleKeysAvailable: true,
    }];

    renderWithProviders(<OperatorPanel />);

    expect(screen.getByRole('alert').textContent).toContain('invalid coach number');
    expect((screen.getByRole('button', { name: 'Use assigned coach' }) as HTMLButtonElement).disabled).toBe(true);
    expect(connectOperatorToBus).not.toHaveBeenCalled();
  });

  it('shows the selected official run on Home even when there is no dispatch assignment', () => {
    Object.assign(liveTripState, {
      status: 'ready',
      officialRunKey: '2026-09-18|1|2|5|run-selected',
      destinationAddress: 'Port Authority, New York, NY',
      destination: { lat: 40.7569, lng: -73.9903 },
      intermediateStops: [{ id: 'stop-1', address: 'Fort Lee, NJ', lat: 40.85, lng: -73.97 }],
    });

    renderWithProviders(<OperatorPanel />);

    expect(screen.getByText('Selected official run')).toBeTruthy();
    expect(screen.getByText('Current trip')).toBeTruthy();
    expect(screen.getAllByText('Port Authority, New York, NY').length).toBeGreaterThan(0);
  });

  it('shows an assigned-trip error with an explicit retry on Home', () => {
    assignmentQueryState.isError = true;
    renderWithProviders(<OperatorPanel />);

    expect(screen.getByRole('alert').textContent).toContain('Assigned trips could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(assignmentQueryState.refetch).toHaveBeenCalledTimes(1);
  });

  it('automatically advances after remaining in the stop zone at low speed', async () => {
    vi.useFakeTimers();
    const stop = {
      id: 'first-stop',
      address: '18th Avenue & 49th Street',
      lat: 40.7129,
      lng: -74.006,
      eta: new Date(Date.now() + 20_000).toISOString(),
    };
    Object.assign(liveTripState, {
      status: 'running',
      destinationAddress: 'Main Street & Maple Avenue',
      destination: { lat: 40.8, lng: -74.01 },
      intermediateStops: [stop],
      currentLocation: { lat: 40.7128, lng: -74.006 },
      speedMph: 4,
      startedAt: '2026-09-18T13:30:00.000Z',
    });
    arriveAtNextDestination.mockResolvedValue({
      trip: { ...liveTripState, intermediateStops: [] },
      arrivedAt: stop.address,
      nextDestination: liveTripState.destinationAddress,
      tripComplete: false,
    });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: vi.fn(),
        watchPosition: vi.fn(() => 1),
        clearWatch: vi.fn(),
      },
    });

    renderWithProviders(<OperatorPanel />);
    expect(arriveAtNextDestination).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(14_999);
      await Promise.resolve();
    });
    expect(arriveAtNextDestination).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(arriveAtNextDestination).toHaveBeenCalledTimes(1);
    expect(arriveAtNextDestination).toHaveBeenCalledWith(
      'first-stop',
      '2026-09-18T13:30:00.000Z',
    );
    vi.useRealTimers();
  });

  it('lets the driver complete the final destination and reports completion failures', async () => {
    Object.assign(liveTripState, {
      status: 'running',
      destinationAddress: 'Main Street & Maple Avenue',
      destination: { lat: 40.8, lng: -74.01 },
      intermediateStops: [],
      startedAt: '2026-09-18T13:30:00.000Z',
      speedMph: 0,
      locationUpdatedAt: new Date().toISOString(),
    });
    arriveAtNextDestination.mockResolvedValueOnce({
      trip: { ...liveTripState, status: 'stopped' },
      arrivedAt: liveTripState.destinationAddress,
      nextDestination: null,
      tripComplete: true,
    });

    renderWithProviders(<OperatorPanel />);
    openOperatorTab('More');
    fireEvent.click(screen.getByRole('button', { name: 'Mark final destination arrived' }));

    await waitFor(() => expect(arriveAtNextDestination).toHaveBeenCalledWith(
      '40.8:-74.01',
      '2026-09-18T13:30:00.000Z',
    ));
    await waitFor(() => expect(
      (screen.getByRole('button', { name: 'Mark final destination arrived' }) as HTMLButtonElement).disabled,
    ).toBe(false));

    arriveAtNextDestination.mockRejectedValueOnce(new Error('Stop changed on another screen.'));
    fireEvent.click(screen.getByRole('button', { name: 'Mark final destination arrived' }));
    await waitFor(() => expect(arriveAtNextDestination).toHaveBeenCalledTimes(2));
  });

  it('does not expose driver coach assignment or schedule application actions', () => {
    renderWithProviders(<OperatorPanel />);

    expect(screen.queryByTestId('input-bus-id')).toBeNull();
    expect(screen.queryByTestId('button-connect-bus')).toBeNull();
    openOperatorTab('Trips');
    expect(screen.queryByText('Schedule & Assignment')).toBeNull();
    expect(screen.queryByRole('button', { name: /apply/i })).toBeNull();
  });

  it('logs out all paired screens without signing out the driver or clearing the assignment', async () => {
    renderWithProviders(<OperatorPanel />);
    openOperatorTab('More');

    fireEvent.click(screen.getByRole('button', { name: 'Log out all paired screens' }));

    await waitFor(() => expect(logoutPairedScreens).toHaveBeenCalledTimes(1));
    expect(signOut).not.toHaveBeenCalled();
    expect(clearOperatorSession).not.toHaveBeenCalled();
  });

  it('keeps the ready operator console mounted when location permission is denied', async () => {
    Object.assign(liveTripState, {
      status: 'running',
      destinationAddress: 'Midtown Manhattan',
      destination: { lat: 40.75, lng: -73.99 },
      intermediateStops: [],
      currentLocation: null,
      speedMph: null,
    });
    const denied = {
      code: 1,
      message: 'User denied Geolocation',
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    } as GeolocationPositionError;
    const getCurrentPosition = vi.fn((
      _success: PositionCallback,
      failure?: PositionErrorCallback | null,
    ) => failure?.(denied));
    const watchPosition = vi.fn(() => 1);
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition,
        watchPosition,
        clearWatch: vi.fn(),
      },
    });
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);

    renderWithProviders(<OperatorPanel />);

    await waitFor(() => expect(getCurrentPosition).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('heading', { name: 'Operator Console' })).toBeTruthy();
    expect(watchPosition).not.toHaveBeenCalled();
    expect(publishTripLocation).not.toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
    window.removeEventListener('unhandledrejection', unhandled);
  });
});
