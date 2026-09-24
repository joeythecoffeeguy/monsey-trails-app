import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import {
  ManeuverIcon,
  NavigationCockpit,
  distanceToRouteMeters,
  passengerJourneyRequestFromRunKey,
  verifiedJourneyStopForTripStop,
} from './NavigationCockpit';
import { getTripNavigation, selectTripNavigationRoute, useLiveTrip } from '@/providers/live-trip';
import { getPassengerJourney } from '@workspace/api-client-react';

const { baseTrip } = vi.hoisted(() => ({
  baseTrip: {
    status: 'running' as const,
    currentLocation: { lat: 40.7, lng: -74.0 },
    routeGeometry: [],
    intermediateStops: [],
    destination: { lat: 40.8, lng: -73.9 },
    destinationAddress: '34th Street & 9th Avenue',
    speedMph: 45,
    eta: new Date().toISOString(),
    remainingDistanceMiles: 12.5,
  },
}));

const navigation = {
  currentRouteId: 'tomtom-primary',
  currentManeuver: {
    instruction: 'Turn left onto Broadway',
    distanceMiles: 0.5,
    type: 'turn' as const,
    modifier: 'left' as const,
    laneGuidance: null,
    exitNumber: null,
    roadShields: [],
    signpostText: null,
  },
  nextManeuver: null,
  trafficDelaySeconds: 120,
  speedLimitMph: 25,
  voicePrompt: 'In half a mile, turn left',
  voicePromptId: 'msg-1',
  routeGeometry: [],
  remainingDistanceMiles: 12.5,
  travelTimeSeconds: 900,
  arrivalTime: new Date().toISOString(),
  alternatives: [{
    id: 'alternative-1',
    timeDifferenceSeconds: -180,
    currentManeuver: {
      instruction: 'Keep right onto Route 59',
      distanceMiles: 0.3,
      type: 'fork' as const,
      modifier: 'right' as const,
      laneGuidance: null,
      exitNumber: null,
      roadShields: [],
      signpostText: null,
    },
    nextManeuver: null,
    trafficDelaySeconds: 30,
    speedLimitMph: 35,
    voicePrompt: 'Keep right onto Route 59',
    voicePromptId: 'msg-alt',
    routeGeometry: [{ lat: 40.7, lng: -74 }, { lat: 40.8, lng: -73.9 }],
    remainingDistanceMiles: 11,
    travelTimeSeconds: 720,
    arrivalTime: new Date().toISOString(),
  }],
};

vi.mock('@/providers/live-trip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/providers/live-trip')>();
  return {
    ...actual,
    useLiveTrip: vi.fn(() => baseTrip),
    getTripNavigation: vi.fn(),
    selectTripNavigationRoute: vi.fn(),
  };
});

vi.mock('@workspace/api-client-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  return { ...actual, getPassengerJourney: vi.fn() };
});

vi.mock('./OperatorMap', () => ({
  OperatorMap: ({ overviewMode }: any) => <div data-testid="operator-map-mock" data-overview={overviewMode} />
}));

beforeAll(() => {
  vi.stubGlobal('speechSynthesis', {
    speak: vi.fn(),
    cancel: vi.fn(),
  });
  vi.stubGlobal('SpeechSynthesisUtterance', vi.fn());
});

describe('NavigationCockpit', () => {
  it('measures GPS distance from the local route corridor without rerouting on jitter', () => {
    const route = [{ lat: 41, lng: -74 }, { lat: 41.01, lng: -74 }];
    expect(distanceToRouteMeters({ lat: 41.005, lng: -74.0002 }, route)).toBeLessThan(30);
    expect(distanceToRouteMeters({ lat: 41.005, lng: -74.002 }, route)).toBeGreaterThan(120);
  });

  it('parses only complete official run identities for journey lookup', () => {
    expect(passengerJourneyRequestFromRunKey('2026-09-23|1|2|5|62884')).toEqual({
      date: '2026-09-23',
      line: 1,
      origin: 2,
      destination: 5,
      runId: '62884',
    });
    expect(passengerJourneyRequestFromRunKey('invalid')).toBeNull();
  });

  it('accepts official stop metadata only when identity and coordinates still match', () => {
    const journey = {
      stops: [{ id: 'pickup-1', lat: 41.1, lng: -74.1, kind: 'pickup', scheduledAt: null }],
    } as any;
    expect(verifiedJourneyStopForTripStop(journey, { id: 'pickup-1', lat: 41.1, lng: -74.1 })).toBe(journey.stops[0]);
    expect(verifiedJourneyStopForTripStop(journey, { id: 'pickup-1', lat: 41.2, lng: -74.1 })).toBeUndefined();
  });

  beforeEach(() => {
    vi.mocked(useLiveTrip).mockReturnValue(baseTrip as unknown as ReturnType<typeof useLiveTrip>);
    vi.mocked(getPassengerJourney).mockReset();
    vi.mocked(getTripNavigation).mockResolvedValue(navigation);
    vi.mocked(selectTripNavigationRoute).mockResolvedValue({
      ...navigation.alternatives[0],
      currentRouteId: 'alternative-1',
      alternatives: [],
    });
    vi.mocked(window.speechSynthesis.speak).mockClear();
    vi.mocked(window.speechSynthesis.cancel).mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders current maneuver and stats', async () => {
    render(<NavigationCockpit onExit={vi.fn()} />);
    
    expect(screen.getByRole('button', { name: 'Emergency controls' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Exit Navigation' })).toBeDefined();
    
    // Wait for nav data to load and render
    expect(await screen.findByText('Turn left onto Broadway')).toBeDefined();
    expect(screen.getByText('0.5 mi')).toBeDefined();
    expect(screen.getByText('25')).toBeDefined(); // Speed limit
    expect(screen.getByText('45')).toBeDefined(); // Current speed
    expect(screen.getByText('15 min')).toBeDefined();
  });

  it('toggles mute state', () => {
    render(<NavigationCockpit onExit={vi.fn()} />);
    const muteButtons = screen.getAllByRole('button', { name: /toggle mute/i });
    fireEvent.click(muteButtons[0]);
    expect(muteButtons[0]).toBeDefined();
  });

  it('renders provider-supplied lane, exit, shield, and signpost guidance above the maneuver', () => {
    const guidedNavigation = {
      ...navigation,
      currentManeuver: {
        ...navigation.currentManeuver,
        laneGuidance: {
          lanes: [
            { directions: ['STRAIGHT'], follow: null },
            { directions: ['SLIGHT_RIGHT'], follow: 'SLIGHT_RIGHT' },
          ],
          laneSeparators: ['SINGLE_DASHED', 'SINGLE_DASHED', 'SINGLE_SOLID'],
        },
        exitNumber: '14B',
        roadShields: [{ reference: 'usa-interstate', shieldContent: 'I-287', affixes: ['I'] }],
        signpostText: 'Mahwah',
      },
    };

    render(<NavigationCockpit onExit={vi.fn()} previewNavigation={guidedNavigation} />);

    const guidance = screen.getByTestId('verified-guidance');
    expect(guidance.textContent).toContain('Exit 14B');
    expect(guidance.textContent).toContain('I-287');
    expect(guidance.textContent).toContain('Mahwah');
    expect(screen.getByLabelText('Lane 1')).toBeDefined();
    expect(screen.getByLabelText('Lane 2, follow this lane')).toBeDefined();
    expect(guidance.querySelectorAll('[data-lane-separator]').length).toBe(3);
    expect(guidance.compareDocumentPosition(screen.getByText('Turn left onto Broadway')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not render unverified lane or sign guidance', () => {
    render(<NavigationCockpit onExit={vi.fn()} previewNavigation={navigation} />);

    expect(screen.queryByTestId('verified-guidance')).toBeNull();
    expect(screen.queryByLabelText('Verified lane guidance')).toBeNull();
  });

  it('changes routes only after the driver explicitly selects an alternative', async () => {
    vi.mocked(useLiveTrip).mockReturnValue({
      ...baseTrip,
      speedMph: 0,
      locationUpdatedAt: new Date().toISOString(),
    } as unknown as ReturnType<typeof useLiveTrip>);
    render(<NavigationCockpit onExit={vi.fn()} />);
    expect(await screen.findByText('Turn left onto Broadway')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Route 2: 3 min faster' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /I am safely stopped/i }));
    expect(screen.getByRole('button', { name: 'Route 2: 3 min faster' })).toBeDefined();
    expect(selectTripNavigationRoute).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Route 2: 3 min faster' }));
    expect(await screen.findByText('Keep right onto Route 59')).toBeDefined();
    expect(selectTripNavigationRoute).toHaveBeenCalledWith('alternative-1');
  });

  it('renders verified stop metadata and a published pickup time from the official journey', async () => {
    vi.mocked(useLiveTrip).mockReturnValue({
      ...baseTrip,
      officialRunKey: '2026-09-23|1|2|5|62884',
      intermediateStops: [{
        id: 'pickup-1',
        address: 'Viola Road & Union Road',
        lat: 41.132,
        lng: -74.054,
      }],
    } as unknown as ReturnType<typeof useLiveTrip>);
    vi.mocked(getPassengerJourney).mockResolvedValue({
      runKey: '2026-09-23|1|2|5|62884',
      originName: 'Monsey',
      destinationName: 'Manhattan',
      serviceDate: '2026-09-23',
      scheduledDepartureAt: '2026-09-23T12:00:00.000Z',
      scheduledArrivalAt: null,
      arrivalVerification: 'unavailable',
      stops: [{
        id: 'pickup-1',
        label: 'Viola Road & Union Road',
        note: 'Board at the marked shelter.',
        mapLabel: 'B',
        lat: 41.132,
        lng: -74.054,
        kind: 'pickup',
        scheduledAt: '2026-09-23T12:15:00.000Z',
        estimatedArrivalAt: null,
      }],
      routeGeometry: [],
      trafficUpdatedAt: null,
      trafficStatus: 'unavailable',
      message: null,
      disruptions: [],
    });

    render(<NavigationCockpit onExit={vi.fn()} previewNavigation={navigation} />);

    expect(await screen.findByText('Board at the marked shelter.')).toBeDefined();
    expect(screen.getByText(/Published pickup time/)).toBeDefined();
    expect(getPassengerJourney).toHaveBeenCalledWith(
      { date: '2026-09-23', line: 1, origin: 2, destination: 5, runId: '62884' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('keeps stale guidance visible and shows reconnecting status when polling fails', async () => {
    vi.useFakeTimers();
    vi.mocked(getTripNavigation)
      .mockResolvedValueOnce(navigation)
      .mockRejectedValueOnce(new Error('provider unavailable'));

    render(<NavigationCockpit onExit={vi.fn()} />);
    await act(async () => {});
    expect(screen.getByText('Turn left onto Broadway')).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByText('Turn left onto Broadway')).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain('reconnecting');
  });

  it('expires actionable guidance after repeated polling failures', async () => {
    vi.useFakeTimers();
    vi.mocked(getTripNavigation)
      .mockResolvedValueOnce(navigation)
      .mockRejectedValue(new Error('provider unavailable'));

    render(<NavigationCockpit onExit={vi.fn()} />);
    await act(async () => {});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(screen.queryByText('Turn left onto Broadway')).toBeNull();
    expect(screen.getByText('Guidance unavailable')).toBeDefined();
    expect(screen.getByText('-- mi')).toBeDefined();
    expect(screen.getByText('--')).toBeDefined();
    expect(screen.queryByText('+2 min traffic delay')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('expired');
    expect(window.speechSynthesis.cancel).toHaveBeenCalled();
  });

  it('does not repeat the same spoken prompt during polling', async () => {
    vi.useFakeTimers();
    vi.mocked(getTripNavigation).mockResolvedValue(navigation);

    render(<NavigationCockpit onExit={vi.fn()} />);
    await act(async () => {});
    expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

      expect(getTripNavigation).toHaveBeenCalledTimes(3);
    expect(window.speechSynthesis.speak).toHaveBeenCalledTimes(1);
  });

  it('does not speak expired guidance when unmuted after an outage', async () => {
    vi.useFakeTimers();
    let resolveNavigation!: (value: typeof navigation) => void;
    vi.mocked(getTripNavigation)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveNavigation = resolve;
      }))
      .mockRejectedValue(new Error('provider unavailable'));

    render(<NavigationCockpit onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /toggle mute/i }));
    await act(async () => {
      resolveNavigation(navigation);
    });
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(screen.getByText('Guidance unavailable')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /toggle mute/i }));
    expect(window.speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it.each([
    ['turn', 'left', 'lucide-corner-up-left'],
    ['turn', 'right', 'lucide-corner-up-right'],
    ['turn', 'uturn', 'lucide-corner-down-left'],
    ['roundabout', undefined, 'lucide-rotate-ccw'],
    ['continue', 'straight', 'lucide-arrow-up'],
  ])('maps %s %s guidance to the correct maneuver icon', (type, modifier, iconClass) => {
    const { container } = render(<ManeuverIcon type={type} modifier={modifier} />);
    expect(container.querySelector(`.${iconClass}`)).not.toBeNull();
  });
});
