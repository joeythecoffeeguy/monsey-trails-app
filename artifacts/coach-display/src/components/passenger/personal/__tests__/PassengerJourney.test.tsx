import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalPassengerView } from '../PersonalPassengerView';

const { assignedCoach, journeyMapProps, liveTripState } = vi.hoisted(() => ({
  assignedCoach: { current: null as string | null },
  journeyMapProps: { current: null as null | {
    selectedStopId: string | null;
    onSelectStop: (stopId: string) => void;
  } },
  liveTripState: {
    passengerLanguage: 'en',
    status: 'ready',
    locationVisibility: 'unavailable',
    currentLocation: null as { lat: number; lng: number } | null,
    locationUpdatedAt: undefined as string | undefined,
    destinationAddress: '',
    destination: null,
    intermediateStops: [],
    journeyProgress: [],
    updatedAt: new Date(0).toISOString(),
  },
}));

vi.mock('@/providers/live-trip', () => ({
  useLiveTrip: () => liveTripState,
  useLiveTripRefreshStatus: () => ({ lastRefreshFailed: false, isRefreshing: false }),
  getPersonalBusNumber: () => assignedCoach.current,
}));

vi.mock('@/lib/background-stop-alerts', () => ({
  backgroundAlertsSupported: () => false,
  getSelectedStopAlert: () => null,
  enableBackgroundStopAlert: vi.fn(),
}));

vi.mock('../PersonalJourneyMap', () => ({
  PersonalJourneyMap: (props: typeof journeyMapProps.current) => {
    journeyMapProps.current = props;
    return <div data-testid="journey-map" data-selected-stop={props?.selectedStopId ?? ''} />;
  },
}));

vi.mock('../PersonalUnpairedView', () => ({
  PersonalUnpairedView: () => <div>Departure picker</div>,
}));

vi.mock('../DepartureReminderPanel', () => ({
  DepartureReminderPanel: () => null,
}));

const runKey = '2024-11-20|1|2|5|run1';
const originalFetch = global.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function journeyResponse(overrides: Record<string, unknown> = {}): Response {
  return jsonResponse({
    runKey,
    originName: 'Monsey',
    destinationName: 'Manhattan',
    serviceDate: '2024-11-20',
    scheduledDepartureAt: '2024-11-20T08:00:00Z',
    scheduledArrivalAt: '2024-11-20T09:00:00Z',
    arrivalVerification: 'verified',
    stops: [],
    routeGeometry: [],
    trafficStatus: 'forecast',
    trafficUpdatedAt: null,
    message: null,
    ...overrides,
  });
}

function stop(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    label: 'Stop A',
    mapLabel: 'A',
    lat: 41,
    lng: -74,
    kind: 'pickup',
    scheduledAt: '2024-11-20T08:00:00Z',
    estimatedArrivalAt: '2024-11-20T08:05:00Z',
    ...overrides,
  };
}

describe('PersonalPassengerView Journey', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    global.fetch = vi.fn();
    assignedCoach.current = null;
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    Object.assign(liveTripState, {
      status: 'ready',
      locationVisibility: 'unavailable',
      currentLocation: null,
      locationUpdatedAt: undefined,
      journeyProgress: [],
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  const view = (selectedRunKey = runKey, setSelectedRunKey = vi.fn(), returnToSchedule = vi.fn()) => (
    <QueryClientProvider client={queryClient}>
      <PersonalPassengerView
        selectedRunKey={selectedRunKey}
        setSelectedRunKey={setSelectedRunKey}
        departureTime="08:00:00"
        setDepartureTime={vi.fn()}
        connectedBusNumber=""
        connectionError=""
        setConnectionError={vi.fn()}
        connectionBusy={false}
        connectPassengerDisplay={vi.fn().mockResolvedValue(undefined)}
        returnToSchedule={returnToSchedule}
        scheduleFilters={{ line: 1, origin: 2, destination: 5, date: '2024-11-20' }}
        setScheduleFilters={vi.fn()}
        personalView="trip"
        openLiveTracking={vi.fn()}
        returnToTripDetails={vi.fn()}
      />
    </QueryClientProvider>
  );

  it('suppresses live GPS and map controls while the browser is offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    vi.mocked(global.fetch).mockResolvedValue(journeyResponse({
      routeGeometry: [{ lat: 41, lng: -74 }],
      trafficStatus: 'live',
      trafficUpdatedAt: new Date().toISOString(),
    }));

    render(view());

    expect(await screen.findByText('Map unavailable offline')).toBeTruthy();
    expect(screen.getByText('Saved route')).toBeTruthy();
    expect(screen.queryByTestId('journey-map')).toBeNull();
    expect(screen.queryByText('View live tracking')).toBeNull();
  });

  it('renders a stop note from the journey response and suppresses a duplicate label', async () => {
    vi.mocked(global.fetch).mockResolvedValue(journeyResponse({
      stops: [
        stop({ note: 'Across from Ohr Sameach' }),
        stop({ id: '2', label: 'Same as note', note: ' same as note ' }),
      ],
    }));

    render(view());

    expect(await screen.findByText('Across from Ohr Sameach')).toBeTruthy();
    expect(screen.getAllByText('Same as note')).toHaveLength(1);
  });

  it('loads and shows unassigned stop list with forecast traffic', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(journeyResponse({
      stops: [stop({ estimatedArrivalAt: '2024-11-20T08:05:00Z' })],
      trafficUpdatedAt: '2024-11-20T07:50:00Z',
    }));

    render(view());

    expect(await screen.findByText('Monsey to Manhattan')).toBeDefined();
    expect((await screen.findAllByText('Stop A')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Typical Traffic/)).length).toBeGreaterThan(0);
  });

  it('renders server-authored journey progress with completion semantics and live upcoming ETAs', async () => {
    Object.assign(liveTripState, {
      status: 'running',
      destination: { lat: 40.8, lng: -73.9 },
      journeyProgress: [
        { id: 'picked', address: 'Pickup completed', lat: 41, lng: -74, eta: null, status: 'completed', kind: 'pickup' },
        { id: 'dropped', address: 'Dropoff completed', lat: 40.95, lng: -73.98, eta: null, status: 'completed', kind: 'dropoff' },
        { id: 'current', address: 'Current stop', lat: 40.9, lng: -73.95, eta: '2024-11-20T08:30:00Z', status: 'current', kind: 'dropoff' },
        { id: 'next', address: 'Upcoming stop', lat: 40.8, lng: -73.9, eta: '2024-11-20T08:45:00Z', status: 'upcoming', kind: 'destination' },
      ],
    });
    vi.mocked(global.fetch).mockResolvedValueOnce(journeyResponse({
      stops: [
        stop({ id: 'picked', label: 'Pickup completed' }),
        stop({ id: 'dropped', label: 'Dropoff completed' }),
        stop({ id: 'current', label: 'Current stop' }),
        stop({ id: 'next', label: 'Upcoming stop' }),
      ],
    }));

    render(view());

    expect(await screen.findByText('Departed')).toBeDefined();
    expect(screen.getByText('Arrived')).toBeDefined();
    expect(screen.getByText('Current')).toBeDefined();
    expect(screen.getAllByText(/Traffic estimate:/)).toHaveLength(2);
    expect(screen.getByText('Departed').className).toContain('text-emerald-700');
    expect(screen.getByText('Arrived').className).toContain('text-orange-700');
  });

  it('warns about a mismatched published arrival without hiding a separate traffic estimate', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(journeyResponse({
      scheduledArrivalAt: null,
      arrivalVerification: 'unverified',
      trafficStatus: 'live',
      stops: [stop()],
    }));

    render(view());

    expect(await screen.findByText('Published arrival date mismatch')).toBeDefined();
    expect(screen.getByText(/does not match this trip date/)).toBeDefined();
    expect(screen.getByText(/Live ETA/)).toBeDefined();
  });

  it('fails closed when arrival verification metadata is missing', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(journeyResponse({
      arrivalVerification: undefined,
    }));

    render(view());

    expect(await screen.findByText('Published arrival unverified')).toBeDefined();
    expect(screen.queryByText(/Published arrival: 9:00 AM/)).toBeNull();
  });

  it('shows published arrival unavailable when the normalized arrival is null', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(journeyResponse({
      scheduledArrivalAt: null,
      arrivalVerification: 'unavailable',
    }));

    render(view());

    expect(await screen.findByText('Published arrival unavailable')).toBeDefined();
  });

  it('reveals important trip information beside the published arrival', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(journeyResponse({
      stops: [stop({ note: 'Board at the marked passenger entrance.' })],
    }));

    render(view());

    const banner = await screen.findByRole('button', { name: /Important trip information/ });
    expect(screen.queryByText(/15 minutes prior to schedule time/)).toBeNull();
    fireEvent.click(banner);
    expect(screen.getByText(/15 minutes prior to schedule time/)).toBeDefined();
    expect(screen.getByText(/in front of the Mobil gas station/)).toBeDefined();
  });

  it('keeps route content and refresh-button geometry stable during a manual refresh', async () => {
    let finishRefresh!: (response: Response) => void;
    const refreshResponse = new Promise<Response>((resolve) => {
      finishRefresh = resolve;
    });
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(journeyResponse({ stops: [stop()] }))
      .mockReturnValueOnce(refreshResponse);

    render(view());
    expect(await screen.findByText('Monsey to Manhattan')).toBeDefined();
    const refreshButton = screen.getByRole('button', { name: 'Refresh route' });
    expect(refreshButton.className).toContain('h-8');
    expect(refreshButton.className).toContain('w-8');

    fireEvent.click(refreshButton);

    expect(refreshButton.getAttribute('aria-busy')).toBe('true');
    expect(refreshButton.querySelector('svg')?.getAttribute('class')).toContain('animate-spin');
    expect(screen.getByText('Monsey to Manhattan')).toBeDefined();
    expect(screen.getByText('Stop A')).toBeDefined();

    finishRefresh(journeyResponse({ stops: [stop()] }));
    await waitFor(() => expect(refreshButton.getAttribute('aria-busy')).toBe('false'));
    expect(refreshButton.querySelector('svg')?.getAttribute('class')).not.toContain('animate-spin');
  });

  it('shows live tracking CTA only for fresh, passenger-visible coach GPS', async () => {
    assignedCoach.current = '9923';
    Object.assign(liveTripState, {
      status: 'running',
      locationVisibility: 'live',
      currentLocation: { lat: 41, lng: -74 },
      locationUpdatedAt: new Date().toISOString(),
    });
    vi.mocked(global.fetch).mockResolvedValueOnce(journeyResponse());

    const openLiveTracking = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <PersonalPassengerView
          selectedRunKey={runKey}
          setSelectedRunKey={vi.fn()}
          departureTime="08:00:00"
          setDepartureTime={vi.fn()}
          connectedBusNumber=""
          connectionError=""
          setConnectionError={vi.fn()}
          connectionBusy={false}
          connectPassengerDisplay={vi.fn().mockResolvedValue(undefined)}
          returnToSchedule={vi.fn()}
          scheduleFilters={{ line: 1, origin: 2, destination: 5, date: '2024-11-20' }}
          setScheduleFilters={vi.fn()}
          personalView="trip"
          openLiveTracking={openLiveTracking}
          returnToTripDetails={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const cta = await screen.findByRole('button', { name: 'View live tracking' });
    fireEvent.click(cta);
    expect(openLiveTracking).toHaveBeenCalledOnce();
  });

  it('removes the live tracking CTA when the GPS ages out', async () => {
    assignedCoach.current = '9923';
    Object.assign(liveTripState, {
      status: 'running',
      locationVisibility: 'live',
      currentLocation: { lat: 41, lng: -74 },
      locationUpdatedAt: new Date(Date.now() - 120_000).toISOString(),
    });
    vi.mocked(global.fetch).mockResolvedValueOnce(journeyResponse());

    render(view());
    await screen.findByText('Monsey to Manhattan');
    expect(screen.queryByRole('button', { name: 'View live tracking' })).toBeNull();
  });

  it('keeps a direct live URL useful when tracking is unavailable and reports live-state loss', async () => {
    assignedCoach.current = '9923';
    Object.assign(liveTripState, {
      status: 'running',
      locationVisibility: 'live',
      currentLocation: { lat: 41, lng: -74 },
      locationUpdatedAt: new Date().toISOString(),
    });
    vi.mocked(global.fetch).mockResolvedValueOnce(journeyResponse());
    const returnToTripDetails = vi.fn();
    const liveView = () => (
      <QueryClientProvider client={queryClient}>
        <PersonalPassengerView
          selectedRunKey={runKey}
          setSelectedRunKey={vi.fn()}
          departureTime="08:00:00"
          setDepartureTime={vi.fn()}
          connectedBusNumber=""
          connectionError=""
          setConnectionError={vi.fn()}
          connectionBusy={false}
          connectPassengerDisplay={vi.fn().mockResolvedValue(undefined)}
          returnToSchedule={vi.fn()}
          scheduleFilters={{ line: 1, origin: 2, destination: 5, date: '2024-11-20' }}
          setScheduleFilters={vi.fn()}
          personalView="live"
          openLiveTracking={vi.fn()}
          returnToTripDetails={returnToTripDetails}
        />
      </QueryClientProvider>
    );
    const rendered = render(liveView());

    expect(await screen.findByText('Live coach location')).toBeDefined();
    Object.assign(liveTripState, {
      locationVisibility: 'unavailable',
      currentLocation: null,
    });
    rendered.rerender(liveView());

    expect(screen.queryByText('Live coach location')).toBeNull();
    expect(screen.getByText('Live tracking unavailable')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Return to trip details' }));
    expect(returnToTripDetails).toHaveBeenCalledOnce();
  });

  it('uses numbered keyboard stop buttons and keeps map and list selection synchronized', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0);
      return 1;
    });
    vi.mocked(global.fetch).mockResolvedValueOnce(journeyResponse({
      stops: [
        stop(),
        stop({ id: '2', label: 'Stop B', mapLabel: 'B', lat: 40.9 }),
      ],
    }));

    render(view());
    const second = await screen.findByRole('button', { name: /^2\s*Stop B/ });
    expect(second.getAttribute('aria-pressed')).toBe('false');
    expect(second.textContent?.trim().startsWith('2')).toBe(true);

    fireEvent.click(second);
    expect(second.getAttribute('aria-pressed')).toBe('true');
    expect(second.className).toContain('bg-primary/10');
    expect(second.className).not.toContain('bg-blue-50');
    expect(second.firstElementChild?.className).toContain('text-primary-foreground');
    expect(second.firstElementChild?.className).not.toContain('text-white');
    expect(screen.getByTestId('journey-map').getAttribute('data-selected-stop')).toBe('2');

    act(() => journeyMapProps.current?.onSelectStop('1'));
    expect(screen.getByRole('button', { name: /^1\s*Stop A/ }).getAttribute('aria-pressed')).toBe('true');
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
    expect(screen.getByTestId('journey-stop-scroller').className).toContain('min-h-0');
    expect(screen.getByTestId('journey-stop-scroller').className).toContain('overflow-y-auto');
  });

  it('handles other departures returning to picker', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(journeyResponse());
    const setSelectedRunKey = vi.fn();
    const returnToSchedule = vi.fn();
    render(view(runKey, setSelectedRunKey, returnToSchedule));

    await screen.findByText('Monsey to Manhattan');
    fireEvent.click(screen.getByRole('button', { name: 'Other departures' }));

    await waitFor(() => expect(returnToSchedule).toHaveBeenCalledOnce());
    expect(setSelectedRunKey).not.toHaveBeenCalled();
  });

  it('keeps hook ordering stable when the selected run changes empty to set to empty', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(journeyResponse());
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rerender } = render(view(''));

    expect(screen.getByText('Departure picker')).toBeDefined();
    rerender(view(runKey));
    expect(await screen.findByText('Monsey to Manhattan')).toBeDefined();
    rerender(view(''));
    expect(screen.getByText('Departure picker')).toBeDefined();

    expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(
      /rendered (?:more|fewer) hooks|change in the order of Hooks/i,
    );
  });

  it.each([
    ['On time', '2024-11-20T08:02:00Z'],
    ['5 min delayed', '2024-11-20T08:05:00Z'],
    ['15 min delayed', '2024-11-20T08:15:00Z'],
  ])('shows %s badge in live traffic', async (label, estimatedArrivalAt) => {
    vi.mocked(global.fetch).mockResolvedValueOnce(journeyResponse({
      stops: [stop({ estimatedArrivalAt })],
      trafficStatus: 'live',
      trafficUpdatedAt: new Date().toISOString(),
    }));

    render(view());

    expect(await screen.findAllByText(new RegExp(label, 'i'))).not.toHaveLength(0);
  });

  it('shows awaiting live update badge for forecast traffic', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(journeyResponse({
      stops: [
        stop(),
        stop({
          id: '2',
          label: 'Stop B',
          mapLabel: 'B',
          scheduledAt: null,
          estimatedArrivalAt: '2024-11-20T08:10:00Z',
        }),
      ],
      trafficUpdatedAt: '2024-11-20T07:50:00Z',
    }));

    render(view());

    expect((await screen.findAllByText(/Awaiting live update/i)).length).toBeGreaterThan(0);
  });

  it('shows live estimate when traffic is live but baseline is missing', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(journeyResponse({
      stops: [stop({ scheduledAt: null })],
      trafficStatus: 'live',
      trafficUpdatedAt: new Date().toISOString(),
    }));

    render(view());

    expect((await screen.findAllByText(/Live estimate/i)).length).toBeGreaterThan(0);
  });

  it('treats a missing optional traffic timestamp as stale', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(journeyResponse({
      stops: [stop()],
      trafficStatus: 'live',
      trafficUpdatedAt: undefined,
    }));

    render(view());

    expect((await screen.findAllByText(/Last estimate/i)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Stale Traffic/i)).length).toBeGreaterThan(0);
  });

  it('downgrades live traffic as the clock ticks without refetching', async () => {
    const initialNow = new Date('2024-11-20T12:00:00Z').getTime();
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(initialNow);
    let tickClock: (() => void) | undefined;
    vi.spyOn(window, 'setInterval').mockImplementation((handler, timeout) => {
      if (timeout === 10_000 && typeof handler === 'function') {
        tickClock = handler as () => void;
      }
      return undefined as unknown as ReturnType<typeof window.setInterval>;
    });
    vi.mocked(global.fetch).mockResolvedValueOnce(journeyResponse({
      stops: [stop()],
      trafficStatus: 'live',
      trafficUpdatedAt: new Date(initialNow - 80_000).toISOString(),
    }));

    render(view());
    expect(await screen.findByText(/Live Traffic/)).toBeDefined();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(tickClock).toBeTypeOf('function');

    dateNow.mockReturnValue(initialNow + 20_000);
    act(() => tickClock?.());

    expect(screen.getByText(/Stale Traffic/)).toBeDefined();
    expect(screen.getAllByText(/Last estimate/i).length).toBeGreaterThan(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('downgrades to stale when live traffic is already more than 90 seconds old', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(journeyResponse({
      stops: [stop()],
      trafficStatus: 'live',
      trafficUpdatedAt: new Date(Date.now() - 120_000).toISOString(),
    }));

    render(view());

    expect((await screen.findAllByText(/Last estimate/i)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Stale Traffic/i)).length).toBeGreaterThan(0);
  });
});