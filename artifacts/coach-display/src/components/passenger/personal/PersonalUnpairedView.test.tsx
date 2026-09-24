import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalUnpairedView } from './PersonalUnpairedView';
import type { OfficialSchedule, OfficialScheduleRun } from '@/providers/official-schedules';

const { fetchOfficialSchedule, resolveOfficialStop, fetchPublicRunTrip, getPassengerJourney } = vi.hoisted(() => ({
  fetchOfficialSchedule: vi.fn(),
  resolveOfficialStop: vi.fn(),
  fetchPublicRunTrip: vi.fn(),
  getPassengerJourney: vi.fn(),
}));

vi.mock('@workspace/api-client-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  return { ...actual, getPassengerJourney };
});

vi.mock('@/providers/official-schedules', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/providers/official-schedules')>();
  return { ...actual, fetchOfficialSchedule, resolveOfficialStop };
});

vi.mock('@/providers/live-trip', () => ({
  useLiveTrip: () => ({ passengerLanguage: 'en' }),
  fetchPublicRunTrip,
}));

function run(id: string, scheduledTime: string): OfficialScheduleRun {
  return {
    id,
    scheduledTime,
    firstPickupTime: scheduledTime,
    arrivalTime: '12:00',
    routeCode: id,
    routeSymbol: id,
    secondarySymbol: '',
    direction: 'outbound',
    durationMinutes: 60,
    pickupDescription: `Pickup ${id}`,
    dropoffDescription: `Dropoff ${id}`,
    departureStatus: 'awaiting_departure',
    delayMinutes: null,
    displayKeys: [],
  };
}

function schedule(date: string, runs: OfficialScheduleRun[]): OfficialSchedule {
  return {
    source: 'official',
    fetchedAt: new Date().toISOString(),
    date,
    origin: { id: 2, name: 'Monsey' },
    destination: { id: 5, name: 'Manhattan' },
    keyLegend: [],
    runs,
  };
}

function renderView(connectPassengerDisplay = vi.fn().mockResolvedValue(undefined)) {
  const serviceDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  let scheduleFilters = {
    line: 1,
    origin: 2,
    destination: 5,
    date: serviceDate,
  };
  const props = {
    selectedRunKey: '',
    setSelectedRunKey: vi.fn(),
    departureTime: '',
    setDepartureTime: vi.fn(),
    connectionError: '',
    setConnectionError: vi.fn(),
    connectionBusy: false,
    connectPassengerDisplay,
    scheduleFilters,
    setScheduleFilters: vi.fn((next) => {
      scheduleFilters = next;
      props.scheduleFilters = next;
      rendered.rerender(<PersonalUnpairedView {...props} />);
    }),
  };
  const rendered = render(<PersonalUnpairedView {...props} />);
  return { ...props, connectPassengerDisplay };
}

async function flushSchedule() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('personal passenger official schedules', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Friday at 10:00 AM in New York.
    vi.setSystemTime(new Date('2026-06-12T14:00:00.000Z'));
    fetchOfficialSchedule.mockReset();
    resolveOfficialStop.mockReset();
    fetchPublicRunTrip.mockReset();
    fetchPublicRunTrip.mockResolvedValue(null);
    getPassengerJourney.mockReset();
    getPassengerJourney.mockRejectedValue(new Error('Journey unavailable'));
    resolveOfficialStop.mockResolvedValue({
      label: 'Pickup exact-run',
      lat: 41.1112,
      lng: -74.0685,
    });
    fetchOfficialSchedule.mockImplementation((_line, _origin, _destination, date: string) =>
      Promise.resolve(schedule(date, [run('elapsed', '09:00'), run('exact-run', '11:00')])),
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('defaults to upcoming departures today and retains the exact official run identity', async () => {
    const props = renderView();
    await flushSchedule();

    expect(screen.getByRole('button', { name: 'Upcoming' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('9:00 AM')).toBeNull();
    fireEvent.click(screen.getByText('11:00 AM'));

    expect(props.connectPassengerDisplay).toHaveBeenCalledWith(
      '2026-06-12|1|2|5|exact-run',
      '11:00',
    );
  });

  it('opens a verified map preview without selecting the trip', async () => {
    const props = renderView();
    await flushSchedule();

    fireEvent.click(screen.getByTestId('button-map-pickup-stop-exact-run-11:00-0-1'));
    await flushSchedule();

    expect(resolveOfficialStop).toHaveBeenCalledWith('Pickup exact-run', 2);
    const pickupMap = screen.getByAltText('Map around Pickup exact-run') as HTMLImageElement;
    expect(pickupMap.src).toContain('/api/map-tiles/18/');
    expect(props.connectPassengerDisplay).not.toHaveBeenCalled();
    expect(screen.getByTestId('dropoff-route-exact-run-11:00-0')).toBeTruthy();

    resolveOfficialStop.mockResolvedValue({
      label: 'Dropoff exact-run',
      lat: 40.7577,
      lng: -73.9787,
    });
    fireEvent.click(screen.getByTestId('button-map-dropoff-stop-exact-run-11:00-0-1'));
    await flushSchedule();

    expect(resolveOfficialStop).toHaveBeenLastCalledWith('Dropoff exact-run', 5);
    expect(screen.getByAltText('Map around Dropoff exact-run')).toBeTruthy();
  });

  it('shows live pickup departure and drop-off arrival on the main departure card', async () => {
    getPassengerJourney.mockResolvedValue({
      serviceDate: '2026-06-12',
      originName: 'Monsey',
      destinationName: 'Manhattan',
      scheduledDepartureAt: '2026-06-12T15:00:00.000Z',
      scheduledArrivalAt: '2026-06-12T16:00:00.000Z',
      arrivalVerification: 'verified',
      trafficStatus: 'live',
      trafficUpdatedAt: '2026-06-12T14:00:00.000Z',
      routeGeometry: [],
      stops: [
        { id: 'pickup-1', label: 'Pickup exact-run', lat: 41.1, lng: -74.1, kind: 'pickup', scheduledAt: null, estimatedArrivalAt: null },
        { id: 'dropoff-1', label: 'Dropoff exact-run', lat: 40.7, lng: -74, kind: 'dropoff', scheduledAt: null, estimatedArrivalAt: null },
      ],
    });
    fetchPublicRunTrip.mockResolvedValue({
      journeyProgress: [
        { id: 'pickup-1', address: 'Pickup exact-run', lat: 41.1, lng: -74.1, eta: null, status: 'completed', kind: 'pickup' },
        { id: 'dropoff-1', address: 'Dropoff exact-run', lat: 40.7, lng: -74, eta: null, status: 'completed', kind: 'dropoff' },
      ],
    });

    renderView();
    await flushSchedule();

    expect(screen.getByText('Departed')).toBeTruthy();
    expect(screen.getByText('Arrived')).toBeTruthy();
  });

  it('expands exact-run stops, labels time evidence honestly, and links the verified waiting pin', async () => {
    window.localStorage.setItem('monsey-passenger-history-v1', JSON.stringify({
      favorites: [{
        runKey: '2026-06-12|1|2|5|exact-run',
        departureTime: '11:00',
        filters: { line: 1, origin: 2, destination: 5, date: '2026-06-12' },
        savedAt: '2026-06-12T13:00:00.000Z',
      }],
      recent: [],
    }));
    getPassengerJourney.mockResolvedValue({
      runKey: '2026-06-12|1|2|5|exact-run',
      serviceDate: '2026-06-12',
      originName: 'Monsey',
      destinationName: 'Manhattan',
      scheduledDepartureAt: '2026-06-12T15:00:00.000Z',
      scheduledArrivalAt: '2026-06-12T16:00:00.000Z',
      arrivalVerification: 'verified',
      trafficStatus: 'live',
      trafficUpdatedAt: '2026-06-12T14:00:00.000Z',
      routeGeometry: [],
      message: null,
      stops: [
        {
          id: 'pickup-verified',
          label: 'Route 59 & Route 45',
          note: 'Wait at the marked shelter',
          mapLabel: 'A',
          lat: 41.1087,
          lng: -74.0422,
          kind: 'pickup',
          scheduledAt: '2026-06-12T15:00:00.000Z',
          estimatedArrivalAt: '2026-06-12T15:02:00.000Z',
        },
        {
          id: 'dropoff-estimate',
          label: '5th Avenue & 47th Street',
          mapLabel: 'B',
          lat: 40.7565,
          lng: -73.9787,
          kind: 'dropoff',
          scheduledAt: null,
          estimatedArrivalAt: '2026-06-12T16:05:00.000Z',
        },
      ],
    });
    const stopSelection = vi.fn();
    const serviceDate = '2026-06-12';
    const props = {
      selectedRunKey: '',
      setSelectedRunKey: vi.fn(),
      departureTime: '',
      setDepartureTime: vi.fn(),
      connectionError: '',
      setConnectionError: vi.fn(),
      connectionBusy: false,
      connectPassengerDisplay: vi.fn().mockResolvedValue(undefined),
      scheduleFilters: { line: 1, origin: 2, destination: 5, date: serviceDate },
      setScheduleFilters: vi.fn(),
      onStopSelection: stopSelection,
    };
    render(<PersonalUnpairedView {...props} />);
    await flushSchedule();

    await flushSchedule();
    await flushSchedule();
    expect(screen.getByLabelText('Exact pickup stop').querySelectorAll('option')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Exact pickup stop'), {
      target: { value: 'pickup|41.10870|-74.04220|route 59 route 45' },
    });
    fireEvent.change(screen.getByLabelText('Exact drop-off stop'), {
      target: { value: 'dropoff|40.75650|-73.97870|5th avenue 47th street' },
    });
    expect(stopSelection).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('11:00 AM'));
    await flushSchedule();
    expect(stopSelection).toHaveBeenCalledWith(expect.objectContaining({
      runKey: '2026-06-12|1|2|5|exact-run',
      pickup: expect.objectContaining({ id: 'pickup-verified' }),
      dropoff: expect.objectContaining({ id: 'dropoff-estimate' }),
    }));
    const savedHistory = JSON.parse(window.localStorage.getItem('monsey-passenger-history-v1') ?? '{}');
    expect(savedHistory.recent[0]).toMatchObject({
      runKey: '2026-06-12|1|2|5|exact-run',
      pickupStop: { id: 'pickup-verified', label: 'Route 59 & Route 45' },
      dropoffStop: { id: 'dropoff-estimate', label: '5th Avenue & 47th Street' },
    });
    expect(savedHistory.favorites[0]).toMatchObject({
      runKey: '2026-06-12|1|2|5|exact-run',
    });
    expect(savedHistory.favorites[0].pickupStop).toBeUndefined();
    expect(savedHistory.favorites[0].dropoffStop).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: /Stops & boarding/ }));
    expect(screen.getByText('Scheduled 11:00 AM')).toBeTruthy();
    expect(screen.getByText('GPS est. 12:05 PM')).toBeTruthy();
    fireEvent.click(screen.getByTestId('button-map-pickup-stop-exact-run-11:00-0-1'));
    await flushSchedule();
    expect(screen.getByText('Where do I wait?')).toBeTruthy();
    expect(screen.getByText('Wait at the marked shelter')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open map/ }).getAttribute('href')).toContain('41.1087%2C-74.0422');
    expect(resolveOfficialStop).not.toHaveBeenCalledWith('Route 59 & Route 45', 2);
  });

  it('filters before run selection by verified membership and pickup-before-drop-off order only', async () => {
    fetchOfficialSchedule.mockImplementation((_line, _origin, _destination, date: string) =>
      Promise.resolve(schedule(date, [
        run('serves-both', '11:00'),
        run('wrong-pickup', '12:00'),
        run('reversed', '13:00'),
        run('unresolved', '14:00'),
      ])),
    );
    const stop = (
      id: string,
      label: string,
      kind: 'pickup' | 'dropoff',
      lat: number,
      lng: number,
    ) => ({ id, label, kind, lat, lng, mapLabel: id, scheduledAt: null, estimatedArrivalAt: null });
    getPassengerJourney.mockImplementation((request: { runId: string }) => {
      const runKey = `2026-06-12|1|2|5|${request.runId}`;
      if (request.runId === 'unresolved') return Promise.reject(new Error('route verification unavailable'));
      const sharedPickup = stop('pickup-a', 'Pickup A', 'pickup', 41.1, -74.1);
      const sharedDropoff = stop('dropoff-b', 'Drop-off B', 'dropoff', 40.7, -74);
      const stops = request.runId === 'serves-both'
        ? [sharedPickup, sharedDropoff]
        : request.runId === 'wrong-pickup'
          ? [stop('pickup-x', 'Pickup X', 'pickup', 41.2, -74.2), sharedDropoff]
          : [sharedDropoff, sharedPickup];
      return Promise.resolve({
        runKey,
        serviceDate: '2026-06-12',
        originName: 'Monsey',
        destinationName: 'Manhattan',
        scheduledDepartureAt: null,
        scheduledArrivalAt: null,
        arrivalVerification: 'unavailable',
        trafficStatus: 'unavailable',
        trafficUpdatedAt: null,
        routeGeometry: [],
        message: null,
        stops,
      });
    });

    renderView();
    await flushSchedule();
    await flushSchedule();
    expect(screen.getByText(/Exact stops could not be verified for 1 run/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Exact pickup stop'), {
      target: { value: 'pickup|41.10000|-74.10000|pickup a' },
    });
    fireEvent.change(screen.getByLabelText('Exact drop-off stop'), {
      target: { value: 'dropoff|40.70000|-74.00000|drop off b' },
    });

    expect(screen.getByText('11:00 AM')).toBeTruthy();
    expect(screen.queryByText('12:00 PM')).toBeNull();
    expect(screen.queryByText('1:00 PM')).toBeNull();
    expect(screen.queryByText('2:00 PM')).toBeNull();
    expect(screen.getByText('Those runs are not included in these results.', { exact: false })).toBeTruthy();
  });

  it('keeps optional trip notes out of the compact schedule card', async () => {
    const notedRun = {
      ...run('noted', '11:00'),
      pickupNote: 'Across from Ohr Sameach by the marked passenger entrance and waiting area',
      dropoffNote: 'Dropoff noted',
      dropoffDescription: 'Dropoff noted',
    };
    fetchOfficialSchedule.mockImplementation((_line, _origin, _destination, date: string) =>
      Promise.resolve(schedule(date, [notedRun])),
    );

    renderView();
    await flushSchedule();

    expect(screen.queryByText(notedRun.pickupNote)).toBeNull();
    expect(screen.getAllByText('Dropoff noted')).toHaveLength(1);
  });

  it('shows all published runs on a selected future date', async () => {
    renderView();
    await flushSchedule();

    fireEvent.click(screen.getByRole('button', { name: 'Next date' }));
    await flushSchedule();

    expect(fetchOfficialSchedule).toHaveBeenCalledWith(1, 2, 5, '2026-06-13');
    expect(screen.getByText('9:00 AM')).toBeTruthy();
    expect(screen.getByText('11:00 AM')).toBeTruthy();
    expect(screen.getAllByText('Awaiting departure')).toHaveLength(2);
    expect(screen.queryByText('On schedule')).toBeNull();
  });

  it('shows earlier and completed runs in All departures', async () => {
    fetchOfficialSchedule.mockImplementation((_line, _origin, _destination, date: string) =>
      Promise.resolve(schedule(date, [
        run('elapsed', '09:00'),
        { ...run('completed', '09:30'), departureStatus: 'completed' },
        run('upcoming', '11:00'),
      ])),
    );
    renderView();
    await flushSchedule();

    expect(screen.queryByText('9:00 AM')).toBeNull();
    expect(screen.queryByText('9:30 AM')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All departures' }));

    expect(screen.getByText('9:00 AM')).toBeTruthy();
    expect(screen.getByText('9:30 AM')).toBeTruthy();
    expect(screen.getByText('Arrived')).toBeTruthy();
    expect(screen.getByText('11:00 AM')).toBeTruthy();
  });

  it('allows previous dates, automatically shows their full schedule, and does not advance them', async () => {
    renderView();
    await flushSchedule();

    fireEvent.click(screen.getByRole('button', { name: 'Previous date' }));
    await flushSchedule();

    expect(fetchOfficialSchedule).toHaveBeenCalledWith(1, 2, 5, '2026-06-11');
    expect(screen.getByRole('button', { name: 'Choose date' }).textContent).toContain('Thu, Jun 11');
    expect(screen.getByRole('button', { name: 'All departures' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('9:00 AM')).toBeTruthy();
    expect(screen.getByText('11:00 AM')).toBeTruthy();
  });

  it('renders and selects the observed Saturday overnight 24-hour departure', async () => {
    vi.setSystemTime(new Date('2026-09-18T14:00:00.000Z'));
    fetchOfficialSchedule.mockImplementation((_line, _origin, destination: number, date: string) =>
      Promise.resolve(schedule(date, destination === 3 ? [{
        ...run('120', '24:15:00'),
        firstPickupTime: '23:50:00',
        arrivalTime: '2026-09-20T05:40:00.000000Z',
        routeCode: 'N1XBHX',
      }] : [])),
    );
    const props = renderView();
    await flushSchedule();

    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next date' }));
    await flushSchedule();

    expect(fetchOfficialSchedule).toHaveBeenCalledWith(1, 2, 3, '2026-09-19');
    fireEvent.click(screen.getByText('12:15 AM (Sun)'));
    expect(props.connectPassengerDisplay).toHaveBeenCalledWith(
      '2026-09-19|1|2|3|120',
      '24:15:00',
    );
  });

  it('shows the scheduled arrival beside departure and applies a GPS delay estimate', async () => {
    fetchOfficialSchedule.mockImplementation((_line, _origin, destination: number, date: string) =>
      Promise.resolve(schedule(date, destination === 5 ? [{
        ...run('gps-run', '09:00:00'),
        arrivalTime: '2026-06-12T14:30:00.000000Z',
        arrivalVerification: 'verified',
        departureStatus: 'delayed',
        delayMinutes: 12,
      }] : [])),
    );

    renderView();
    await flushSchedule();

    expect(screen.getByTestId('arrival-estimate-gps-run').textContent)
      .toBe('→ arrives 10:42 AM GPS est.');
  });

  it('shows the truthful empty schedule message on Friday without moving to tomorrow', async () => {
    fetchOfficialSchedule.mockResolvedValue(schedule('2026-06-12', []));
    renderView();
    await flushSchedule();

    expect(screen.getByText('No available destinations for this date')).toBeTruthy();
    expect(fetchOfficialSchedule).toHaveBeenCalledTimes(6);
    expect(screen.getByRole('button', { name: 'Choose date' }).textContent).toContain('Fri, Jun 12');
  });

  it('distinguishes an exhausted day from a date with no published runs', async () => {
    fetchOfficialSchedule.mockResolvedValue(schedule('2026-06-12', [run('elapsed', '09:00')]));
    renderView();
    await flushSchedule();

    expect(screen.getByText('No more departures today')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All departures' })).toBeTruthy();
  });

  it('selects a date from the monthly calendar and preserves it', async () => {
    renderView();
    await flushSchedule();

    fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));
    fireEvent.click(screen.getByRole('button', { name: /Sunday, June 14/ }));
    await flushSchedule();

    expect(fetchOfficialSchedule).toHaveBeenCalledWith(1, 2, 5, '2026-06-14');
    expect(screen.getByRole('button', { name: 'Choose date' }).textContent).toContain('Sun, Jun 14');
  });

  it('rechecks the departure instant when a previously visible run is clicked', async () => {
    const props = renderView();
    await flushSchedule();

    vi.setSystemTime(new Date('2026-06-12T15:01:00.000Z'));
    fireEvent.click(screen.getByText('11:00 AM'));

    expect(props.connectPassengerDisplay).not.toHaveBeenCalled();
    expect(props.setConnectionError).toHaveBeenCalledWith(
      'That departure has already left. Please choose another time.',
    );
  });

  it('shows an explicit error for a malformed published time without crashing', async () => {
    fetchOfficialSchedule.mockResolvedValue(schedule('2026-06-12', [{
      ...run('bad-time', 'not-a-time'),
      departureStatus: 'unavailable',
    }]));
    const props = renderView();
    await flushSchedule();

    fireEvent.click(screen.getByText('Time unavailable'));

    expect(props.connectPassengerDisplay).not.toHaveBeenCalled();
    expect(props.setConnectionError).toHaveBeenCalledWith(
      'This departure has an invalid published time. Please choose another departure.',
    );
  });

  it('keeps a delayed active departure visible after its published time', async () => {
    fetchOfficialSchedule.mockResolvedValue(schedule('2026-06-12', [
      { ...run('late-running', '09:00'), departureStatus: 'delayed', delayMinutes: 5 },
      { ...run('completed', '09:15'), departureStatus: 'completed', delayMinutes: null },
    ]));
    const props = renderView();
    await flushSchedule();

    expect(screen.getByText('9:00 AM')).toBeTruthy();
    expect(screen.getByText('5 min delayed')).toBeTruthy();
    expect(screen.queryByText('9:15 AM')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All departures' }));
    expect(screen.getByText('9:15 AM')).toBeTruthy();
    expect(screen.getByText('Arrived')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Upcoming' }));
    fireEvent.click(screen.getByText('9:00 AM'));
    expect(props.connectPassengerDisplay).toHaveBeenCalledWith(
      '2026-06-12|1|2|5|late-running',
      '09:00',
    );
  });

  it('labels today’s unassigned published times as on schedule', async () => {
    renderView();
    await flushSchedule();
    expect(screen.getByText('On schedule')).toBeTruthy();
    expect(screen.queryByText('Awaiting departure')).toBeNull();
  });

  it('keeps destinations with past-only departures accessible', async () => {
    fetchOfficialSchedule.mockImplementation((_line, _origin, destination: number, date: string) =>
      Promise.resolve(schedule(
        date,
        destination === 3 ? [run('boro-park', '11:00')] : destination === 5 ? [run('manhattan-history', '09:00')] : [],
      )),
    );
    const props = renderView();
    await flushSchedule();

    const destinations = screen.getByRole('combobox', { name: 'Destination' });
    expect([...destinations.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['Boro Park', 'Manhattan']);
    expect((destinations as HTMLSelectElement).value).toBe('5');
    expect(props.setScheduleFilters).not.toHaveBeenCalledWith(expect.objectContaining({ destination: 3 }));
    fireEvent.click(screen.getByRole('button', { name: 'All departures' }));
    expect(screen.getByText('9:00 AM')).toBeTruthy();
  });

  it('keeps destination history accessible when changing dates', async () => {
    fetchOfficialSchedule.mockImplementation((_line, _origin, destination: number, date: string) =>
      Promise.resolve(schedule(
        date,
        destination === 3 || (destination === 5 && date === '2026-06-13')
          ? [run(`${destination}-${date}`, '11:00')]
          : [],
      )),
    );
    renderView();
    await flushSchedule();
    const destinations = screen.getByRole('combobox', { name: 'Destination' });
    expect([...destinations.querySelectorAll('option')].map((option) => option.textContent)).toContain('Boro Park');

    fireEvent.click(screen.getByRole('button', { name: 'Next date' }));
    await flushSchedule();

    expect(screen.getByRole('button', { name: 'Choose date' }).textContent).toContain('Sat, Jun 13');
    expect([...destinations.querySelectorAll('option')].map((option) => option.textContent)).toContain('Manhattan');
  });

  it('keeps a still-available destination selected across availability polls', async () => {
    fetchOfficialSchedule.mockImplementation((_line, _origin, destination: number, date: string) =>
      Promise.resolve(schedule(
        date,
        destination === 3 || destination === 4 ? [run(`${destination}-run`, '11:00')] : [],
      )),
    );
    const props = renderView();
    await flushSchedule();

    const destinations = screen.getByRole('combobox', { name: 'Destination' }) as HTMLSelectElement;
    expect(destinations.value).toBe('3');
    fireEvent.change(destinations, { target: { value: '4' } });
    expect(destinations.value).toBe('4');
    props.setScheduleFilters.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(destinations.value).toBe('4');
    expect(props.setScheduleFilters).not.toHaveBeenCalled();
  });

  it('keeps the last good schedule visible when a poll fails and retries explicitly', async () => {
    const props = renderView();
    await flushSchedule();
    fireEvent.click(screen.getByText('11:00 AM'));

    fetchOfficialSchedule.mockRejectedValue(new Error('temporary upstream failure'));
    await act(async () => {
      vi.advanceTimersByTime(30_000);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Schedule could not be refreshed. Times shown may not be up to date.')).toBeTruthy();
    expect(screen.getByText('11:00 AM')).toBeTruthy();

    fetchOfficialSchedule.mockImplementation((_line, _origin, _destination, date: string) =>
      Promise.resolve(schedule(date, [run('replacement', '12:00')])),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry schedule' }));
    await flushSchedule();

    expect(screen.queryByText('Schedule could not be refreshed. Times shown may not be up to date.')).toBeNull();
    expect(screen.queryByText('11:00 AM')).toBeNull();
    expect(screen.getByText('12:00 PM')).toBeTruthy();
    expect(props.setSelectedRunKey).toHaveBeenLastCalledWith('');
    expect(props.setDepartureTime).toHaveBeenLastCalledWith('');
  });

  it('reports availability lookup failures instead of silently claiming no service', async () => {
    fetchOfficialSchedule.mockRejectedValue(new Error('network down'));
    renderView();
    await flushSchedule();

    expect(screen.getByText(/Some destinations could not be checked/)).toBeTruthy();
    expect(screen.queryByText('No available destinations for this date')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry availability' })).toBeTruthy();
  });
});