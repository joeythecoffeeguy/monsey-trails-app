import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPersonalBusNumber, useLiveTrip, useLiveTripRefreshStatus, type JourneyProgressItem } from '@/providers/live-trip';
import { Map, Info, AlertTriangle, WifiOff, RefreshCw, Bell, BellRing, ChevronLeft, Loader2, Radio } from 'lucide-react';
import { getTranslation, isRTL } from '@/lib/translations';
import { format } from 'date-fns';
import { AnnouncementsView } from '@/components/passenger/views/AnnouncementsView';
import { MonseyInfoView } from '@/components/passenger/views/MonseyInfoView';
import { SafetyBriefingView } from '@/components/passenger/views/SafetyBriefingView';
import { ChargingAmenitiesView } from '@/components/passenger/views/ChargingAmenitiesView';
import { PersonalUnpairedView, type PassengerScheduleFilters, type PassengerStopSelection } from './PersonalUnpairedView';
import { PersonalJourneyMap } from './PersonalJourneyMap';
import { usePassengerJourney, type PassengerJourneyStop } from './usePassengerJourney';
import { ServiceDisruptionNotices } from '@/components/passenger/ServiceDisruptionNotices';
import { PersonalLiveTrackingView } from './PersonalLiveTrackingView';
import { genuineLiveTrackingAvailable } from './liveTracking';
import { formatJourneyTime } from './journeyTime';
import {
  backgroundAlertsSupported,
  enableBackgroundStopAlert,
  getSelectedStopAlert,
  type SelectedStopAlert,
} from '@/lib/background-stop-alerts';
import { StopNote } from '@/components/passenger/StopNote';
import { StopProgressBadge } from './StopProgressBadge';
import { TransferAssistance } from './TransferAssistance';
import { LocationConfidenceIndicator } from '@/components/passenger/LocationConfidenceIndicator';
import { PassengerPreferenceButton, PassengerTripActions, personalPreferenceClasses, usePersonalPreferences } from './PassengerWebControls';
import { rememberPassengerTrip } from './passengerWebStorage';
import { DepartureReminderPanel } from './DepartureReminderPanel';

function getStopDelay(stop: PassengerJourneyStop, trafficStatus: string): { status: 'on-time' | 'delayed' | 'severely-delayed' | 'live-estimate' | 'stale', text: string } | null {
  if (!stop.estimatedArrivalAt) return null;
  
  if (trafficStatus !== 'live') {
    return { status: 'stale', text: trafficStatus === 'stale' ? 'Last estimate' : 'Awaiting live update' };
  }

  if (!stop.scheduledAt) {
    return { status: 'live-estimate', text: 'Live estimate' };
  }

  const est = new Date(stop.estimatedArrivalAt).getTime();
  const sch = new Date(stop.scheduledAt).getTime();
  const diffMinutes = Math.ceil((est - sch) / 60000);

  if (diffMinutes <= 2) {
    return { status: 'on-time', text: 'On time' };
  }
  if (diffMinutes >= 15) {
    return { status: 'severely-delayed', text: `${diffMinutes} min delayed` };
  }
  return { status: 'delayed', text: `${diffMinutes} min delayed` };
}

function DelayBadge({ stop, trafficStatus }: { stop: PassengerJourneyStop, trafficStatus: string }) {
  const delay = getStopDelay(stop, trafficStatus);
  if (!delay) return null;

  const colors = {
    'on-time': 'bg-green-100 text-green-800 border-green-200',
    'delayed': 'bg-amber-100 text-amber-800 border-amber-200',
    'severely-delayed': 'bg-red-100 text-red-800 border-red-200',
    'live-estimate': 'bg-brand-ink/10 text-brand-ink border-brand-ink/20',
    'stale': 'bg-gray-100 text-gray-600 border-gray-200'
  };

  return (
    <div className={`text-[10px] font-black px-1.5 py-0.5 rounded border uppercase tracking-wider ${colors[delay.status]}`}>
      {delay.text}
    </div>
  );
}

function PublishedJourneyArrival({
  scheduledArrivalAt,
  arrivalVerification,
  serviceDate,
  showImportantTripInformation,
}: {
  scheduledArrivalAt: string | null;
  arrivalVerification?: 'verified' | 'unverified' | 'unavailable';
  serviceDate: string;
  showImportantTripInformation: boolean;
}) {
  const [informationOpen, setInformationOpen] = useState(false);
  if (arrivalVerification === 'unverified') {
    return (
      <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
        <div className="font-black">Published arrival date mismatch</div>
        <div className="mt-0.5 text-xs font-medium">The published arrival does not match this trip date, so it is not shown. Traffic estimates below are separate.</div>
      </div>
    );
  }

  if (!scheduledArrivalAt || arrivalVerification === 'unavailable') {
    return (
      <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
        <div className="font-black">Published arrival unavailable</div>
        <div className="mt-0.5 text-xs font-medium">Traffic estimates below are separate and may still be available.</div>
      </div>
    );
  }

  if (arrivalVerification !== 'verified') {
    return (
      <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
        <div className="font-black">Published arrival unverified</div>
        <div className="mt-0.5 text-xs font-medium">The arrival time cannot be verified for this trip. Traffic estimates below are separate.</div>
      </div>
    );
  }

  return (
    <div className="mb-4 grid gap-2 sm:grid-cols-2">
      <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
        <span className="font-bold text-muted-foreground">Published arrival: </span>
        <span className="font-black text-foreground">{formatJourneyTime(scheduledArrivalAt, serviceDate)}</span>
      </div>
      {showImportantTripInformation && (
        <div className="rounded-xl border border-amber-300 bg-amber-50">
          <button
            type="button"
            onClick={() => setInformationOpen((open) => !open)}
            aria-expanded={informationOpen}
            className="flex w-full items-center gap-2 p-3 text-left text-sm font-black text-amber-950"
          >
            <Info className="h-4 w-4 shrink-0 text-amber-700" />
            <span className="flex-1">Important trip information</span>
            <span className="text-xs text-amber-700">{informationOpen ? 'Hide' : 'View'}</span>
          </button>
          {informationOpen && (
            <div className="border-t border-amber-200 px-3 pb-3 pt-2 text-xs font-semibold leading-relaxed text-amber-950">
              15 minutes prior to schedule time • across Ohr Sameach • in front of the nursing home • ON SCHEDULE time • bus shelter • across West Central • In front of Amazing Savings • bus shelter • in front of the Mobil gas station
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface PersonalPassengerViewProps {
  selectedRunKey: string;
  setSelectedRunKey: (v: string) => void;
  departureTime: string;
  setDepartureTime: (v: string) => void;
  connectedBusNumber: string;
  connectionError: string;
  setConnectionError: (v: string) => void;
  connectionBusy: boolean;
  connectPassengerDisplay: (runKey?: string, scheduledTime?: string, filters?: PassengerScheduleFilters) => Promise<void>;
  returnToSchedule: () => void;
  scheduleFilters: PassengerScheduleFilters;
  setScheduleFilters: (filters: PassengerScheduleFilters) => void;
  personalView: 'trip' | 'live';
  openLiveTracking: () => void;
  returnToTripDetails: () => void;
  initialStopSelection?: PassengerStopSelection | null;
}

export function PersonalPassengerView({
  selectedRunKey,
  setSelectedRunKey,
  departureTime,
  setDepartureTime,
  connectedBusNumber,
  connectionError,
  setConnectionError,
  connectionBusy,
  connectPassengerDisplay,
  returnToSchedule,
  scheduleFilters,
  setScheduleFilters,
  personalView,
  openLiveTracking,
  returnToTripDetails,
  initialStopSelection = null,
}: PersonalPassengerViewProps) {
  const liveTrip = useLiveTrip();
  const refreshStatus = useLiveTripRefreshStatus();
  const displayIsPaired = Boolean(connectedBusNumber);
  const assignedBusNumber = getPersonalBusNumber();
  const preferences = usePersonalPreferences();
  const lang = preferences.language;
  const rtl = isRTL(lang);
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(lang, key);
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const online = () => setBrowserOnline(true);
    const offline = () => setBrowserOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  const { data: journey, isLoading: journeyLoading, error: journeyError, refetch: refetchJourney } = usePassengerJourney(selectedRunKey, displayIsPaired);
  const [manualJourneyRefresh, setManualJourneyRefresh] = useState(false);
  const refreshJourney = useCallback(async () => {
    if (manualJourneyRefresh) return;
    setManualJourneyRefresh(true);
    try {
      await refetchJourney();
    } finally {
      setManualJourneyRefresh(false);
    }
  }, [manualJourneyRefresh, refetchJourney]);

  const destinationLabel = journey?.destinationName ?? t('awaitingDeparture');
  const offlineMode = !browserOnline || Boolean(journey?.offlineSavedAt);
  const [stopSelection, setStopSelection] = useState<PassengerStopSelection | null>(initialStopSelection);
  useEffect(() => {
    if (!journey || !departureTime) return;
    rememberPassengerTrip({
      runKey: selectedRunKey,
      departureTime,
      filters: scheduleFilters,
      originName: journey.originName,
      destinationName: journey.destinationName,
      ...(stopSelection?.runKey === selectedRunKey && stopSelection.pickup
        ? { pickupStop: {
            id: stopSelection.pickup.id,
            label: stopSelection.pickup.label,
            ...(stopSelection.pickup.note ? { note: stopSelection.pickup.note } : {}),
            lat: stopSelection.pickup.lat,
            lng: stopSelection.pickup.lng,
          } }
        : {}),
      ...(stopSelection?.runKey === selectedRunKey && stopSelection.dropoff
        ? { dropoffStop: {
            id: stopSelection.dropoff.id,
            label: stopSelection.dropoff.label,
            ...(stopSelection.dropoff.note ? { note: stopSelection.dropoff.note } : {}),
            lat: stopSelection.dropoff.lat,
            lng: stopSelection.dropoff.lng,
          } }
        : {}),
      savedAt: new Date().toISOString(),
    });
  }, [departureTime, journey?.originName, journey?.destinationName, scheduleFilters, selectedRunKey, stopSelection]);

  const [activeTab, setActiveTab] = useState<'route' | 'info'>('route');
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const stopRefs = useRef(new globalThis.Map<string, HTMLButtonElement>());
  useEffect(() => setSelectedStopId(null), [selectedRunKey]);
  const selectStop = useCallback((stopId: string, scrollToList = false) => {
    setSelectedStopId(stopId);
    if (scrollToList) {
      window.requestAnimationFrame(() => {
        stopRefs.current.get(stopId)?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
          block: 'center',
        });
      });
    }
  }, []);
  const selectStopFromMap = useCallback((stopId: string) => selectStop(stopId, true), [selectStop]);
  const showFullRoute = useCallback(() => setSelectedStopId(null), []);
  const [infoSection, setInfoSection] = useState<'announcements' | 'guide' | 'fares' | 'destinations' | 'safety' | 'amenities'>('announcements');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 10_000);
    window.addEventListener('focus', update);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', update); };
  }, []);
  
  const alertStops = useMemo<SelectedStopAlert[]>(() => {
    if (liveTrip.destination && (liveTrip.status === 'ready' || liveTrip.status === 'running')) {
      const progress = liveTrip.journeyProgress;
      if (progress?.length) {
        return progress.filter((stop) => stop.status !== 'completed').map((stop) => ({
          key: stop.kind === 'destination' ? `destination:${stop.lat}:${stop.lng}` : `stop:${stop.id}`,
          label: stop.address,
        }));
      }
      return [...liveTrip.intermediateStops.map((stop) => ({
        key: `stop:${stop.id}`,
        label: stop.address,
      })), {
        key: `destination:${liveTrip.destination.lat}:${liveTrip.destination.lng}`,
        label: destinationLabel,
      }];
    }
    return [];
  }, [liveTrip.destination, liveTrip.status, liveTrip.intermediateStops, liveTrip.journeyProgress, destinationLabel]);
  
  const [selectedAlertKey, setSelectedAlertKey] = useState(() => getSelectedStopAlert()?.key ?? '');
  const [enabledAlert, setEnabledAlert] = useState(getSelectedStopAlert);
  const [alertBusy, setAlertBusy] = useState(false);
  const [alertError, setAlertError] = useState('');

  async function enableStopAlert() {
    const stop = alertStops.find((candidate) => candidate.key === selectedAlertKey);
    if (!stop) {
      setAlertError('Choose your stop first.');
      return;
    }
    setAlertBusy(true);
    setAlertError('');
    try {
      setEnabledAlert(await enableBackgroundStopAlert(stop));
    } catch (error) {
      setAlertError(error instanceof Error ? error.message : 'Could not enable phone alerts.');
    } finally {
      setAlertBusy(false);
    }
  }

  const locationIsLive = liveTrip.locationVisibility === 'live';
  
  const isLocationFresh = useMemo(() => {
    if (!liveTrip.locationUpdatedAt) return false;
    const ageSeconds = (now - new Date(liveTrip.locationUpdatedAt).getTime()) / 1000;
    return ageSeconds >= 0 && ageSeconds <= 90;
  }, [liveTrip.locationUpdatedAt, now]);

  const currentLocation = locationIsLive && isLocationFresh ? liveTrip.currentLocation : null;

  const derivedTrafficStatus = useMemo(() => {
    if (!journey) return 'unavailable';
    if (journey.trafficStatus === 'live') {
      const ageSeconds = journey.trafficUpdatedAt ? (now - new Date(journey.trafficUpdatedAt).getTime()) / 1000 : NaN;
      if (!Number.isFinite(ageSeconds) || ageSeconds > 90 || ageSeconds < 0) {
        return 'stale';
      }
    }
    return journey.trafficStatus;
  }, [journey, now]);

  const overallDelayStatus = useMemo(() => {
    if (!journey || derivedTrafficStatus !== 'live') return null;
    const nextStop = journey.stops.find(s => s.scheduledAt && s.estimatedArrivalAt && new Date(s.estimatedArrivalAt).getTime() > now);
    if (nextStop) return getStopDelay(nextStop, derivedTrafficStatus);
    return null;
  }, [journey, derivedTrafficStatus, now]);

  const liveTrackingAvailable = !offlineMode && genuineLiveTrackingAvailable(liveTrip, assignedBusNumber, now);

  if (!selectedRunKey) {
    return <PersonalUnpairedView
      selectedRunKey={selectedRunKey} setSelectedRunKey={setSelectedRunKey}
      departureTime={departureTime} setDepartureTime={setDepartureTime}
      connectionError={connectionError} setConnectionError={setConnectionError}
      connectionBusy={connectionBusy} connectPassengerDisplay={connectPassengerDisplay}
      scheduleFilters={scheduleFilters} setScheduleFilters={setScheduleFilters}
      onStopSelection={setStopSelection}
    />;
  }

  if (personalView === 'live' && !offlineMode) {
    return (
      <div className={`relative h-[100dvh] ${personalPreferenceClasses(preferences)}`} dir={rtl ? 'rtl' : 'ltr'}>
        <div className="absolute end-16 top-[calc(0.65rem+env(safe-area-inset-top))] z-50 text-white">
          <PassengerPreferenceButton />
        </div>
        <PersonalLiveTrackingView
          trip={liveTrip}
          assignedBusNumber={assignedBusNumber}
          journey={journey}
          now={now}
          onBack={returnToTripDetails}
        />
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-[100dvh] bg-background text-foreground overflow-hidden ${personalPreferenceClasses(preferences)}`} dir={rtl ? 'rtl' : 'ltr'}>
      {/* Top Header */}
      <header className="flex-none bg-secondary text-secondary-foreground px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3 flex items-center justify-between z-20 shadow-md">
        <div className="flex items-center gap-3 min-w-0">
          <img src={`${import.meta.env.BASE_URL}monsey-trails-logo.png`} alt="Monsey Trails" className="h-6 w-auto brightness-0 invert shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="text-xs text-secondary-foreground/70 font-semibold uppercase tracking-wider truncate">
              {destinationLabel}
            </span>
            <span className="text-sm font-bold truncate">
              {assignedBusNumber ? `${t('coachLabel')} ${assignedBusNumber}` : 'Coach TBD'}
            </span>
            {journey && <span className="text-xs font-semibold text-secondary-foreground/70">
              {format(new Date(`${journey.serviceDate}T12:00:00`), 'MMM d')} • {journey.scheduledDepartureAt ? formatJourneyTime(journey.scheduledDepartureAt, journey.serviceDate) : 'No time'}
            </span>}
          </div>
        </div>
        
        <div className="flex items-center gap-3 shrink-0" dir="ltr">
          <PassengerTripActions
            runKey={selectedRunKey}
            departureTime={departureTime}
            filters={scheduleFilters}
            originName={journey?.originName}
            destinationName={journey?.destinationName}
            pickupStop={stopSelection?.runKey === selectedRunKey && stopSelection.pickup ? {
              id: stopSelection.pickup.id,
              label: stopSelection.pickup.label,
              ...(stopSelection.pickup.note ? { note: stopSelection.pickup.note } : {}),
              lat: stopSelection.pickup.lat,
              lng: stopSelection.pickup.lng,
            } : undefined}
            dropoffStop={stopSelection?.runKey === selectedRunKey && stopSelection.dropoff ? {
              id: stopSelection.dropoff.id,
              label: stopSelection.dropoff.label,
              ...(stopSelection.dropoff.note ? { note: stopSelection.dropoff.note } : {}),
              lat: stopSelection.dropoff.lat,
              lng: stopSelection.dropoff.lng,
            } : undefined}
          />
          <PassengerPreferenceButton />
          {refreshStatus.lastRefreshFailed && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-destructive/20 text-destructive text-[10px] font-bold uppercase tracking-wider">
              <WifiOff className="w-3 h-3" />
              <span>{t('gpsOffline')}</span>
            </div>
          )}
          <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-live="polite">
            {!refreshStatus.lastRefreshFailed && refreshStatus.isRefreshing && (
              <RefreshCw className="h-4 w-4 text-secondary-foreground/50 animate-spin" aria-label="Refreshing live trip" />
            )}
          </span>
          <button 
            onClick={() => {
              returnToSchedule();
            }}
            className="px-3 py-1.5 rounded-full bg-white/10 text-xs font-bold hover:bg-white/20 transition-colors flex items-center gap-1.5"
            aria-label="Other departures"
          >
            <ChevronLeft className="w-4 h-4 -ml-1" />
            <span className="hidden sm:inline">Other departures</span>
            <span className="sm:hidden">Back</span>
          </button>
        </div>
      </header>

      <ServiceDisruptionNotices disruptions={liveTrip.disruptions ?? journey?.disruptions} />

      {stopSelection?.runKey === selectedRunKey && stopSelection.pickup && (
        <section className="flex-none border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-emerald-950" aria-label="Boarding help">
          <div className="mx-auto flex max-w-3xl items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">Where do I wait?</p>
              <p className="truncate text-sm font-black">{stopSelection.pickup.label}</p>
              {stopSelection.pickup.note && <StopNote note={stopSelection.pickup.note} label={stopSelection.pickup.label} className="mt-0.5 text-xs font-semibold" />}
            </div>
            {offlineMode ? (
              <span className="shrink-0 rounded-full bg-emerald-800/40 px-3 py-2 text-xs font-black text-white" aria-disabled="true">Map offline</span>
            ) : (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${stopSelection.pickup.lat},${stopSelection.pickup.lng}`)}`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded-full bg-emerald-800 px-3 py-2 text-xs font-black text-white"
              >
                Open map
              </a>
            )}
          </div>
        </section>
      )}
      {offlineMode && (
        <div role="status" className="flex-none border-b border-amber-300 bg-amber-50 px-4 py-2 text-center text-xs font-bold text-amber-900">
          <WifiOff className="me-1 inline h-3.5 w-3.5" />
          {journey?.offlineSavedAt
            ? `Saved schedule from ${new Date(journey.offlineSavedAt).toLocaleString()}. Times are offline and are not live updates.`
            : 'You are offline. Live GPS, maps, and live times are unavailable.'}
          {import.meta.env.DEV && ' Offline reload is supported by the production-built passenger app, not the Vite development preview.'}
        </div>
      )}

      {alertStops.length > 0 && (
        <section className="flex-none border-b border-border bg-card px-3 py-2" aria-label="Stop notification">
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            {enabledAlert ? <BellRing className="h-5 w-5 shrink-0 text-primary" /> : <Bell className="h-5 w-5 shrink-0 text-muted-foreground" />}
            <select
              aria-label="Choose the stop for your phone alert"
              value={selectedAlertKey}
              onChange={(event) => {
                setSelectedAlertKey(event.target.value);
                setAlertError('');
              }}
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-2 text-sm font-semibold"
            >
              <option value="">Choose my stop…</option>
              {alertStops.map((stop) => <option key={stop.key} value={stop.key}>{stop.label}</option>)}
            </select>
            <button
              type="button"
              disabled={alertBusy || !selectedAlertKey}
              onClick={() => void enableStopAlert()}
              className="shrink-0 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {alertBusy ? 'Enabling…' : enabledAlert?.key === selectedAlertKey ? 'Alert on' : 'Alert me'}
            </button>
          </div>
          {enabledAlert && !alertError && (
            <p className="mx-auto mt-1 max-w-3xl text-xs font-medium text-primary">
              Phone alert set for {enabledAlert.label}.
            </p>
          )}
          {alertError && (
            <p className="mx-auto mt-1 max-w-3xl text-xs font-medium text-destructive">
              {alertError}
              {!backgroundAlertsSupported() ? ' This requires an installed web app on iPhone.' : ''}
            </p>
          )}
        </section>
      )}

      {/* Emergency Overlay (if any) */}
      {liveTrip.emergencyOverride && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-destructive/95 p-6 backdrop-blur-sm animate-in fade-in">
          <AlertTriangle className="w-20 h-20 text-white mb-6 animate-pulse" />
          <h2 className="text-3xl font-bold text-white text-center mb-4">{t('attention')}</h2>
          <p className="text-xl text-white/90 text-center font-medium max-w-sm">{liveTrip.emergencyMessage}</p>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 min-h-0 relative overflow-hidden flex flex-col md:flex-row">
        {activeTab === 'route' ? (
          <>
            {/* Map Area */}
            <div className="h-[32dvh] min-h-[11rem] flex-none md:h-auto md:min-h-0 md:flex-[2] relative overflow-hidden bg-[#e8f4ea] border-b md:border-b-0 border-border z-10">
              {offlineMode ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-muted p-6 text-center">
                  <WifiOff className="mb-2 h-8 w-8 text-muted-foreground" />
                  <p className="font-black">Map unavailable offline</p>
                  <p className="mt-1 text-xs font-medium text-muted-foreground">Use the saved stop list below. No live coach location is shown.</p>
                </div>
              ) : journey ? (
                <PersonalJourneyMap 
                  routeGeometry={journey.routeGeometry} 
                  stops={journey.stops} 
                  liveCoach={locationIsLive ? currentLocation : null} 
                   journeyProgress={liveTrip.journeyProgress}
                   selectedStopId={selectedStopId}
                   onSelectStop={selectStopFromMap}
                   onShowFullRoute={showFullRoute}
                />
              ) : journeyError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4 bg-background">
                  <AlertTriangle className="w-8 h-8 text-destructive mb-2" />
                  <p className="text-sm font-bold text-destructive">{journeyError.message}</p>
                  <button onClick={() => void refreshJourney()} className="mt-4 px-4 py-2 bg-primary text-primary-foreground rounded-full text-xs font-bold shadow-sm">Retry</button>
                </div>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-brand-ink" /></div>
              )}
            </div>
            
            {/* Route Sequence Area */}
            <div className="flex-1 min-h-0 md:flex-[3] bg-card border-t md:border-t-0 md:border-l border-border flex flex-col relative z-20 shadow-[0_-10px_30px_rgba(0,0,0,0.05)] md:shadow-none">
              {journey ? (
                <>
                   <div className="p-4 border-b border-border bg-muted/30 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-sm font-black text-foreground">
                        {journey.originName} to {journey.destinationName}
                      </h2>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                         {!offlineMode && <LocationConfidenceIndicator trip={liveTrip} now={now} />}
                        <p className="text-[11px] font-bold text-muted-foreground flex items-center gap-1.5 uppercase tracking-wider">
                          <Radio className={`w-3 h-3 ${derivedTrafficStatus === 'live' ? 'text-green-500' : 'text-muted-foreground'}`} />
                          {derivedTrafficStatus === 'live' ? 'Live Traffic' : derivedTrafficStatus === 'forecast' ? 'Typical Traffic' : derivedTrafficStatus === 'stale' ? 'Stale Traffic' : 'Scheduled Times'}
                          {journey.trafficUpdatedAt && <span className="normal-case tracking-normal text-xs font-medium opacity-80"> • Updated {formatJourneyTime(journey.trafficUpdatedAt, journey.serviceDate)}</span>}
                        </p>
                        {overallDelayStatus && (
                          <div className={`text-[10px] font-black px-1.5 py-0.5 rounded border uppercase tracking-wider ${
                            overallDelayStatus.status === 'on-time' ? 'bg-green-100 text-green-800 border-green-200' : 
                            overallDelayStatus.status === 'delayed' ? 'bg-amber-100 text-amber-800 border-amber-200' : 
                            overallDelayStatus.status === 'severely-delayed' ? 'bg-red-100 text-red-800 border-red-200' : 
                            'bg-brand-ink/10 text-brand-ink border-brand-ink/20'
                          }`}>
                            Overall {overallDelayStatus.text}
                          </div>
                        )}
                      </div>
                    </div>
                     <div className="flex shrink-0 items-center gap-2">
                       {liveTrackingAvailable && (
                         <button
                           type="button"
                           onClick={openLiveTracking}
                           className="rounded-full bg-primary px-3 py-2 text-xs font-black text-primary-foreground shadow-sm"
                         >
                           View live tracking
                         </button>
                       )}
                       <button
                          type="button"
                          onClick={() => void refreshJourney()}
                           disabled={manualJourneyRefresh || offlineMode}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-brand-ink hover:bg-black/5 disabled:opacity-60"
                         aria-label="Refresh route"
                          aria-busy={manualJourneyRefresh}
                       >
                          <RefreshCw className={`h-4 w-4 ${manualJourneyRefresh ? 'animate-spin' : ''}`} />
                       </button>
                     </div>
                  </div>
                  <div data-testid="journey-stop-scroller" className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-5">
                     <DepartureReminderPanel runKey={selectedRunKey} />
                    {journey.message && (
                      <div className="mb-6 bg-secondary/5 border border-secondary/20 text-secondary text-sm p-3 rounded-xl font-medium">
                        {journey.message}
                      </div>
                    )}
                     <PublishedJourneyArrival
                       scheduledArrivalAt={journey.scheduledArrivalAt}
                       arrivalVerification={journey.arrivalVerification}
                       serviceDate={journey.serviceDate}
                        showImportantTripInformation={journey.stops.some((stop) => Boolean(stop.note))}
                     />
                      <TransferAssistance runKey={journey.runKey} serviceDate={journey.serviceDate} />
                      <div className="space-y-6 pb-4">
                        {(!offlineMode && liveTrip.journeyProgress?.length
                         ? liveTrip.journeyProgress.map((progress) => {
                           const source = journey.stops.find((stop) => stop.id === progress.id);
                           return {
                             ...source,
                             id: progress.id,
                             label: progress.address,
                             lat: progress.lat,
                             lng: progress.lng,
                             kind: progress.kind ?? source?.kind ?? 'pickup',
                             estimatedArrivalAt: progress.eta,
                             scheduledAt: source?.scheduledAt ?? null,
                             journeyStatus: progress.status,
                           };
                         })
                         : journey.stops.map((stop) => ({ ...stop, journeyStatus: undefined as JourneyProgressItem['status'] | undefined }))
                       ).map((stop, index, stops) => (
                        <button
                          type="button"
                          key={stop.id}
                          ref={(node) => {
                            if (node) stopRefs.current.set(stop.id, node);
                            else stopRefs.current.delete(stop.id);
                          }}
                          onClick={() => selectStop(stop.id)}
                          aria-pressed={selectedStopId === stop.id}
                            className={`group grid w-full grid-cols-[2rem_minmax(0,1fr)] items-start gap-3 rounded-xl py-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary ${
                             selectedStopId === stop.id ? 'bg-primary/10 ring-2 ring-primary/30' : stop.journeyStatus === 'current' ? 'bg-primary/5 ring-1 ring-primary/30' : ''
                          }`}
                        >
                           <div className={`relative z-10 mt-0.5 flex h-6 w-6 items-center justify-center justify-self-center rounded-full border-2 text-[11px] font-black shadow-sm ring-4 ring-card transition-colors ${
                             stop.journeyStatus === 'completed' ? 'border-green-600 bg-green-600 text-white' : selectedStopId === stop.id || stop.journeyStatus === 'current' ? 'border-primary bg-primary text-primary-foreground' : 'border-primary bg-card text-brand-ink group-hover:bg-primary group-hover:text-primary-foreground'
                          }`}>
                            {index + 1}
                              {index < stops.length - 1 && (
                               <span
                                 aria-hidden="true"
                                 className="absolute left-1/2 top-[calc(100%+0.25rem)] h-[calc(100%+1.5rem)] w-0.5 -translate-x-1/2 bg-primary/20"
                               />
                             )}
                          </div>

                           <div className="min-w-0 space-y-1.5 overflow-hidden pr-2">
                             <div className="flex min-w-0 items-start justify-between gap-2">
                               <div className="min-w-0">
                                 <div className="break-words text-sm font-bold leading-tight text-foreground">
                                    {stop.label}
                                   {stop.kind === 'dropoff' && <span className="ml-2 inline-block px-1.5 py-0.5 bg-secondary/10 text-secondary text-[9px] uppercase tracking-wider rounded-sm">Dropoff</span>}
                                   {stop.kind === 'pickup' && <span className="ml-2 inline-block px-1.5 py-0.5 bg-brand-ink/10 text-brand-ink text-[9px] uppercase tracking-wider rounded-sm">Pickup</span>}
                                     <StopProgressBadge
                                       progress={liveTrip.journeyProgress?.find((item) => item.id === stop.id)}
                                       currentLocation={currentLocation}
                                     />
                                    {stop.journeyStatus === 'current' && <span className="ml-2 inline-block rounded-sm bg-primary/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-primary">Current</span>}
                                 </div>
                                 <StopNote
                                   note={stop.note}
                                   label={stop.label}
                                   className="mt-1 line-clamp-3 text-xs font-medium leading-relaxed text-muted-foreground"
                                 />
                              </div>
                                <DelayBadge stop={stop as PassengerJourneyStop} trafficStatus={derivedTrafficStatus} />
                            </div>
                             <div className="flex flex-wrap items-center gap-3">
                               {stop.scheduledAt && (
                                 <div className="text-xs font-medium text-muted-foreground">
                                    Published stop: {formatJourneyTime(stop.scheduledAt, journey.serviceDate)}
                                 </div>
                               )}
                                {stop.estimatedArrivalAt && stop.journeyStatus !== 'completed' && (
                                 <div className="text-xs font-black text-brand-ink bg-brand-ink/10 px-1.5 py-0.5 rounded border border-brand-ink/20">
                                    {journey.trafficStatus === 'live' ? 'Live ETA' : 'Traffic estimate'}: {formatJourneyTime(stop.estimatedArrivalAt, journey.serviceDate)}
                                 </div>
                               )}
                             </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="text-muted-foreground flex flex-col items-center gap-2">
                    <Loader2 className="w-6 h-6 animate-spin text-brand-ink" />
                    <p className="text-sm font-bold">Loading route details...</p>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 bg-card">
            {/* Info Tabs Sub-navigation */}
            <div className="grid grid-cols-3 px-2 py-2 gap-2 border-b border-border/50 bg-muted/20">
              {[
                { id: 'announcements', label: t('announcementsLabel') },
                { id: 'guide', label: t('guideLabel') },
                { id: 'fares', label: t('faresLabel') },
                { id: 'destinations', label: t('destinationsLabel') },
                { id: 'amenities', label: t('amenitiesLabel') },
                { id: 'safety', label: t('safetyLabel') },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setInfoSection(tab.id as typeof infoSection)}
                  className={`min-w-0 px-2 py-2 rounded-full text-xs sm:text-sm font-bold transition-colors ${
                    infoSection === tab.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-background border border-border hover:bg-muted'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            
            <div className="flex-1 overflow-y-auto">
              <div className="min-h-full">
                {infoSection === 'announcements' && <AnnouncementsView compact />}
                {infoSection === 'guide' && <MonseyInfoView section="guide" compact />}
                {infoSection === 'fares' && <MonseyInfoView section="fares" compact />}
                {infoSection === 'destinations' && <MonseyInfoView section="destinations" compact />}
                {infoSection === 'safety' && <SafetyBriefingView compact />}
                {infoSection === 'amenities' && <ChargingAmenitiesView compact />}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Navigation */}
      <nav className="flex-none bg-background border-t border-border pb-[env(safe-area-inset-bottom)] z-20 shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
        <div className="flex items-center">
          <button 
            onClick={() => setActiveTab('route')}
            aria-current={activeTab === 'route' ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 ${activeTab === 'route' ? 'text-brand-ink' : 'text-muted-foreground'}`}
          >
            <Map className="w-6 h-6" />
             <span className="text-[10px] font-bold uppercase tracking-widest">{offlineMode ? 'Saved route' : t('liveGps')}</span>
          </button>
          
          <button 
            onClick={() => setActiveTab('info')}
            aria-current={activeTab === 'info' ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center justify-center py-3 gap-1 relative ${activeTab === 'info' ? 'text-brand-ink' : 'text-muted-foreground'}`}
          >
            <Info className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase tracking-widest">{t('passengerInformation')}</span>
            
            {liveTrip.announcements?.some(a => a.active) && (
              <span className="absolute top-2 right-[30%] w-2.5 h-2.5 bg-destructive rounded-full border-2 border-background" />
            )}
          </button>
        </div>
      </nav>
    </div>
  );
}
