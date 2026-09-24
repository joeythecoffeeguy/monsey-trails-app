import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PassengerDisplay from './passenger';
import { useSettingsStore } from '@/lib/store';

const { disconnectPassengerDisplay, displayState, enterDevelopmentDisplayPreview, exitDevelopmentDisplayPreview, liveTripState, pairDisplayWithBus, pairDisplayWithQrInvite, playArrivalChime, previewPassengerQrInvite, reportPassengerAudioStatus, unlockArrivalChimes } = vi.hoisted(() => ({
  disconnectPassengerDisplay: vi.fn(),
  enterDevelopmentDisplayPreview: vi.fn(),
  exitDevelopmentDisplayPreview: vi.fn(),
  displayState: { busNumber: '1047' },
  liveTripState: {
    status: 'idle' as 'idle' | 'ready' | 'running' | 'stopped',
    emergencyOverride: false,
    emergencyMessage: '',
    routeId: 'route-1',
    displayMode: 'auto',
    passengerLanguage: 'en',
    rotationIntervalSeconds: 1,
    arrivalSoundsEnabled: true,
    startedAt: '2026-09-16T12:00:00.000Z',
    intermediateStops: [] as Array<{ id: string; address: string; lat: number; lng: number; eta: string | null }>,
    destination: null as { lat: number; lng: number } | null,
    destinationAddress: '',
    currentLocation: null as { lat: number; lng: number } | null,
    totalDistanceMiles: null as number | null,
    remainingDistanceMiles: null as number | null,
    routeGeometry: [] as Array<{ lat: number; lng: number }>,
    eta: null as string | null,
    announcements: [] as Array<{ id: string; title: string; message: string; active: boolean }>,
  },
  playArrivalChime: vi.fn(() => Promise.resolve(true)),
  previewPassengerQrInvite: vi.fn(() => Promise.resolve({
    busNumber: '9923',
    expiresAt: '2026-09-17T21:00:00.000Z',
  })),
  pairDisplayWithQrInvite: vi.fn(() => Promise.resolve({
    busNumber: '9923',
    pairingCode: '1047',
    trip: {},
  })),
  pairDisplayWithBus: vi.fn(),
  unlockArrivalChimes: vi.fn(() => Promise.resolve(true)),
  reportPassengerAudioStatus: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/providers/live-trip', () => ({
  disconnectPassengerDisplay,
  enterDevelopmentDisplayPreview,
  exitDevelopmentDisplayPreview,
  getDisplayBusNumber: () => displayState.busNumber,
  getPersonalBusNumber: () => '9923',
  pairDisplayWithBus,
  pairDisplayWithQrInvite,
  previewPassengerQrInvite,
  reportPassengerAudioStatus,
  useLiveTrip: () => liveTripState,
  useLiveTripRefreshStatus: () => ({ isRefreshing: false, lastRefreshFailed: false }),
}));

vi.mock('@/lib/arrival-chime', () => ({
  playArrivalChime,
  unlockArrivalChimes,
}));

vi.mock('@/components/passenger/Header', () => ({
  Header: ({ activeMode }: { activeMode: string }) => <div data-testid="active-mode">{activeMode}</div>,
}));
vi.mock('@/components/passenger/Footer', () => ({ Footer: () => <div>Footer</div> }));
vi.mock('@/components/passenger/EmergencyOverlay', () => ({ EmergencyOverlay: () => null }));
vi.mock('@/components/passenger/views/WelcomeView', () => ({ WelcomeView: () => <div>Welcome slide</div> }));
vi.mock('@/components/passenger/views/MapProgressView', () => ({
  MapProgressView: () => <div>Map slide</div>,
  focusRouteGeometry: (geo: any) => geo,
}));
vi.mock('@/components/passenger/views/LiveCoachMap', () => ({
  LiveCoachMap: () => <div data-testid="personal-live-map" />,
}));
vi.mock('@/components/passenger/views/WeatherView', () => ({ WeatherView: () => <div>Weather slide</div> }));
vi.mock('@/components/passenger/views/TrafficView', () => ({ TrafficView: () => <div>Traffic slide</div> }));
vi.mock('@/components/passenger/views/DailyDafView', () => ({ DailyDafView: () => <div>Daf slide</div> }));
vi.mock('@/components/passenger/views/JewishCalendarView', () => ({
  JewishCalendarView: () => <div>Calendar slide</div>,
}));
vi.mock('@/components/passenger/views/SafetyBriefingView', () => ({
  SafetyBriefingView: () => <div>Safety slide</div>,
}));

let mockIsMounted = true;
vi.mock('@/hooks/use-media-query', () => ({
  useMediaQuery: () => mockIsMounted,
}));

describe('PassengerDisplay rotation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockIsMounted = true;
    displayState.busNumber = '1047';
    Object.assign(liveTripState, {
      status: 'idle',
      displayMode: 'auto',
      intermediateStops: [],
      destination: null,
      destinationAddress: '',
      currentLocation: null,
      eta: null,
      arrivalSoundsEnabled: true,
      passengerLanguage: 'en',
      startedAt: '2026-09-16T12:00:00.000Z',
      announcements: [
        {
          id: 'active-update',
          title: 'Active service update',
          message: 'This announcement must survive the rotation.',
          active: true,
        },
      ],
    });
    playArrivalChime.mockReset();
    playArrivalChime.mockResolvedValue(true);
    unlockArrivalChimes.mockReset();
    unlockArrivalChimes.mockResolvedValue(true);
    reportPassengerAudioStatus.mockClear();
    disconnectPassengerDisplay.mockClear();
    previewPassengerQrInvite.mockClear();
    pairDisplayWithQrInvite.mockClear();
    pairDisplayWithBus.mockClear();
    enterDevelopmentDisplayPreview.mockClear();
    exitDevelopmentDisplayPreview.mockClear();
    window.history.replaceState({}, '', '/');
    useSettingsStore.setState({
      displayMode: 'auto',
      rotationIntervalSeconds: 1,
    });
  });

  it('keeps passenger logout discreet and requires confirmation', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<PassengerDisplay />);

    const logout = screen.getByTestId('button-passenger-logout');
    expect(logout.getAttribute('aria-label')).toBe('Disconnect passenger display');
    expect(logout.className).toContain('opacity-[0.12]');
    fireEvent.click(logout);

    expect(confirm).toHaveBeenCalledOnce();
    expect(disconnectPassengerDisplay).toHaveBeenCalledOnce();
    confirm.mockRestore();
  });

  it('opens and exits the mounted development preview with code 5100 without pairing', () => {
    displayState.busNumber = '';
    render(<PassengerDisplay experience="mounted" />);

    fireEvent.click(screen.getByRole('button', { name: 'Open development display preview' }));
    const code = screen.getByLabelText('Development preview code');
    expect(code.getAttribute('type')).toBe('password');
    fireEvent.change(code, { target: { value: '5100' } });
    fireEvent.submit(code.closest('form')!);

    expect(enterDevelopmentDisplayPreview).toHaveBeenCalledOnce();
    expect(pairDisplayWithBus).not.toHaveBeenCalled();
    expect(reportPassengerAudioStatus).not.toHaveBeenCalled();
    expect(screen.getByText('Development preview · demo data')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Exit preview' }));
    expect(exitDevelopmentDisplayPreview).toHaveBeenCalled();
    expect(screen.getByText('Bus-Mounted Passenger Display')).toBeTruthy();
    expect(disconnectPassengerDisplay).not.toHaveBeenCalled();
  });

  it('offers administrator sign-in without requiring a pairing code', () => {
    displayState.busNumber = '';
    render(<PassengerDisplay experience="mounted" />);

    const signIn = screen.getByRole('link', { name: 'Administrator sign-in' });
    expect(signIn.getAttribute('href')).toContain('/sign-in?redirect_url=');
    expect(decodeURIComponent(signIn.getAttribute('href') ?? '')).toContain('redirect_url=/admin/display');
  });

  it('clears an incorrect development code and keeps the display unpaired', () => {
    displayState.busNumber = '';
    render(<PassengerDisplay experience="mounted" />);

    fireEvent.click(screen.getByRole('button', { name: 'Open development display preview' }));
    const code = screen.getByLabelText('Development preview code') as HTMLInputElement;
    fireEvent.change(code, { target: { value: '1234' } });
    fireEvent.submit(code.closest('form')!);

    expect(screen.getByRole('alert').textContent).toContain('Incorrect development code');
    expect(code.value).toBe('');
    expect(enterDevelopmentDisplayPreview).not.toHaveBeenCalled();
    expect(pairDisplayWithBus).not.toHaveBeenCalled();
  });

  it('cancels the development unlock without changing pairing state', () => {
    displayState.busNumber = '';
    render(<PassengerDisplay experience="mounted" />);

    fireEvent.click(screen.getByRole('button', { name: 'Open development display preview' }));
    fireEvent.change(screen.getByLabelText('Development preview code'), { target: { value: '5100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(enterDevelopmentDisplayPreview).not.toHaveBeenCalled();
    expect(screen.getByText('Bus-Mounted Passenger Display')).toBeTruthy();
  });

  it('does not expose the preview unlock outside development builds', () => {
    vi.stubEnv('DEV', false);
    displayState.busNumber = '';

    render(<PassengerDisplay experience="mounted" />);

    expect(screen.queryByRole('button', { name: 'Open development display preview' })).toBeNull();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('includes shown announcements in the automatic rotation', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = render(<PassengerDisplay />);

    expect(screen.getByTestId('active-mode').textContent).toBe('welcome');

    for (const expectedMode of [
      'weather',
      'traffic',
      'daf',
      'jewish-calendar',
      'announcements',
      'destinations-info',
      'fares-info',
      'passenger-guide',
      'contact-info',
    ]) {
      act(() => vi.advanceTimersByTime(1_000));
      expect(screen.getByTestId('active-mode').textContent).toBe(expectedMode);
      if (expectedMode === 'announcements') {
        expect(screen.getByText('Active service update')).toBeTruthy();
      }
    }

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByTestId('active-mode').textContent).toBe('charging-amenities');
    expect(screen.getByText('Power is within reach')).toBeTruthy();

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByTestId('active-mode').textContent).toBe('safety');
    expect(screen.getByText('Safety slide')).toBeTruthy();

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByTestId('active-mode').textContent).toBe('welcome');
    expect(container.querySelector('.passenger-screen')).not.toBeNull();

    const reactFailures = consoleError.mock.calls
      .flat()
      .map(String)
      .filter((message) =>
        /getSnapshot|maximum update depth|infinite loop/i.test(message),
      );
    expect(reactFailures).toEqual([]);
  });

  it('shows passenger information only when the driver explicitly selects it', () => {
    liveTripState.displayMode = 'passenger-guide';
    render(<PassengerDisplay />);

    expect(screen.getByTestId('active-mode').textContent).toBe('passenger-guide');
    expect(screen.getByText('Passenger guide')).toBeTruthy();

    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByTestId('active-mode').textContent).toBe('passenger-guide');
  });

  it('shows the charging amenities when the driver selects them', () => {
    liveTripState.displayMode = 'charging-amenities';
    render(<PassengerDisplay />);

    expect(screen.getByTestId('active-mode').textContent).toBe('charging-amenities');
    expect(screen.getByText('Power is within reach')).toBeTruthy();
    expect(screen.getByText('Overhead USB')).toBeTruthy();
    expect(screen.getByText('Outlet + USB panel')).toBeTruthy();
  });

  it('only includes the route map after a route is configured', () => {
    const { rerender } = render(<PassengerDisplay />);

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByTestId('active-mode').textContent).toBe('weather');

    Object.assign(liveTripState, {
      status: 'ready',
      destinationAddress: 'Midtown Manhattan',
      destination: { lat: 40.75, lng: -73.99 },
    });
    rerender(<PassengerDisplay />);
    act(() => vi.advanceTimersByTime(11_000));
    expect(screen.getByTestId('active-mode').textContent).toBe('welcome');
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByTestId('active-mode').textContent).toBe('map');
  });

  it('keeps hidden announcements out of main slides but available in Announcements Only', () => {
    liveTripState.announcements = [{
      id: 'optional-update',
      title: 'Optional service update',
      message: 'Only show this when the driver asks for announcements.',
      active: false,
    }];
    const { rerender } = render(<PassengerDisplay />);

    for (const expectedMode of [
      'weather',
      'traffic',
      'daf',
      'jewish-calendar',
      'destinations-info',
      'fares-info',
      'passenger-guide',
      'contact-info',
      'charging-amenities',
      'safety',
    ]) {
      act(() => vi.advanceTimersByTime(1_000));
      expect(screen.getByTestId('active-mode').textContent).toBe(expectedMode);
    }
    expect(screen.queryByText('Optional service update')).toBeNull();

    liveTripState.displayMode = 'announcements';
    rerender(<PassengerDisplay />);
    expect(screen.getByTestId('active-mode').textContent).toBe('announcements');
    expect(screen.getByText('Optional service update')).toBeTruthy();
  });

  it('interrupts rotation near a stop and resumes it after that stop is cleared', () => {
    Object.assign(liveTripState, {
      status: 'running',
      currentLocation: { lat: 40.7128, lng: -74.006 },
      intermediateStops: [{
        id: 'next-stop',
        address: '18th Avenue & 49th Street',
        lat: 40.7129,
        lng: -74.006,
        eta: new Date(Date.now() + 60_000).toISOString(),
      }],
    });
    const { rerender } = render(<PassengerDisplay />);

    expect(screen.getByTestId('active-mode').textContent).toBe('next-stop');

    Object.assign(liveTripState, {
      currentLocation: { lat: 40.75, lng: -74.006 },
      intermediateStops: [],
      destination: { lat: 40.8, lng: -74.006 },
      destinationAddress: 'Monsey',
      eta: new Date(Date.now() + 20 * 60_000).toISOString(),
    });
    rerender(<PassengerDisplay />);

    expect(screen.getByTestId('active-mode').textContent).toBe('welcome');
  });

  it('hides stale next-stop data after a trip is stopped', () => {
    Object.assign(liveTripState, {
      status: 'stopped',
      displayMode: 'next-stop',
      destination: { lat: 40.668, lng: -73.942 },
      destinationAddress: 'Empire Boulevard & Kingston Avenue',
      intermediateStops: [{
        id: 'stale-stop',
        address: 'Empire Boulevard & Kingston Avenue',
        lat: 40.668,
        lng: -73.942,
        eta: null,
      }],
    });

    render(<PassengerDisplay />);

    expect(screen.getByTestId('active-mode').textContent).toBe('welcome');
    expect(screen.getByText('Welcome slide')).toBeTruthy();
  });

  it('plays each stop phase once and honors mute without catch-up sounds', () => {
    Object.assign(liveTripState, {
      status: 'running',
      currentLocation: { lat: 40.7128, lng: -74.006 },
      intermediateStops: [{
        id: 'sound-stop',
        address: '18th Avenue & 49th Street',
        lat: 40.717,
        lng: -74.006,
        eta: new Date(Date.now() + 90_000).toISOString(),
      }],
    });
    const { rerender } = render(<PassengerDisplay />);

    expect(playArrivalChime).toHaveBeenCalledTimes(1);
    expect(playArrivalChime).toHaveBeenLastCalledWith('approaching');

    rerender(<PassengerDisplay />);
    expect(playArrivalChime).toHaveBeenCalledTimes(1);

    Object.assign(liveTripState, {
      currentLocation: { lat: 40.7165, lng: -74.006 },
    });
    rerender(<PassengerDisplay />);
    expect(playArrivalChime).toHaveBeenCalledTimes(2);
    expect(playArrivalChime).toHaveBeenLastCalledWith('arriving');

    Object.assign(liveTripState, {
      arrivalSoundsEnabled: false,
      startedAt: '2026-09-16T13:00:00.000Z',
      intermediateStops: [{
        id: 'muted-stop',
        address: 'Main Street & Maple Avenue',
        lat: 40.721,
        lng: -74.006,
        eta: new Date(Date.now() + 90_000).toISOString(),
      }],
      currentLocation: { lat: 40.717, lng: -74.006 },
    });
    rerender(<PassengerDisplay />);
    Object.assign(liveTripState, { arrivalSoundsEnabled: true });
    rerender(<PassengerDisplay />);

    expect(playArrivalChime).toHaveBeenCalledTimes(2);
  });

  it('retries a blocked phase after a passenger interaction unlocks audio', async () => {
    playArrivalChime.mockResolvedValueOnce(false).mockResolvedValue(true);
    Object.assign(liveTripState, {
      status: 'running',
      currentLocation: { lat: 40.7128, lng: -74.006 },
      intermediateStops: [{
        id: 'blocked-sound-stop',
        address: '18th Avenue & 49th Street',
        lat: 40.717,
        lng: -74.006,
        eta: new Date(Date.now() + 90_000).toISOString(),
      }],
    });
    render(<PassengerDisplay />);
    expect(playArrivalChime).toHaveBeenCalledTimes(1);

    await act(async () => {
      await Promise.resolve();
      fireEvent.pointerDown(window);
      await Promise.resolve();
    });

    expect(unlockArrivalChimes).toHaveBeenCalledTimes(2);
    expect(reportPassengerAudioStatus).toHaveBeenLastCalledWith('1047', expect.any(String), true);
    expect(playArrivalChime).toHaveBeenCalledTimes(2);
    expect(playArrivalChime).toHaveBeenLastCalledWith('approaching');
  });

  it('renders right-to-left layout when Hebrew is selected', () => {
    liveTripState.passengerLanguage = 'he';
    const { container } = render(<PassengerDisplay />);
    
    // Check if the passenger viewport has dir="rtl"
    const viewport = container.querySelector('.passenger-viewport');
    expect(viewport?.getAttribute('dir')).toBe('rtl');
  });

  it('renders left-to-right layout when English is selected', () => {
    liveTripState.passengerLanguage = 'en';
    const { container } = render(<PassengerDisplay />);
    
    // Check if the passenger viewport has dir="ltr"
    const viewport = container.querySelector('.passenger-viewport');
    expect(viewport?.getAttribute('dir')).toBe('ltr');
  });

  it('renders right-to-left layout when Yiddish is selected', () => {
    liveTripState.passengerLanguage = 'yi';
    const { container } = render(<PassengerDisplay />);

    expect(container.querySelector('.passenger-viewport')?.getAttribute('dir')).toBe('rtl');
  });

  it('renders personal device view when not mounted display', () => {
    mockIsMounted = false;
    liveTripState.passengerLanguage = 'en'; // set back to EN for easy matching
    const { container } = render(<PassengerDisplay />);
    // Check if the personal view is rendered (which has a nav with "Live GPS")
    expect(screen.getByText('Live GPS')).toBeTruthy();
    const infoButton = screen.getByRole('button', { name: 'Passenger Information' });
    expect(infoButton).toBeTruthy();

    fireEvent.click(infoButton);
    expect(infoButton.getAttribute('aria-current')).toBe('page');
    // It should not render passenger-viewport class
    expect(container.querySelector('.passenger-viewport')).toBeNull();
  });

  it('keeps personal pairing and navigation chrome right-to-left in Hebrew', () => {
    mockIsMounted = false;
    liveTripState.passengerLanguage = 'he';

    const { container } = render(<PassengerDisplay />);

    expect(container.firstElementChild?.getAttribute('dir')).toBe('rtl');
    expect(screen.getByRole('button', { name: 'עזיבת הנסיעה' })).toBeTruthy();
  });

  it('asks the passenger to confirm the coach before pairing a scanned QR invitation', async () => {
    displayState.busNumber = '';
    window.history.replaceState({}, '', '/?join=opaque-invite-token');
    render(<PassengerDisplay />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('Join coach 9923?')).toBeTruthy();
    expect(pairDisplayWithQrInvite).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Join this coach' }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(pairDisplayWithQrInvite).toHaveBeenCalledWith('opaque-invite-token');
  });
});
