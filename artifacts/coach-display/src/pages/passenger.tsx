import { useEffect, useMemo, useRef, useState } from 'react';
import { useSettingsStore, DisplayMode } from '@/lib/store';
import { Header } from '@/components/passenger/Header';
import { Footer } from '@/components/passenger/Footer';
import { EmergencyOverlay } from '@/components/passenger/EmergencyOverlay';
import { WelcomeView } from '@/components/passenger/views/WelcomeView';
import { MapProgressView } from '@/components/passenger/views/MapProgressView';
import { WeatherView } from '@/components/passenger/views/WeatherView';
import { TrafficView } from '@/components/passenger/views/TrafficView';
import { AnnouncementsView } from '@/components/passenger/views/AnnouncementsView';
import { MonseyInfoView } from '@/components/passenger/views/MonseyInfoView';
import { ChargingAmenitiesView } from '@/components/passenger/views/ChargingAmenitiesView';
import { DailyDafView } from '@/components/passenger/views/DailyDafView';
import { JewishCalendarView } from '@/components/passenger/views/JewishCalendarView';
import { SafetyBriefingView } from '@/components/passenger/views/SafetyBriefingView';
import { NextStopView } from '@/components/passenger/views/NextStopView';
import { Bus, KeyRound, LogOut, Maximize2, ShieldCheck, X } from 'lucide-react';
import { acknowledgePassengerDisplaySettings, clearAdminDisplayBusNumber, connectPersonalPassenger, disconnectPassengerDisplay, disconnectPersonalPassenger, enterDevelopmentDisplayPreview, exitDevelopmentDisplayPreview, getAdminDisplayBusNumber, getDisplayBusNumber, getPersonalDepartureTime, getPersonalRunKey, pairDisplayWithBus, pairDisplayWithQrInvite, previewPassengerQrInvite, reportPassengerAudioStatus, type QrInvitePreview, useLiveTrip } from '@/providers/live-trip';
import { getNextStopPhase, shouldTriggerNextStop } from '@/lib/next-stop-trigger';
import { playArrivalChime, unlockArrivalChimes } from '@/lib/arrival-chime';
import { getTranslation, isRTL } from '@/lib/translations';
import { useMediaQuery } from '@/hooks/use-media-query';
import { PersonalPassengerView } from '@/components/passenger/personal/PersonalPassengerView';
import { type PassengerScheduleFilters } from '@/components/passenger/personal/PersonalUnpairedView';
import { installDirectLiveHistory, livePageCanUseBrowserBack, passengerRouteView, tripPageCanUseBrowserBack } from '@/components/passenger/personal/passengerHistory';
import { getNewYorkServiceDate } from '@workspace/api-client-react';
import { createPassengerDemoTrip } from './passenger-demo';
import { APP_ROUTES, appUrl } from '@/lib/app-routes';
import { parsePassengerShare } from '@/components/passenger/personal/passengerShare';

type PassengerDisplayMode = DisplayMode;
const ALL_SLIDES_SEQUENCE: PassengerDisplayMode[] = [
  'welcome',
  'map',
  'weather',
  'traffic',
  'daf',
  'jewish-calendar',
  'announcements',
  'destinations-info',
  'fares-info',
  'passenger-guide',
  'contact-info',
  'charging-amenities',
  'safety',
];
const DISPLAY_WIDTH = 1366;
const DISPLAY_HEIGHT = 768;
const DISPLAY_ID_KEY = 'coach-passenger-display-id';
const PERSONAL_HISTORY_VIEW_KEY = 'passengerView';

function readScheduleFilters(): PassengerScheduleFilters {
  const params = new URLSearchParams(window.location.search);
  const positiveNumber = (name: string, fallback: number) => {
    const value = Number(params.get(name));
    return Number.isInteger(value) && value > 0 ? value : fallback;
  };
  const date = params.get('date');
  return {
    line: positiveNumber('line', 1),
    origin: positiveNumber('origin', 2),
    destination: positiveNumber('destination', 5),
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getNewYorkServiceDate(),
  };
}

function personalUrl(
  filters: PassengerScheduleFilters,
  trip?: { runKey: string; departureTime: string },
  view: 'trip' | 'live' = 'trip',
) {
  const params = new URLSearchParams();
  params.set('date', filters.date);
  params.set('line', String(filters.line));
  params.set('origin', String(filters.origin));
  params.set('destination', String(filters.destination));
  if (trip) {
    params.set('run', trip.runKey);
    params.set('departure', trip.departureTime);
    if (view === 'live') params.set('view', 'live');
  }
  return `${window.location.pathname}?${params.toString()}${window.location.hash}`;
}

function historyView() {
  return (window.history.state as Record<string, unknown> | null)?.[PERSONAL_HISTORY_VIEW_KEY];
}

function getPassengerDisplayId() {
  const existing = sessionStorage.getItem(DISPLAY_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem(DISPLAY_ID_KEY, id);
  return id;
}

export default function PassengerDisplay({ experience }: { experience?: 'personal' | 'mounted' }) {
  const mountedByViewport = useMediaQuery('(min-width: 1200px) and (min-aspect-ratio: 16/10)');
  const isMountedDisplay = experience === 'mounted' || (experience === undefined && mountedByViewport);
  const isPersonalApp = experience === 'personal';
  const isAdminDisplay = /\/admin\/display\/?$/.test(window.location.pathname);
  const initialFilters = useRef(readScheduleFilters());
  const initialParams = useRef(new URLSearchParams(window.location.search));
  const initialShare = useRef(parsePassengerShare(window.location.search));
  const initialStopSelection = useRef(initialShare.current ? {
    runKey: initialShare.current.runKey,
    pickup: initialShare.current.pickupStop ? {
      ...initialShare.current.pickupStop,
      kind: 'pickup' as const,
      mapLabel: '',
      scheduledAt: null,
      estimatedArrivalAt: null,
    } : null,
    dropoff: initialShare.current.dropoffStop ? {
      ...initialShare.current.dropoffStop,
      kind: 'dropoff' as const,
      mapLabel: '',
      scheduledAt: null,
      estimatedArrivalAt: null,
    } : null,
  } : null);
  const [busNumber, setBusNumber] = useState('');
  const [selectedRunKey, setSelectedRunKey] = useState(
    () => isPersonalApp
      ? initialParams.current.has('run')
        ? initialShare.current?.runKey ?? ''
        : (historyView() === 'schedule' ? '' : getPersonalRunKey())
      : '',
  );
  const [departureTime, setDepartureTime] = useState(
    () => isPersonalApp
      ? initialParams.current.has('run')
        ? initialShare.current?.departureTime ?? ''
        : getPersonalDepartureTime()
      : '',
  );
  const [personalView, setPersonalView] = useState<'trip' | 'live'>(
    () => passengerRouteView(window.location.search),
  );
  const [connectedBusNumber, setConnectedBusNumber] = useState(
    isPersonalApp
      ? () => initialParams.current.has('run') ? initialShare.current?.runKey ?? '' : getPersonalRunKey()
      : isAdminDisplay ? getAdminDisplayBusNumber : getDisplayBusNumber,
  );
  const [connectionError, setConnectionError] = useState(() =>
    isPersonalApp && initialParams.current.has('run') && !initialShare.current
      ? 'This shared trip link is invalid or incomplete. Choose a published departure below.'
      : '',
  );
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [developmentPreview, setDevelopmentPreview] = useState(false);
  const [showDevelopmentUnlock, setShowDevelopmentUnlock] = useState(false);
  const [developmentCode, setDevelopmentCode] = useState('');
  const [developmentError, setDevelopmentError] = useState('');
  const [scheduleFilters, setScheduleFiltersState] = useState(initialFilters.current);
  const [qrToken, setQrToken] = useState(() => isMountedDisplay
    ? new URLSearchParams(window.location.search).get('join') ?? '' : '');
  const [qrPreview, setQrPreview] = useState<QrInvitePreview | null>(null);
  const [qrPreviewBusy, setQrPreviewBusy] = useState(Boolean(qrToken));
  const { routeId } = useSettingsStore();
  const liveTrip = useLiveTrip();
  const realDisplayIsPaired = isMountedDisplay && Boolean(getDisplayBusNumber());
  const adminDisplayIsPaired = isAdminDisplay && Boolean(getAdminDisplayBusNumber());
  const displayIsPaired = realDisplayIsPaired || adminDisplayIsPaired || developmentPreview;
  const displayMode = liveTrip.displayMode;
  const rotationIntervalSeconds = liveTrip.rotationIntervalSeconds;
  const isDriving = liveTrip.status === 'running';
  const hasConfiguredRoute = Boolean(
    liveTrip.destinationAddress.trim() && liveTrip.destination
    || liveTrip.intermediateStops?.length,
  );
  const hasActiveRoute = hasConfiguredRoute && (liveTrip.status === 'ready' || liveTrip.status === 'running');
  const routeDisplayRequested = displayMode === 'map' || displayMode === 'next-stop';
  const effectiveDisplayMode = routeDisplayRequested && !hasActiveRoute ? 'welcome' : displayMode;
  const rotationSequence = useMemo(() => liveTrip.enabledSlides?.length
    ? ALL_SLIDES_SEQUENCE.filter(slide => liveTrip.enabledSlides?.includes(slide))
    : ALL_SLIDES_SEQUENCE, [liveTrip.enabledSlides]);

  const nextStop = hasActiveRoute ? liveTrip.intermediateStops?.[0] : undefined;
  const nextLocation = hasActiveRoute
    ? (nextStop ? { lat: nextStop.lat, lng: nextStop.lng } : liveTrip.destination)
    : null;
  const nextEta = hasActiveRoute ? (nextStop ? (nextStop.eta ?? null) : liveTrip.eta) : null;
  const autoNextStop = shouldTriggerNextStop(liveTrip.status, liveTrip.currentLocation, nextLocation, nextEta);
  const nextStopPhase = getNextStopPhase(liveTrip.currentLocation, nextLocation, nextEta);
  const nextStopIdentity = nextStop?.id ?? (liveTrip.destination
    ? `${liveTrip.destination.lat}:${liveTrip.destination.lng}`
    : '');
  const nextStopKey = nextStopIdentity ? `${liveTrip.startedAt ?? 'trip'}:${nextStopIdentity}` : '';

  const [displayScale, setDisplayScale] = useState(() =>
    Math.min(window.innerWidth / DISPLAY_WIDTH, window.innerHeight / DISPLAY_HEIGHT),
  );
  const hasMainRotationAnnouncements = (liveTrip.announcements ?? []).some((announcement) => announcement.active);
  const [currentViewIndex, setCurrentViewIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(
    () => new URLSearchParams(window.location.search).get('fullscreen') === '1',
  );
  const [showFullscreenControl, setShowFullscreenControl] = useState(true);
  const [audioUnlockVersion, setAudioUnlockVersion] = useState(0);
  const wakeLock = useRef<{ released: boolean; release: () => Promise<void> } | null>(null);
  const playedApproachingStops = useRef(new Set<string>());
  const playedArrivingStops = useRef(new Set<string>());
  const pendingChimes = useRef(new Set<string>());
  const lastChimeTestRequest = useRef<string | null | undefined>(undefined);
  const passengerDisplayId = useRef(getPassengerDisplayId());
  const acknowledgedSettingsVersion = useRef<number | null>(null);

  useEffect(() => {
    const version = liveTrip.displaySettingsVersion;
    const pairingCode = getDisplayBusNumber();
    if (!isMountedDisplay || isAdminDisplay || !pairingCode || !version
      || acknowledgedSettingsVersion.current === version) return;
    // Effects run after React commits the configuration to the mounted display.
    // A failed receipt remains retryable on the next poll/render.
    void acknowledgePassengerDisplaySettings(pairingCode, passengerDisplayId.current, version)
      .then(() => { acknowledgedSettingsVersion.current = version; })
      .catch(() => undefined);
  }, [
    isAdminDisplay,
    isMountedDisplay,
    liveTrip.announcements,
    liveTrip.displaySettingsVersion,
    liveTrip.enabledSlides,
    liveTrip.passengerLanguage,
    liveTrip.rotationIntervalSeconds,
  ]);

  useEffect(() => () => exitDevelopmentDisplayPreview(), []);

  function showSchedule() {
    disconnectPersonalPassenger();
    setConnectedBusNumber('');
    setSelectedRunKey('');
    setDepartureTime('');
    setConnectionError('');
    setPersonalView('trip');
  }

  function returnToSchedule() {
    if (tripPageCanUseBrowserBack(window.history.state)) {
      window.history.back();
      return;
    }
    window.history.replaceState(
      { ...window.history.state, [PERSONAL_HISTORY_VIEW_KEY]: 'schedule' },
      '',
      personalUrl(scheduleFilters),
    );
    showSchedule();
  }

  function openLiveTracking() {
    if (!selectedRunKey) return;
    window.history.pushState(
      {
        ...window.history.state,
        [PERSONAL_HISTORY_VIEW_KEY]: 'live',
        passengerHistoryOwned: true,
        passengerLiveFromTrip: true,
      },
      '',
      personalUrl(scheduleFilters, { runKey: selectedRunKey, departureTime }, 'live'),
    );
    setPersonalView('live');
  }

  function returnToTripDetails() {
    const state = window.history.state as Record<string, unknown> | null;
    if (livePageCanUseBrowserBack(state)) {
      window.history.back();
      return;
    }
    window.history.replaceState(
      {
        ...window.history.state,
        [PERSONAL_HISTORY_VIEW_KEY]: 'schedule',
        passengerHistoryOwned: true,
        passengerLiveFromTrip: false,
      },
      '',
      personalUrl(scheduleFilters),
    );
    window.history.pushState(
      {
        ...window.history.state,
        [PERSONAL_HISTORY_VIEW_KEY]: 'trip',
        passengerHistoryOwned: true,
        passengerLiveFromTrip: false,
      },
      '',
      personalUrl(scheduleFilters, { runKey: selectedRunKey, departureTime }),
    );
    setPersonalView('trip');
  }

  function setScheduleFilters(filters: PassengerScheduleFilters) {
    setScheduleFiltersState(filters);
    if (!selectedRunKey) {
      window.history.replaceState(
        { ...window.history.state, [PERSONAL_HISTORY_VIEW_KEY]: 'schedule' },
        '',
        personalUrl(filters),
      );
    }
  }

  useEffect(() => {
    if (!isPersonalApp) return;

    const restoreFromHistory = () => {
      const params = new URLSearchParams(window.location.search);
      const filters = readScheduleFilters();
      const shared = parsePassengerShare(window.location.search);
      const runKey = shared?.runKey ?? '';
      setPersonalView(passengerRouteView(window.location.search));
      setScheduleFiltersState(filters);
      if (!runKey) {
        showSchedule();
        return;
      }
      const scheduledTime = shared?.departureTime ?? '';
      if (!scheduledTime) {
        showSchedule();
        setConnectionError('This shared trip link is invalid or incomplete. Choose a published departure below.');
        return;
      }
      connectPersonalPassenger(runKey, scheduledTime);
      setSelectedRunKey(runKey);
      setDepartureTime(scheduledTime);
      setConnectedBusNumber(runKey);
      setConnectionError('');
    };

    const runKey = initialShare.current?.runKey ?? selectedRunKey;
    const scheduledTime = initialShare.current?.departureTime ?? departureTime;
    if (runKey && scheduledTime && (
      getPersonalRunKey() !== runKey
      || getPersonalDepartureTime() !== scheduledTime
    )) {
      connectPersonalPassenger(runKey, scheduledTime);
      setConnectedBusNumber(runKey);
    }
    const initialView = passengerRouteView(window.location.search);
    if (runKey && initialView === 'live') {
      installDirectLiveHistory(window.history, {
        schedule: personalUrl(initialFilters.current),
        trip: personalUrl(initialFilters.current, { runKey, departureTime: scheduledTime }),
        live: personalUrl(initialFilters.current, { runKey, departureTime: scheduledTime }, 'live'),
      });
      setPersonalView('live');
    } else if (runKey && historyView() !== 'trip') {
      window.history.replaceState(
        {
          ...window.history.state,
          [PERSONAL_HISTORY_VIEW_KEY]: 'schedule',
          passengerHistoryOwned: true,
        },
        '',
        personalUrl(initialFilters.current),
      );
      window.history.pushState(
        {
          ...window.history.state,
          [PERSONAL_HISTORY_VIEW_KEY]: 'trip',
          passengerHistoryOwned: true,
        },
        '',
        personalUrl(initialFilters.current, { runKey, departureTime: scheduledTime }),
      );
    } else if (!runKey && historyView() !== 'schedule') {
      window.history.replaceState(
        { ...window.history.state, [PERSONAL_HISTORY_VIEW_KEY]: 'schedule' },
        '',
        personalUrl(initialFilters.current),
      );
    }

    window.addEventListener('popstate', restoreFromHistory);
    return () => window.removeEventListener('popstate', restoreFromHistory);
  }, [isPersonalApp]);

  async function reportAudioReadiness() {
    if (!isMountedDisplay) return;
    const pairingCode = getDisplayBusNumber();
    if (!pairingCode) return;
    const audioReady = await unlockArrivalChimes();
    try {
      await reportPassengerAudioStatus(pairingCode, passengerDisplayId.current, audioReady);
    } catch {
      // The next heartbeat retries after temporary network failures.
    }
  }

  async function keepScreenAwake() {
    if (!isMountedDisplay || !connectedBusNumber || document.visibilityState !== 'visible' || wakeLock.current && !wakeLock.current.released) return;
    const wakeLockApi = (navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<{ released: boolean; release: () => Promise<void> }> };
    }).wakeLock;
    if (!wakeLockApi) return;
    try {
      wakeLock.current = await wakeLockApi.request('screen');
    } catch {
      // Some browsers require another user interaction; fullscreen also triggers another attempt.
    }
  }

  useEffect(() => {
    if (connectedBusNumber && routeId !== liveTrip.routeId) {
      useSettingsStore.getState().updateSettings({ routeId: liveTrip.routeId });
    }
  }, [connectedBusNumber, liveTrip.routeId, routeId]);

  useEffect(() => {
    if (!isMountedDisplay) return;
    const unlock = () => {
      void unlockArrivalChimes().then((unlocked) => {
        const pairingCode = getDisplayBusNumber();
        if (unlocked && pairingCode) {
          setAudioUnlockVersion((version) => version + 1);
          void reportPassengerAudioStatus(pairingCode, passengerDisplayId.current, true);
        }
      });
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [connectedBusNumber, isMountedDisplay]);

  useEffect(() => {
    if (!isMountedDisplay || !connectedBusNumber) return;
    void reportAudioReadiness();
    const timer = window.setInterval(reportAudioReadiness, 5_000);
    const retry = () => void reportAudioReadiness();
    window.addEventListener('online', retry);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', retry);
    };
  }, [connectedBusNumber, isMountedDisplay]);

  useEffect(() => {
    if (!autoNextStop || !nextStopKey) return;

    const attemptChime = (
      kind: 'approaching' | 'arriving',
      playedStops: Set<string>,
    ) => {
      const attemptKey = `${kind}:${nextStopKey}`;
      if (playedStops.has(nextStopKey) || pendingChimes.current.has(attemptKey)) return;
      pendingChimes.current.add(attemptKey);
      void playArrivalChime(kind)
        .then((played) => {
          if (played) playedStops.add(nextStopKey);
        })
        .finally(() => pendingChimes.current.delete(attemptKey));
    };

    if (!playedApproachingStops.current.has(nextStopKey)) {
      if (!liveTrip.arrivalSoundsEnabled || nextStopPhase === 'arriving') {
        playedApproachingStops.current.add(nextStopKey);
      } else {
        attemptChime('approaching', playedApproachingStops.current);
      }
    }
    if (nextStopPhase === 'arriving' && !playedArrivingStops.current.has(nextStopKey)) {
      if (!liveTrip.arrivalSoundsEnabled) {
        playedArrivingStops.current.add(nextStopKey);
      } else {
        attemptChime('arriving', playedArrivingStops.current);
      }
    }
  }, [audioUnlockVersion, autoNextStop, liveTrip.arrivalSoundsEnabled, nextStopKey, nextStopPhase]);

  useEffect(() => {
    if (lastChimeTestRequest.current === undefined) {
      lastChimeTestRequest.current = liveTrip.chimeTestRequestedAt;
      return;
    }
    if (!liveTrip.chimeTestRequestedAt || liveTrip.chimeTestRequestedAt === lastChimeTestRequest.current) return;
    lastChimeTestRequest.current = liveTrip.chimeTestRequestedAt;
    void playArrivalChime('approaching');
  }, [liveTrip.chimeTestRequestedAt]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreen = Boolean(document.fullscreenElement);
      setIsFullscreen(fullscreen);
      if (fullscreen) setShowFullscreenPrompt(false);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!isMountedDisplay || !connectedBusNumber) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void keepScreenAwake();
    };
    const protectPassengerDisplay = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    void keepScreenAwake();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', protectPassengerDisplay);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', protectPassengerDisplay);
      void wakeLock.current?.release();
      wakeLock.current = null;
    };
  }, [connectedBusNumber, isMountedDisplay]);

  useEffect(() => {
    if (isFullscreen || showFullscreenPrompt) return;
    const timer = window.setTimeout(() => setShowFullscreenControl(false), 8_000);
    return () => window.clearTimeout(timer);
  }, [isFullscreen, showFullscreenPrompt, showFullscreenControl]);

  async function enterFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
      await keepScreenAwake();
    } catch {
      setShowFullscreenPrompt(false);
      setShowFullscreenControl(true);
    }
  }

  async function exitFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } finally {
      setShowFullscreenControl(true);
    }
  }

  async function logoutPassengerDisplay() {
    if (!isMountedDisplay) {
      returnToSchedule();
      return;
    }
    if (!window.confirm(isAdminDisplay ? 'Return to the current trip list?' : 'Disconnect this passenger display from the coach?')) return;
    if (isAdminDisplay) {
      clearAdminDisplayBusNumber();
      window.location.assign(appUrl(APP_ROUTES.adminDisplay));
      return;
    }
    disconnectPassengerDisplay();
    setConnectedBusNumber('');
    setBusNumber('');
    setSelectedRunKey('');
    if (document.fullscreenElement) await document.exitFullscreen();
  }

  function closeDevelopmentUnlock() {
    setShowDevelopmentUnlock(false);
    setDevelopmentCode('');
    setDevelopmentError('');
  }

  function unlockDevelopmentPreview() {
    if (!import.meta.env.DEV || !isMountedDisplay) return;
    if (developmentCode !== '5100') {
      setDevelopmentCode('');
      setDevelopmentError('Incorrect development code. Try again.');
      return;
    }
    closeDevelopmentUnlock();
    enterDevelopmentDisplayPreview(createPassengerDemoTrip());
    setDevelopmentPreview(true);
  }

  function exitDevelopmentPreview() {
    exitDevelopmentDisplayPreview();
    setDevelopmentPreview(false);
    setCurrentViewIndex(0);
  }

  async function connectPassengerDisplay(runKeyOverride?: string, departureTimeOverride?: string, filtersOverride?: PassengerScheduleFilters) {
    const normalized = busNumber.trim().toUpperCase();
    if (isPersonalApp) {
      const runKey = runKeyOverride ?? selectedRunKey;
      const scheduledTime = departureTimeOverride ?? departureTime;
      if (!runKey) {
        setConnectionError('Choose a published departure.');
        return;
      }
      if (!scheduledTime) {
        setConnectionError('Choose the scheduled departure time.');
        return;
      }
      connectPersonalPassenger(runKey, scheduledTime);
      setSelectedRunKey(runKey);
      setDepartureTime(scheduledTime);
      setConnectedBusNumber(runKey);
      if (
        new URLSearchParams(window.location.search).get('run') !== runKey
        || historyView() !== 'trip'
      ) {
        window.history.pushState(
          {
            ...window.history.state,
            [PERSONAL_HISTORY_VIEW_KEY]: 'trip',
            passengerHistoryOwned: true,
          },
          '',
          personalUrl(filtersOverride ?? scheduleFilters, { runKey, departureTime: scheduledTime }),
        );
      }
      return;
    }
    if (!/^\d{4}$/.test(normalized)) {
      setConnectionError('Enter the four-digit code shown in the operator app.');
      return;
    }
    setConnectionBusy(true);
    setConnectionError('');
    try {
      const result = await pairDisplayWithBus(normalized);
      setConnectedBusNumber(result.busNumber);
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Could not connect to this bus.');
    } finally {
      setConnectionBusy(false);
    }
  }

  useEffect(() => {
    if (!qrToken || connectedBusNumber) return;
    let cancelled = false;
    setQrPreviewBusy(true);
    void previewPassengerQrInvite(qrToken)
      .then((preview) => {
        if (!cancelled) setQrPreview(preview);
      })
      .catch((error) => {
        if (!cancelled) setConnectionError(error instanceof Error ? error.message : 'This QR invitation is invalid or has expired.');
      })
      .finally(() => {
        if (!cancelled) setQrPreviewBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectedBusNumber, qrToken]);

  async function confirmQrPairing() {
    setConnectionBusy(true);
    setConnectionError('');
    try {
      const result = await pairDisplayWithQrInvite(qrToken);
      setConnectedBusNumber(result.busNumber);
      window.history.replaceState({}, '', window.location.pathname);
    } catch (error) {
      setQrPreview(null);
      setConnectionError(error instanceof Error ? error.message : 'This QR invitation is invalid or has expired.');
    } finally {
      setConnectionBusy(false);
    }
  }

  useEffect(() => {
    const updateScale = () => {
      setDisplayScale(Math.min(
        window.innerWidth / DISPLAY_WIDTH,
        window.innerHeight / DISPLAY_HEIGHT,
      ));
    };

    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  useEffect(() => {
    if (effectiveDisplayMode !== 'auto') return;

    const timer = setInterval(() => {
      setCurrentViewIndex((prev) => {
        let next = (prev + 1) % rotationSequence.length;
        if (rotationSequence[next] === 'map' && !hasActiveRoute) {
          next = (next + 1) % rotationSequence.length;
        }
        if (rotationSequence[next] === 'announcements' && !hasMainRotationAnnouncements) {
          next = (next + 1) % rotationSequence.length;
        }
        return next;
      });
    }, rotationIntervalSeconds * 1000);

    return () => clearInterval(timer);
  }, [effectiveDisplayMode, rotationIntervalSeconds, hasActiveRoute, hasMainRotationAnnouncements, rotationSequence]);

  useEffect(() => {
    setCurrentViewIndex(0);
  }, [isDriving]);

  const scheduledMode = rotationSequence[currentViewIndex];
  const activeMode = effectiveDisplayMode === 'auto'
    ? (autoNextStop ? 'next-stop' : scheduledMode === 'map' && !hasActiveRoute ? 'welcome' : scheduledMode)
    : effectiveDisplayMode;

  const lang = liveTrip.passengerLanguage;
  const rtl = isRTL(lang);
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(lang, key);

  if (!connectedBusNumber && qrToken && (qrPreviewBusy || qrPreview)) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 text-center shadow-xl">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Bus className="h-10 w-10" />
          </div>
          {qrPreviewBusy ? (
            <p className="mt-6 text-lg font-semibold">Checking coach invitation…</p>
          ) : (
            <>
              <h1 className="mt-6 text-3xl font-bold">Join coach {qrPreview?.busNumber}?</h1>
              <p className="mt-3 text-muted-foreground">Confirm that this is the coach you are boarding.</p>
              <button
                type="button"
                disabled={connectionBusy}
                onClick={() => void confirmQrPairing()}
                className="mt-8 w-full rounded-2xl bg-primary px-6 py-4 text-lg font-bold text-primary-foreground disabled:opacity-50"
              >
                {connectionBusy ? 'Joining…' : 'Join this coach'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setQrToken('');
                  setQrPreview(null);
                  window.history.replaceState({}, '', window.location.pathname);
                }}
                className="mt-3 w-full rounded-2xl border border-border px-6 py-4 font-semibold"
              >
                Enter code instead
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!isMountedDisplay) {
    return (
      <PersonalPassengerView
        selectedRunKey={selectedRunKey}
        setSelectedRunKey={setSelectedRunKey}
        departureTime={departureTime}
        setDepartureTime={setDepartureTime}
        connectedBusNumber={connectedBusNumber}
        connectionError={connectionError}
        setConnectionError={setConnectionError}
        connectionBusy={connectionBusy}
        connectPassengerDisplay={connectPassengerDisplay}
        returnToSchedule={returnToSchedule}
        scheduleFilters={scheduleFilters}
        setScheduleFilters={setScheduleFilters}
        personalView={personalView}
        openLiveTracking={openLiveTracking}
        returnToTripDetails={returnToTripDetails}
        initialStopSelection={initialStopSelection.current}
      />
    );
  }

  return (
    <div
      className="passenger-viewport"
      onMouseMove={() => setShowFullscreenControl(true)}
      onTouchStart={() => setShowFullscreenControl(true)}
      dir={rtl ? 'rtl' : 'ltr'}
    >
      <div
        className="passenger-stage"
        style={{
          width: DISPLAY_WIDTH * displayScale,
          height: DISPLAY_HEIGHT * displayScale,
        }}
      >
        <div
          className="passenger-screen dark flex flex-col bg-background text-foreground overflow-hidden select-none"
          style={{ transform: `scale(${displayScale})` }}
        >
          {!displayIsPaired ? (
            <main className="flex flex-1 items-center justify-center px-12">
              <div className="relative w-full max-w-2xl rounded-[2.5rem] border border-white/10 bg-secondary/55 p-14 text-center shadow-2xl">
                <div className="absolute right-5 top-5 flex items-center gap-1">
                  {import.meta.env.DEV && (
                    <button
                      type="button"
                      onClick={() => setShowDevelopmentUnlock(true)}
                      aria-label="Open development display preview"
                      title="Development display preview"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground/40 transition-colors hover:bg-white/10 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <ShieldCheck className="h-4 w-4" />
                    </button>
                  )}
                  <a
                    href={`${appUrl('/sign-in')}?redirect_url=${encodeURIComponent(appUrl(APP_ROUTES.adminDisplay))}`}
                    aria-label="Administrator sign-in"
                    title="Administrator sign-in"
                    className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground/55 transition-colors hover:bg-white/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <KeyRound className="h-4 w-4" />
                  </a>
                </div>
                <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Bus className="h-12 w-12" />
                </div>
                <p className="mt-6 text-xl font-semibold text-muted-foreground">Bus-Mounted Passenger Display</p>
                <h1 className="mt-4 text-5xl font-bold">{t('enterPairingCode')}</h1>
                <p className="mt-3 text-lg text-muted-foreground">No username or password needed. Use the driver’s display pairing code.</p>
                <p className="mx-auto mt-4 max-w-xl text-2xl leading-relaxed text-muted-foreground">
                  {t('pairingInstructions')}
                </p>
                <form
                  className="mx-auto mt-10 flex max-w-md gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void connectPassengerDisplay();
                  }}
                  dir="ltr"
                >
                  <input
                    value={busNumber}
                    onChange={(event) => {
                       setBusNumber(event.target.value.replace(/\D/g, '').slice(0, 4));
                      setConnectionError('');
                    }}
                    placeholder={t('pairingPlaceholder')}
                    maxLength={4}
                    autoFocus
                    className="min-w-0 flex-1 rounded-xl border border-white/20 bg-background px-5 py-4 text-2xl font-semibold uppercase outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 text-center"
                  />
                  <button
                    type="submit"
                    disabled={connectionBusy || busNumber.length !== 4}
                    className="rounded-xl bg-primary px-7 py-4 text-xl font-bold text-primary-foreground disabled:opacity-50"
                  >
                    {connectionBusy ? t('connecting') : t('continue')}
                  </button>
                </form>
                {connectionError && <p className="mt-5 text-lg font-semibold text-destructive">{connectionError}</p>}
                {import.meta.env.DEV && showDevelopmentUnlock && (
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="development-preview-title"
                    className="absolute inset-0 flex items-center justify-center rounded-[2.5rem] bg-background/95 p-10 backdrop-blur"
                  >
                    <form
                      className="w-full max-w-sm text-left"
                      onSubmit={(event) => {
                        event.preventDefault();
                        unlockDevelopmentPreview();
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <h2 id="development-preview-title" className="text-2xl font-bold">Development preview</h2>
                        <button
                          type="button"
                          onClick={closeDevelopmentUnlock}
                          aria-label="Cancel development preview"
                          className="rounded-lg p-2 text-muted-foreground hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">Local display demo only. This does not pair with a coach.</p>
                      <label htmlFor="development-preview-code" className="mt-6 block text-sm font-semibold">
                        Development preview code
                      </label>
                      <input
                        id="development-preview-code"
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
                        autoFocus
                        value={developmentCode}
                        onChange={(event) => {
                          setDevelopmentCode(event.target.value.replace(/\D/g, '').slice(0, 4));
                          setDevelopmentError('');
                        }}
                        aria-describedby={developmentError ? 'development-preview-error' : undefined}
                        className="mt-2 w-full rounded-xl border border-white/20 bg-background px-5 py-4 text-center text-2xl font-semibold tracking-[0.4em] outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                      />
                      {developmentError && (
                        <p id="development-preview-error" role="alert" className="mt-3 font-semibold text-destructive">
                          {developmentError}
                        </p>
                      )}
                      <div className="mt-6 flex gap-3">
                        <button
                          type="button"
                          onClick={closeDevelopmentUnlock}
                          className="flex-1 rounded-xl border border-white/20 px-4 py-3 font-semibold"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={developmentCode.length !== 4}
                          className="flex-1 rounded-xl bg-primary px-4 py-3 font-bold text-primary-foreground disabled:opacity-50"
                        >
                          Open preview
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            </main>
          ) : (
            <>
              <Header activeMode={activeMode} isDriving={isDriving} />
          
              <main className="flex-1 min-h-0 relative overflow-hidden flex flex-col">
                {activeMode === 'welcome' && <WelcomeView />}
                {activeMode === 'map' && <MapProgressView />}
                {activeMode === 'next-stop' && <NextStopView />}
                {activeMode === 'weather' && <WeatherView />}
                {activeMode === 'traffic' && <TrafficView />}
                {activeMode === 'daf' && <DailyDafView />}
                {activeMode === 'jewish-calendar' && <JewishCalendarView />}
                {activeMode === 'announcements' && <AnnouncementsView />}
                {activeMode === 'destinations-info' && <MonseyInfoView section="destinations" />}
                {activeMode === 'fares-info' && <MonseyInfoView section="fares" />}
                {activeMode === 'passenger-guide' && <MonseyInfoView section="guide" />}
                {activeMode === 'contact-info' && <MonseyInfoView section="contact" />}
                {activeMode === 'charging-amenities' && <ChargingAmenitiesView />}
                {activeMode === 'safety' && <SafetyBriefingView />}
              </main>

              {activeMode !== 'next-stop' && <Footer />}

              <EmergencyOverlay />
            </>
          )}

          {!isFullscreen && showFullscreenPrompt && (
            <div className="absolute inset-0 z-[70] flex items-center justify-center bg-background/90 backdrop-blur-sm">
              <button
                type="button"
                onClick={enterFullscreen}
                className="flex items-center gap-4 rounded-2xl bg-primary px-10 py-6 text-2xl font-bold text-primary-foreground shadow-2xl transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
              >
                <Maximize2 className="h-8 w-8" />
                {t('enterFullScreen')}
              </button>
            </div>
          )}

          {!isFullscreen && !showFullscreenPrompt && showFullscreenControl && (
            <button
              type="button"
              onClick={enterFullscreen}
              className={`absolute bottom-6 ${rtl ? 'left-6' : 'right-6'} z-[60] flex items-center gap-2 rounded-xl bg-black/70 px-4 py-3 text-sm font-bold text-white shadow-lg backdrop-blur transition-opacity hover:bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white`}
            >
              <Maximize2 className="h-5 w-5" />
              {t('fullScreen')}
            </button>
          )}

          {realDisplayIsPaired && !developmentPreview && (
            <button
              type="button"
              onClick={() => void logoutPassengerDisplay()}
              aria-label="Disconnect passenger display"
              title="Disconnect passenger display"
              data-testid="button-passenger-logout"
              className="absolute bottom-2 left-2 z-[90] flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white opacity-[0.12] transition-opacity hover:opacity-70 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}

          {developmentPreview && (
            <div className="absolute left-4 top-4 z-[90] flex items-center gap-3 rounded-xl border border-amber-300/40 bg-amber-950/90 px-4 py-2 text-sm font-bold text-amber-100 shadow-lg">
              <span>Development preview · demo data</span>
              <button
                type="button"
                onClick={exitDevelopmentPreview}
                className="rounded-lg bg-amber-100 px-3 py-1 text-amber-950 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Exit preview
              </button>
            </div>
          )}

          {isFullscreen && (
            <button
              type="button"
              onClick={exitFullscreen}
              className={`absolute ${rtl ? 'left-5' : 'right-5'} top-5 z-[80] rounded-xl border border-white/20 bg-black/75 px-5 py-3 text-sm font-bold text-white shadow-xl backdrop-blur hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white`}
            >
              {t('exitFullScreen')}
            </button>
          )}
          
        </div>
      </div>
    </div>
  );
}
