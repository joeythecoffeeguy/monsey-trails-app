import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PassengerDisplay from './passenger';

const liveTripMocks = vi.hoisted(() => ({
  connectPersonalPassenger: vi.fn(),
  disconnectPersonalPassenger: vi.fn(),
  disconnectPassengerDisplay: vi.fn(),
  displayBusNumber: '',
}));

vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => false }));
vi.mock('@/lib/store', () => ({
  useSettingsStore: Object.assign(
    () => ({ routeId: '' }),
    { getState: () => ({ updateSettings: vi.fn() }) },
  ),
}));
vi.mock('@/lib/arrival-chime', () => ({
  playArrivalChime: vi.fn(),
  unlockArrivalChimes: vi.fn(),
}));
vi.mock('@/lib/next-stop-trigger', () => ({
  getNextStopPhase: () => 'far',
  shouldTriggerNextStop: () => false,
}));
vi.mock('@/lib/translations', () => ({
  getTranslation: (_lang: string, key: string) => key,
  isRTL: () => false,
}));
vi.mock('@/providers/live-trip', () => ({
  connectPersonalPassenger: liveTripMocks.connectPersonalPassenger,
  disconnectPersonalPassenger: liveTripMocks.disconnectPersonalPassenger,
  disconnectPassengerDisplay: liveTripMocks.disconnectPassengerDisplay,
  getDisplayBusNumber: () => liveTripMocks.displayBusNumber,
  getPersonalRunKey: () => localStorage.getItem('personal-run') ?? '',
  getPersonalDepartureTime: () => localStorage.getItem('personal-time') ?? '',
  pairDisplayWithBus: vi.fn(),
  pairDisplayWithQrInvite: vi.fn(),
  previewPassengerQrInvite: vi.fn(),
  reportPassengerAudioStatus: vi.fn(),
  useLiveTrip: () => ({
    routeId: '',
    displayMode: 'welcome',
    rotationIntervalSeconds: 30,
    status: 'idle',
    destinationAddress: '',
    destination: null,
    intermediateStops: [],
    announcements: [],
    passengerLanguage: 'en',
    currentLocation: null,
    eta: null,
    arrivalSoundsEnabled: false,
    chimeTestRequestedAt: null,
  }),
}));
vi.mock('@/components/passenger/personal/PersonalPassengerView', () => ({
  PersonalPassengerView: (props: {
    selectedRunKey: string;
    scheduleFilters: { line: number; origin: number; destination: number; date: string };
    setScheduleFilters: (filters: { line: number; origin: number; destination: number; date: string }) => void;
    connectPassengerDisplay: (runKey: string, departure: string) => Promise<void>;
    returnToSchedule: () => void;
  }) => props.selectedRunKey ? (
    <div>
      <span>Trip {props.selectedRunKey}</span>
      <button onClick={props.returnToSchedule}>Back</button>
    </div>
  ) : (
    <div>
      <span>Schedule {JSON.stringify(props.scheduleFilters)}</span>
      <button onClick={() => props.setScheduleFilters({
        line: 3,
        origin: 7,
        destination: 9,
        date: '2026-06-14',
      })}>Change filters</button>
      <button onClick={() => void props.connectPassengerDisplay('run-1', '11:00')}>Choose run</button>
    </div>
  ),
}));

describe('personal passenger browser navigation', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    liveTripMocks.displayBusNumber = '';
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/passengers?date=2026-06-12&line=1&origin=2&destination=5');
  });

  afterEach(cleanup);

  it('returns selected trips to the same dated and filtered schedule', async () => {
    render(<PassengerDisplay experience="personal" />);
    fireEvent.click(screen.getByRole('button', { name: 'Change filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose run' }));

    expect(screen.getByText('Trip run-1')).toBeTruthy();
    expect(window.location.search).toContain('run=run-1');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => expect(screen.getByText(/"line":3/)).toBeTruthy());
    expect(screen.getByText(/"date":"2026-06-14"/)).toBeTruthy();
    expect(window.location.search).not.toContain('run=');
    expect(liveTripMocks.disconnectPersonalPassenger).toHaveBeenCalledOnce();
  });

  it('pushes one trip entry each time and handles repeated browser Back navigation', async () => {
    render(<PassengerDisplay experience="personal" />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose run' }));
    await act(async () => window.history.back());
    await waitFor(() => expect(screen.getByText(/Schedule/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Choose run' }));
    expect(screen.getByText('Trip run-1')).toBeTruthy();
    await act(async () => window.history.back());
    await waitFor(() => expect(screen.getByText(/Schedule/)).toBeTruthy());
    expect(liveTripMocks.connectPersonalPassenger).toHaveBeenCalledTimes(2);
  });

  it('seeds a schedule entry so Back works after refreshing a selected trip URL', async () => {
    window.history.replaceState({}, '', '/passengers?date=2026-06-14&line=3&origin=7&destination=9&run=run-1&departure=11%3A00');
    render(<PassengerDisplay experience="personal" />);
    expect(screen.getByText('Trip run-1')).toBeTruthy();

    await act(async () => window.history.back());
    await waitFor(() => expect(screen.getByText(/"line":3/)).toBeTruthy());
    expect(window.location.search).not.toContain('run=');
  });

  it('keeps the mounted display disconnect confirmation', async () => {
    liveTripMocks.displayBusNumber = '1234';
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<PassengerDisplay experience="mounted" />);

    fireEvent.click(screen.getByTestId('button-passenger-logout'));
    expect(confirm).toHaveBeenCalledWith('Disconnect this passenger display from the coach?');
    expect(liveTripMocks.disconnectPassengerDisplay).not.toHaveBeenCalled();
  });
});