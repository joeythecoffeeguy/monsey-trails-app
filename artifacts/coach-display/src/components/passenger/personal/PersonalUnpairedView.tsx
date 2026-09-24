import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ArrowDown, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Loader2, AlertCircle, MapPin, Repeat2, ExternalLink, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import {
  addServiceDays,
  getPassengerJourney,
  getNewYorkServiceDate,
  getScheduledDepartureInstant,
  getUpcomingScheduleRuns,
  type PassengerJourney,
  type PassengerJourneyStop,
} from '@workspace/api-client-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { BUS_LINES, SERVICE_AREAS, createOfficialRunKey, fetchOfficialSchedule, resolveOfficialStop, type OfficialSchedule, type OfficialScheduleRun, type OfficialStopPreview } from '@/providers/official-schedules';
import { ScheduleKeyBadges, ScheduleKeyLegend } from '@/components/schedule-keys';
import { ServiceDisruptionNotices } from '@/components/passenger/ServiceDisruptionNotices';
import { NewYorkSchedulePdf } from '@/components/new-york-schedule-pdf';
import { getTranslation, isRTL } from '@/lib/translations';
import { fetchPublicRunTrip, useLiveTrip, type JourneyProgressItem } from '@/providers/live-trip';
import { formatTripDuration } from '@/lib/trip-duration';
import { formatJourneyTime } from './journeyTime';
import { passengerStopIdentity } from '@workspace/passenger-stop-label';
import { StopProgressBadge } from './StopProgressBadge';
import { PassengerPreferenceButton, PassengerSavedTrips, personalPreferenceClasses, usePersonalPreferences } from './PassengerWebControls';
import { readPassengerSchedule, rememberPassengerTrip, savePassengerSchedule, type SavedPassengerStop, type SavedPassengerTrip } from './passengerWebStorage';

export interface PassengerScheduleFilters {
  line: number;
  origin: number;
  destination: number;
  date: string;
}

export interface PassengerStopSelection {
  runKey: string;
  pickup: PassengerJourneyStop | null;
  dropoff: PassengerJourneyStop | null;
}

type RunJourneyVerification =
  | { status: 'loading' }
  | { status: 'verified'; journey: PassengerJourney }
  | { status: 'unresolved'; message: string };

interface StopFilterOption {
  key: string;
  stop: PassengerJourneyStop;
}

interface PersonalUnpairedViewProps {
  selectedRunKey: string;
  setSelectedRunKey: (v: string) => void;
  departureTime: string;
  setDepartureTime: (v: string) => void;
  connectionError: string;
  setConnectionError: (v: string) => void;
  connectionBusy: boolean;
  connectPassengerDisplay: (runKey?: string, scheduledTime?: string, filters?: PassengerScheduleFilters) => Promise<void>;
  scheduleFilters: PassengerScheduleFilters;
  setScheduleFilters: (filters: PassengerScheduleFilters) => void;
  onStopSelection?: (selection: PassengerStopSelection) => void;
}

export function PersonalUnpairedView({
  selectedRunKey,
  setSelectedRunKey,
  departureTime,
  setDepartureTime,
  connectionError,
  setConnectionError,
  connectionBusy,
  connectPassengerDisplay,
  scheduleFilters,
  setScheduleFilters,
  onStopSelection,
}: PersonalUnpairedViewProps) {
  const liveTrip = useLiveTrip();
  const preferences = usePersonalPreferences();
  const lang = preferences.language;
  const rtl = isRTL(lang);

  const { line, origin, destination, date } = scheduleFilters;
  const [now, setNow] = useState(() => new Date());
  const today = getNewYorkServiceDate(now);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [showAllDepartures, setShowAllDepartures] = useState(date < today);

  const [schedule, setSchedule] = useState<OfficialSchedule | null>(null);
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleRefreshError, setScheduleRefreshError] = useState('');
  const [lastScheduleRefreshAt, setLastScheduleRefreshAt] = useState<Date | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [availabilityError, setAvailabilityError] = useState('');
  const [availableDestinationIds, setAvailableDestinationIds] = useState<number[]>([]);
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const [pickupStopKey, setPickupStopKey] = useState('');
  const [dropoffStopKey, setDropoffStopKey] = useState('');
  const [runJourneys, setRunJourneys] = useState<Record<string, RunJourneyVerification>>({});
  const latestScheduleFilters = useRef(scheduleFilters);
  const retrySelectedSchedule = useRef<() => void>(() => {});
  latestScheduleFilters.current = scheduleFilters;
  const scheduleCache = useRef(new Map<string, {
    fetchedAt: number;
    promise: Promise<OfficialSchedule>;
  }>());
  const scheduleRunSignature = schedule?.runs.map((run) => run.id).join('|') ?? '';

  const getSchedule = useCallback((
    requestedLine: number,
    requestedOrigin: number,
    requestedDestination: number,
    requestedDate: string,
    force = false,
  ) => {
    const key = `${requestedLine}|${requestedOrigin}|${requestedDestination}|${requestedDate}`;
    const cached = scheduleCache.current.get(key);
    if (!force && cached && Date.now() - cached.fetchedAt < 25_000) return cached.promise;
    const promise = fetchOfficialSchedule(
      requestedLine,
      requestedOrigin,
      requestedDestination,
      requestedDate,
    ).then((result) => {
      savePassengerSchedule(requestedLine, requestedOrigin, requestedDestination, requestedDate, result);
      return result;
    }).catch((error) => {
      if (scheduleCache.current.get(key)?.promise === promise) scheduleCache.current.delete(key);
      const saved = readPassengerSchedule(requestedLine, requestedOrigin, requestedDestination, requestedDate);
      if (saved) {
        return {
          ...saved,
          runs: saved.runs.map((run) => ({
            ...run,
            departureStatus: 'unavailable' as const,
            delayMinutes: null,
          })),
          offlineSavedAt: saved.offlineSavedAt,
        };
      }
      throw error;
    });
    scheduleCache.current.set(key, { fetchedAt: Date.now(), promise });
    return promise;
  }, []);

  useEffect(() => {
    const refreshNow = () => setNow(new Date());
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshNow();
    };
    const interval = window.setInterval(refreshNow, 30_000);
    window.addEventListener('focus', refreshNow);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshNow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const availableOrigins = useMemo(() => {
    if (!line) return [];
    return SERVICE_AREAS.filter(area => area.lines.includes(line));
  }, [line]);

  const candidateDestinations = useMemo(() => {
    if (!line || !origin) return [];
    const destinationIds = line === 1
      ? ([1, 2].includes(origin) ? [3, 4, 5, 6, 11, 12] : [1, 2])
      : line === 2
        ? ([1, 2].includes(origin) ? [10] : [1, 2])
        : ([7, 8].includes(origin) ? [9, 3] : [7, 8]);
    return SERVICE_AREAS.filter(area => area.lines.includes(line) && destinationIds.includes(area.id));
  }, [line, origin]);

  const availableDestinations = useMemo(
    () => candidateDestinations.filter((area) => availableDestinationIds.includes(area.id)),
    [availableDestinationIds, candidateDestinations],
  );

  useEffect(() => {
    if (!line || !origin || !date) return;
    let active = true;
    let firstLoad = true;
    let refreshInFlight = false;
    const requested = { line, origin, date };

    setAvailabilityLoading(true);
    setAvailabilityError('');
    setAvailableDestinationIds([]);
    setSchedule(null);

    const refresh = async (force = false) => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      const results = await Promise.allSettled(
        candidateDestinations.map((area) => getSchedule(line, origin, area.id, date, force)),
      );
      refreshInFlight = false;
      if (!active) return;
      const currentFilters = latestScheduleFilters.current;
      if (
        currentFilters.line !== requested.line
        || currentFilters.origin !== requested.origin
        || currentFilters.date !== requested.date
      ) return;
      const checkNow = new Date();
      const checkToday = getNewYorkServiceDate(checkNow);
      const available: number[] = [];
      const failed: number[] = [];
      results.forEach((result, index) => {
        const area = candidateDestinations[index];
        if (result.status === 'rejected' || isOfflineSchedule(result.value)) {
          failed.push(area.id);
          if (result.status === 'rejected') return;
        }
        if (result.value.runs.length > 0) available.push(area.id);
      });

      // A failed lookup is unknown, not proof that service is unavailable. Keep
      // that destination selectable and show an explicit retry message.
      const selectable = [...available, ...failed];
      setAvailableDestinationIds((current) =>
        current.length === selectable.length
        && current.every((id, index) => id === selectable[index])
          ? current
          : selectable,
      );
      setAvailabilityError(failed.length
        ? 'Some destinations could not be checked. Retry to see complete availability.'
        : '');
      if (!selectable.includes(currentFilters.destination) && available.length) {
        const preferred = results.findIndex((result) =>
          result.status === 'fulfilled'
          && hasUpcomingRuns(result.value, date, checkToday, checkNow),
        );
        setScheduleFilters({
          ...currentFilters,
          destination: preferred >= 0 ? candidateDestinations[preferred].id : available[0],
        });
      } else if (!selectable.includes(currentFilters.destination) && failed.length) {
        setScheduleFilters({ ...currentFilters, destination: failed[0] });
      }
      if (firstLoad) setAvailabilityLoading(false);
      firstLoad = false;
    };

    void refresh();
    const interval = window.setInterval(refresh, 30_000);
    const refreshNow = () => void refresh(true);
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshNow();
    };
    window.addEventListener('focus', refreshNow);
    window.addEventListener('online', refreshNow);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshNow);
      window.removeEventListener('online', refreshNow);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [availabilityRetry, candidateDestinations, date, getSchedule, line, origin]);

  useEffect(() => {
    setShowAllDepartures(date < today);
  }, [date, today]);

  useEffect(() => {
    if (
      line && origin && destination && date
      && !availabilityLoading
      && availableDestinationIds.includes(destination)
    ) {
      let active = true;
      let firstLoad = true;
      setLoadingSchedule(true);
      setScheduleError('');
      setScheduleRefreshError('');
      setSchedule(null);
      setSelectedRunId('');
      setSelectedRunKey('');
      setDepartureTime('');

      const refresh = (force = false) => {
        getSchedule(line, origin, destination, date, force)
          .then((res) => {
            if (!active) return;
            setSchedule(res);
            const sourceRefreshAt = new Date(res.fetchedAt);
            setLastScheduleRefreshAt(Number.isNaN(sourceRefreshAt.getTime()) ? new Date() : sourceRefreshAt);
            setScheduleError('');
            setScheduleRefreshError(isOfflineSchedule(res)
              ? 'Schedule could not be refreshed. Times shown may not be up to date.'
              : '');
          })
          .catch((err) => {
            if (!active) return;
            if (firstLoad) {
              setScheduleError(err instanceof Error ? err.message : 'Failed to load schedule');
            } else {
              setScheduleRefreshError('Schedule could not be refreshed. Times shown may not be up to date.');
            }
          })
          .finally(() => {
            if (!active) return;
            if (firstLoad) setLoadingSchedule(false);
            firstLoad = false;
          });
      };
      const refreshWhenVisible = () => {
        if (document.visibilityState === 'visible') refresh(true);
      };
      retrySelectedSchedule.current = () => refresh(true);
      refresh();
      const interval = window.setInterval(() => refresh(true), 30_000);
      const refreshNow = () => refresh(true);
      window.addEventListener('focus', refreshNow);
      window.addEventListener('online', refreshNow);
      document.addEventListener('visibilitychange', refreshWhenVisible);
      return () => {
        active = false;
        retrySelectedSchedule.current = () => {};
        window.clearInterval(interval);
        window.removeEventListener('focus', refreshNow);
        window.removeEventListener('online', refreshNow);
        document.removeEventListener('visibilitychange', refreshWhenVisible);
      };
    }
    return undefined;
  }, [availableDestinationIds, availabilityLoading, date, destination, getSchedule, line, origin, setDepartureTime]);

  useEffect(() => {
    setPickupStopKey('');
    setDropoffStopKey('');
  }, [date, destination, line, origin]);

  useEffect(() => {
    if (!schedule?.runs.length) {
      setRunJourneys({});
      return;
    }
    let active = true;
    const controller = new AbortController();
    const entries = schedule.runs.map((run) => ({
      run,
      runKey: createOfficialRunKey({ line, origin, destination, date, runId: run.id }),
    }));
    setRunJourneys(Object.fromEntries(entries.map(({ run }) => [run.id, { status: 'loading' as const }])));
    entries.forEach(({ run, runKey }) => {
      const [serviceDate, runLine, runOrigin, runDestination, runId] = runKey.split('|');
      void getPassengerJourney({
        date: serviceDate,
        line: Number(runLine) as 1 | 2 | 3,
        origin: Number(runOrigin),
        destination: Number(runDestination),
        runId,
      }, { signal: controller.signal }).then((journey) => {
        if (!active) return;
        const verified = journey.runKey === runKey
          && journey.stops.length > 0
          && journey.stops.every(validJourneyStop);
        setRunJourneys((current) => ({
          ...current,
          [run.id]: verified
            ? { status: 'verified', journey }
            : { status: 'unresolved', message: 'The exact stop list could not be verified.' },
        }));
      }).catch((error) => {
        if (!active || controller.signal.aborted) return;
        setRunJourneys((current) => ({
          ...current,
          [run.id]: {
            status: 'unresolved',
            message: error instanceof Error ? error.message : 'The exact stop list could not be verified.',
          },
        }));
      });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [date, destination, line, origin, scheduleRunSignature]);

  useEffect(() => {
    if (selectedRunId && schedule) {
      const run = schedule.runs.find(r => r.id === selectedRunId);
      if (run) {
        setDepartureTime(run.scheduledTime || run.firstPickupTime);
        setSelectedRunKey(createOfficialRunKey({
          line: Number(line),
          origin: Number(origin),
          destination: Number(destination),
          date,
          runId: run.id,
        }));
      } else {
        setSelectedRunId('');
        setDepartureTime('');
        setSelectedRunKey('');
      }
    } else {
      setDepartureTime('');
      setSelectedRunKey('');
    }
  }, [date, destination, line, origin, schedule, selectedRunId, setDepartureTime, setSelectedRunKey]);

  function chooseLine(nextLine: number) {
    const defaults = nextLine === 3 ? [7, 9] : nextLine === 2 ? [2, 10] : [2, 5];
    setScheduleFilters({
      ...scheduleFilters,
      line: nextLine,
      origin: defaults[0],
      destination: defaults[1],
    });
  }

  function chooseOrigin(nextOrigin: number) {
    setScheduleFilters({
      ...scheduleFilters,
      origin: nextOrigin,
      destination,
    });
  }

  const timeEligibleRuns = useMemo(() => {
    if (!schedule) return [];
    if (showAllDepartures || date < today) return schedule.runs;
    const notCompleted = schedule.runs.filter(run => run.departureStatus !== 'completed');
    if (date !== today) return notCompleted;
    const upcomingIds = new Set(getUpcomingScheduleRuns(notCompleted, date, now).map(run => run.id));
    return notCompleted.filter(run =>
      upcomingIds.has(run.id)
      || run.departureStatus === 'on_time'
      || run.departureStatus === 'delayed'
      || run.departureStatus === 'live_estimate'
      || run.departureStatus === 'unavailable',
    );
  }, [date, now, schedule, showAllDepartures, today]);

  const pickupStopOptions = useMemo(
    () => collectStopOptions(runJourneys, 'pickup'),
    [runJourneys],
  );
  const dropoffStopOptions = useMemo(
    () => collectStopOptions(runJourneys, 'dropoff'),
    [runJourneys],
  );
  const exactStopFilterActive = Boolean(pickupStopKey || dropoffStopKey);
  const displayedRuns = useMemo(() => timeEligibleRuns.filter((run) => {
    if (!exactStopFilterActive) return true;
    const verification = runJourneys[run.id];
    if (verification?.status !== 'verified') return false;
    return journeyServesSelection(verification.journey, pickupStopKey, dropoffStopKey);
  }), [dropoffStopKey, exactStopFilterActive, pickupStopKey, runJourneys, timeEligibleRuns]);
  const verifyingRunCount = Object.values(runJourneys).filter((value) => value.status === 'loading').length;
  const unresolvedRunCount = Object.values(runJourneys).filter((value) => value.status === 'unresolved').length;

  function adjustDate(days: number) {
    const next = addServiceDays(date, days);
    setScheduleFilters({ ...scheduleFilters, date: next });
  }

  function selectRun(run: OfficialScheduleRun) {
    if (!line || !origin || !destination) return;
    const scheduledTime = run.scheduledTime || run.firstPickupTime;
    const clickedAt = new Date();
    const clickedToday = getNewYorkServiceDate(clickedAt);
    const departure = getScheduledDepartureInstant(date, scheduledTime);
    const activeDeparture = run.departureStatus === 'on_time'
      || run.departureStatus === 'delayed'
      || run.departureStatus === 'live_estimate'
      || run.departureStatus === 'unavailable';
    if (!departure) {
      setSelectedRunId('');
      setSelectedRunKey('');
      setDepartureTime('');
      setConnectionError('This departure has an invalid published time. Please choose another departure.');
      return;
    }
    if (date < clickedToday || (date === clickedToday && departure <= clickedAt && !activeDeparture)) {
      setNow(clickedAt);
      setSelectedRunId('');
      setSelectedRunKey('');
      setDepartureTime('');
      setConnectionError('That departure has already left. Please choose another time.');
      return;
    }
    const runKey = createOfficialRunKey({
      line,
      origin,
      destination,
      date,
      runId: run.id,
    });
    const verification = runJourneys[run.id];
    const pickup = verification?.status === 'verified'
      ? verification.journey.stops.find((stop) => stopIdentity(stop) === pickupStopKey) ?? null
      : null;
    const dropoff = verification?.status === 'verified'
      ? verification.journey.stops.find((stop) => stopIdentity(stop) === dropoffStopKey) ?? null
      : null;
    if (exactStopFilterActive && (
      verification?.status !== 'verified'
      || !journeyServesSelection(verification.journey, pickupStopKey, dropoffStopKey)
    )) {
      setConnectionError('This run’s exact stop order could not be verified. Choose a listed matching run.');
      return;
    }
    setConnectionError('');
    onStopSelection?.({ runKey, pickup, dropoff });
    rememberPassengerTrip({
      runKey,
      departureTime: scheduledTime,
      filters: scheduleFilters,
      originName: SERVICE_AREAS.find((area) => area.id === origin)?.name,
      destinationName: SERVICE_AREAS.find((area) => area.id === destination)?.name,
      ...(pickup ? { pickupStop: savedStop(pickup) } : {}),
      ...(dropoff ? { dropoffStop: savedStop(dropoff) } : {}),
      savedAt: new Date().toISOString(),
    });
    setSelectedRunId(run.id);
    setDepartureTime(scheduledTime);
    setSelectedRunKey(runKey);
    void connectPassengerDisplay(runKey, scheduledTime);
  }

  return (
    <div className={`min-h-[100dvh] overflow-y-auto bg-background text-foreground ${personalPreferenceClasses(preferences)}`} dir={rtl ? 'rtl' : 'ltr'}>
      <header className="rounded-b-[28px] bg-secondary px-6 pb-11 pt-[calc(1.6rem+env(safe-area-inset-top))] text-secondary-foreground">
        <div className="mx-auto max-w-md relative">
          <div className="absolute end-0 top-0"><PassengerPreferenceButton /></div>
          <p className="mb-2 text-xs font-black tracking-[0.18em] text-primary">MONSEY TRAILS</p>
          <h1 className="pe-14 text-[2rem] font-black leading-tight tracking-tight">{lang === 'he' ? 'לאן נוסעים?' : lang === 'yi' ? 'וואו פארט איר?' : 'Where are you going?'}</h1>
          <p className="mt-2 text-sm text-secondary-foreground/80">{lang === 'he' ? 'לוחות זמנים ומעקב נסיעה · ללא כניסה לחשבון' : lang === 'yi' ? 'פאסאזשיר צייטן און רייזע נאכפאלג · אן אריינלאגירן' : 'Passenger schedules & trip tracking · No login required'}</p>
        </div>
      </header>

      <main className="mx-auto -mt-5 w-full max-w-md px-5 pb-12">
        <PassengerSavedTrips onRestore={(trip: SavedPassengerTrip) => {
          setScheduleFilters(trip.filters);
          setPickupStopKey(trip.pickupStop ? savedStopIdentity(trip.pickupStop, 'pickup') : '');
          setDropoffStopKey(trip.dropoffStop ? savedStopIdentity(trip.dropoffStop, 'dropoff') : '');
          onStopSelection?.({
            runKey: trip.runKey,
            pickup: trip.pickupStop ? restoredStop(trip.pickupStop, 'pickup') : null,
            dropoff: trip.dropoffStop ? restoredStop(trip.dropoffStop, 'dropoff') : null,
          });
          setDepartureTime(trip.departureTime);
          setSelectedRunKey(trip.runKey);
          setConnectionError('');
          void connectPassengerDisplay(trip.runKey, trip.departureTime, trip.filters);
        }} />
        <section className="relative rounded-[22px] bg-white text-[#0f172a] [color-scheme:light] px-5 py-4 shadow-[0_8px_24px_rgba(15,23,42,0.12)]">
          <label className="flex items-center gap-4 border-b border-[#e2e8f0] py-3">
            <span className="h-3 w-3 shrink-0 rounded-full bg-[#10b981]" />
            <select value={origin} onChange={(event) => chooseOrigin(Number(event.target.value))} className="min-w-0 flex-1 appearance-none bg-transparent text-lg font-bold outline-none">
              {availableOrigins.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-4 py-3">
            <span className="h-3 w-3 shrink-0 rounded-full bg-[#f59e0b]" />
             <select
               aria-label="Destination"
               value={availableDestinationIds.includes(destination) ? destination : ''}
               disabled={availabilityLoading || availableDestinations.length === 0}
               onChange={(event) => setScheduleFilters({ ...scheduleFilters, destination: Number(event.target.value) })}
               className="min-w-0 flex-1 appearance-none bg-transparent text-lg font-bold outline-none disabled:text-[#94a3b8]"
             >
               {availabilityLoading && <option value="">Checking destinations…</option>}
               {!availabilityLoading && availableDestinations.length === 0 && <option value="">No destinations available</option>}
              {availableDestinations.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
            </select>
          </label>
          <button
            type="button"
            aria-label="Swap origin and destination"
             disabled={availabilityLoading || !availableDestinationIds.includes(destination)}
            onClick={() => {
              if (!origin || !destination) return;
              const previousOrigin = origin;
               setScheduleFilters({
                 ...scheduleFilters,
                 origin: destination,
                 destination: previousOrigin,
               });
            }}
             className="absolute right-5 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-secondary/10 text-secondary disabled:opacity-40"
          >
            <Repeat2 className="h-5 w-5" />
          </button>
        </section>

        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-2 pt-4">
          {BUS_LINES.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => chooseLine(item.id)}
              className={`shrink-0 rounded-full border px-4 py-2 text-xs font-black transition-colors ${
                line === item.id ? 'border-secondary bg-secondary text-secondary-foreground' : 'border-[#e2e8f0] bg-white text-[#64748b]'
              }`}
            >
              {item.name}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between px-7 py-5">
          <button
            type="button"
            aria-label="Previous date"
            onClick={() => adjustDate(-1)}
            className="rounded-full p-2 text-secondary"
          >
            <ChevronLeft />
          </button>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <button type="button" aria-label="Choose date" className="flex items-center gap-2 rounded-full px-3 py-2 text-base font-black text-foreground">
                <CalendarDays className="h-4 w-4 text-secondary" />
                {format(serviceDateToCalendarDate(date), 'EEE, MMM d')}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="center">
              <Calendar
                mode="single"
                selected={serviceDateToCalendarDate(date)}
                defaultMonth={serviceDateToCalendarDate(date)}
                onSelect={(selectedDate) => {
                  if (!selectedDate) return;
                  setScheduleFilters({ ...scheduleFilters, date: calendarDateToServiceDate(selectedDate) });
                  setCalendarOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
          <button type="button" aria-label="Next date" onClick={() => adjustDate(1)} className="rounded-full p-2 text-secondary"><ChevronRight /></button>
        </div>
        {date !== today && (
          <div className="-mt-3 mb-4 text-center">
            <button type="button" onClick={() => setScheduleFilters({ ...scheduleFilters, date: today })} className="rounded-full bg-white px-4 py-2 text-xs font-black text-secondary shadow-sm">Today</button>
          </div>
        )}

        {line === 1 && <NewYorkSchedulePdf className="mb-4 rounded-[20px]" />}

        {availabilityError && (
          <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0" />{availabilityError}
            </div>
            <button type="button" onClick={() => setAvailabilityRetry((value) => value + 1)} className="mt-2 rounded-full bg-amber-800 px-4 py-1.5 text-xs font-black text-white">Retry availability</button>
          </div>
        )}

        {connectionError && (
          <div className="mb-3 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            <AlertCircle className="h-5 w-5 shrink-0" />{connectionError}
          </div>
        )}

        {scheduleRefreshError && (
          <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0" />{scheduleRefreshError}
            </div>
            <button type="button" onClick={() => retrySelectedSchedule.current()} className="mt-2 rounded-full bg-amber-800 px-4 py-1.5 text-xs font-black text-white">Retry schedule</button>
          </div>
        )}

        {(schedule as (OfficialSchedule & { offlineSavedAt?: string }) | null)?.offlineSavedAt && (
          <div role="status" className="mb-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
            Showing a saved offline schedule. These times are not live updates.
          </div>
        )}

        {schedule && lastScheduleRefreshAt && (
          <div className="mb-3 flex items-center justify-between gap-3 px-1 text-[11px] font-bold text-muted-foreground" aria-live="polite">
            <span>Schedule updated {formatRefreshTime(lastScheduleRefreshAt)}</span>
            <button
              type="button"
              onClick={() => retrySelectedSchedule.current()}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-secondary"
            >
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
          </div>
        )}

        {schedule && (
          <section className="mb-4 rounded-[20px] border border-[#dbe3e8] bg-white p-4 text-[#0f172a] shadow-sm" aria-label="Exact stop filters">
            <div className="mb-3">
              <h2 className="text-sm font-black">Filter by exact stops</h2>
              <p className="mt-0.5 text-[11px] font-semibold text-[#64748b]">Choose before selecting a run. Only verified runs serving your stops in pickup-to-drop-off order are shown.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[10px] font-black uppercase tracking-[0.12em] text-[#64748b]">
                Pickup in {schedule.origin.name}
                <select
                  aria-label="Exact pickup stop"
                  value={pickupStopKey}
                  onChange={(event) => setPickupStopKey(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[#cbd5e1] bg-white px-2 py-2 text-sm font-bold normal-case tracking-normal text-[#0f172a]"
                >
                  <option value="">Any verified pickup</option>
                  {pickupStopOptions.map(({ key, stop }) => <option key={key} value={key}>{stop.label}</option>)}
                </select>
              </label>
              <label className="text-[10px] font-black uppercase tracking-[0.12em] text-[#64748b]">
                Drop-off in {schedule.destination.name}
                <select
                  aria-label="Exact drop-off stop"
                  value={dropoffStopKey}
                  onChange={(event) => setDropoffStopKey(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[#cbd5e1] bg-white px-2 py-2 text-sm font-bold normal-case tracking-normal text-[#0f172a]"
                >
                  <option value="">Any verified drop-off</option>
                  {dropoffStopOptions.map(({ key, stop }) => <option key={key} value={key}>{stop.label}</option>)}
                </select>
              </label>
            </div>
            {verifyingRunCount > 0 && (
              <p role="status" className="mt-3 flex items-center gap-2 text-xs font-bold text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying exact stops for {verifyingRunCount} run{verifyingRunCount === 1 ? '' : 's'}…
              </p>
            )}
            {unresolvedRunCount > 0 && (
              <p role="status" className="mt-3 text-xs font-bold text-amber-800">
                Exact stops could not be verified for {unresolvedRunCount} run{unresolvedRunCount === 1 ? '' : 's'}. {exactStopFilterActive ? 'Those runs are not included in these results.' : 'They remain visible until you apply an exact-stop filter.'}
              </p>
            )}
          </section>
        )}

        {!availabilityLoading && availableDestinations.length > 0 && (
          <div className="mb-4 flex rounded-full bg-white p-1 shadow-sm" aria-label="Departure view">
            <button
              type="button"
              disabled={date < today}
              aria-pressed={!showAllDepartures}
              onClick={() => setShowAllDepartures(false)}
              className={`flex-1 rounded-full px-4 py-2 text-xs font-black transition-colors ${
                !showAllDepartures ? 'bg-secondary text-secondary-foreground' : 'text-[#64748b]'
              } disabled:cursor-not-allowed disabled:opacity-40`}
            >
              Upcoming
            </button>
            <button
              type="button"
              aria-pressed={showAllDepartures}
              onClick={() => setShowAllDepartures(true)}
              className={`flex-1 rounded-full px-4 py-2 text-xs font-black transition-colors ${
                showAllDepartures ? 'bg-secondary text-secondary-foreground' : 'text-[#64748b]'
              }`}
            >
              All departures
            </button>
          </div>
        )}

        {availabilityLoading ? (
          <div className="flex items-center justify-center gap-3 rounded-[20px] bg-white py-10 font-bold text-[#64748b]">
            <Loader2 className="h-5 w-5 animate-spin text-secondary" /> Checking available destinations…
          </div>
        ) : availableDestinations.length === 0 ? (
          <div className="rounded-[20px] bg-white px-6 py-10 text-center">
            <p className="text-base font-black text-[#0f172a]">No available destinations for this date</p>
            <p className="mt-2 text-sm font-bold text-[#64748b]">Keep your origin selected and choose another date.</p>
          </div>
        ) : loadingSchedule ? (
          <div className="flex items-center justify-center gap-3 rounded-[20px] bg-white py-10 font-bold text-[#64748b]">
            <Loader2 className="h-5 w-5 animate-spin text-secondary" /> Finding routes…
          </div>
        ) : scheduleError ? (
          <div className="rounded-[20px] border border-red-200 bg-white p-6 text-center">
            <AlertCircle className="mx-auto mb-3 h-7 w-7 text-red-600" />
            <p className="text-sm font-bold text-red-700">{scheduleError}</p>
            <p className="mt-2 text-xs font-semibold text-[#64748b]">Your route and date are unchanged.</p>
            {availableDestinations.length > 1 && (
              <p className="mt-1 text-xs font-semibold text-[#64748b]">You can also choose another available destination above.</p>
            )}
            <div className="mt-4 flex justify-center gap-2">
              <button type="button" onClick={() => retrySelectedSchedule.current()} className="rounded-full bg-secondary px-5 py-2 text-xs font-black text-secondary-foreground">Retry</button>
              <button type="button" onClick={() => adjustDate(1)} className="rounded-full border border-[#cbd5e1] px-5 py-2 text-xs font-black text-secondary">Next date</button>
            </div>
          </div>
        ) : displayedRuns.length ? (
          <div className="space-y-3">
            <ScheduleKeyLegend legend={schedule?.keyLegend} className="mb-3" />
            {displayedRuns.map((run, runIndex) => (
              <ScheduleRunCard
                key={`${run.id}-${run.scheduledTime}-${runIndex}`}
                run={run}
                serviceDate={date}
                today={today}
                legend={schedule?.keyLegend ?? []}
                runKey={createOfficialRunKey({ line, origin, destination, date, runId: run.id })}
                originAreaId={origin}
                destinationAreaId={destination}
                testId={`${run.id}-${run.scheduledTime}-${runIndex}`}
                connectionBusy={connectionBusy}
                onSelect={() => selectRun(run)}
                verifiedJourney={verifiedJourney(runJourneys[run.id])}
              />
            ))}
          </div>
        ) : exactStopFilterActive && schedule?.runs.length ? (
          <div className="rounded-[20px] border border-amber-200 bg-white px-6 py-8 text-center">
            <p className="text-base font-black text-[#0f172a]">
              {verifyingRunCount > 0 ? 'Still verifying exact stops' : 'No verified run serves both stops'}
            </p>
            <p className="mt-2 text-sm font-bold text-[#64748b]">
              {verifyingRunCount > 0
                ? 'Unverified runs are not shown as matches.'
                : 'Change one of the exact stops or clear a filter to see other runs.'}
            </p>
          </div>
        ) : schedule?.runs.length && !showAllDepartures && date <= today ? (
          <div className="rounded-[20px] bg-white px-6 py-10 text-center">
            <p className="text-base font-black text-[#0f172a]">
              {date === today ? 'No more departures today' : 'No departures remaining for this date'}
            </p>
            <p className="mt-2 text-sm font-bold text-[#64748b]">Choose another date to see available times.</p>
          </div>
        ) : (
          <div className="rounded-[20px] bg-white px-6 py-10 text-center">
            <p className="text-base font-black text-[#0f172a]">No departure times for this date</p>
            <p className="mt-2 text-sm font-bold text-[#64748b]">Choose another date to see available times.</p>
          </div>
        )}
      </main>
    </div>
  );
}

function AwaitingDepartureIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 overflow-visible">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2">
        <path d="M4 10a11 11 0 0 1 16 0" className="animate-[pulse_1.8s_ease-in-out_infinite] motion-reduce:animate-none" />
        <path d="M7.5 13.5a6.5 6.5 0 0 1 9 0" className="animate-[pulse_1.8s_ease-in-out_.2s_infinite] motion-reduce:animate-none" />
        <path d="M10.5 17a2.3 2.3 0 0 1 3 0" className="animate-[pulse_1.8s_ease-in-out_.4s_infinite] motion-reduce:animate-none" />
      </g>
    </svg>
  );
}

function hasUpcomingRuns(
  schedule: OfficialSchedule,
  date: string,
  today: string,
  now: Date,
) {
  if (date < today) return false;
  const notCompleted = schedule.runs.filter((run) => run.departureStatus !== 'completed');
  if (date > today) return notCompleted.length > 0;
  const upcomingIds = new Set(getUpcomingScheduleRuns(notCompleted, date, now).map((run) => run.id));
  return notCompleted.some((run) =>
    upcomingIds.has(run.id)
    || run.departureStatus === 'on_time'
    || run.departureStatus === 'delayed'
    || run.departureStatus === 'live_estimate'
    || run.departureStatus === 'unavailable',
  );
}

function isOfflineSchedule(schedule: OfficialSchedule): schedule is OfficialSchedule & { offlineSavedAt: string } {
  return typeof (schedule as OfficialSchedule & { offlineSavedAt?: unknown }).offlineSavedAt === 'string';
}

function verifiedJourney(verification: RunJourneyVerification | undefined) {
  return verification?.status === 'verified' ? verification.journey : undefined;
}

function validJourneyStop(stop: PassengerJourneyStop) {
  return typeof stop.id === 'string'
    && stop.id.length > 0
    && typeof stop.label === 'string'
    && stop.label.trim().length > 0
    && (stop.kind === 'pickup' || stop.kind === 'dropoff')
    && Number.isFinite(stop.lat)
    && Math.abs(stop.lat) <= 90
    && Number.isFinite(stop.lng)
    && Math.abs(stop.lng) <= 180;
}

function stopIdentity(stop: Pick<PassengerJourneyStop, 'kind' | 'label' | 'lat' | 'lng'>) {
  return passengerStopIdentity(stop);
}

function savedStopIdentity(stop: SavedPassengerStop, kind: PassengerJourneyStop['kind']) {
  return stopIdentity({ ...stop, kind });
}

function collectStopOptions(
  verifications: Record<string, RunJourneyVerification>,
  kind: PassengerJourneyStop['kind'],
): StopFilterOption[] {
  const options = new Map<string, PassengerJourneyStop>();
  Object.values(verifications).forEach((verification) => {
    if (verification.status !== 'verified') return;
    verification.journey.stops.forEach((stop) => {
      if (stop.kind !== kind) return;
      const key = stopIdentity(stop);
      if (!options.has(key)) options.set(key, stop);
    });
  });
  return [...options.entries()]
    .map(([key, stop]) => ({ key, stop }))
    .sort((left, right) => left.stop.label.localeCompare(right.stop.label));
}

function journeyServesSelection(
  journey: PassengerJourney,
  pickupKey: string,
  dropoffKey: string,
) {
  const pickupIndex = pickupKey
    ? journey.stops.findIndex((stop) => stop.kind === 'pickup' && stopIdentity(stop) === pickupKey)
    : -1;
  const dropoffIndex = dropoffKey
    ? journey.stops.findIndex((stop) => stop.kind === 'dropoff' && stopIdentity(stop) === dropoffKey)
    : -1;
  if (pickupKey && pickupIndex < 0) return false;
  if (dropoffKey && dropoffIndex < 0) return false;
  return !pickupKey || !dropoffKey || pickupIndex < dropoffIndex;
}

function savedStop(stop: PassengerJourneyStop): SavedPassengerStop {
  return {
    id: stop.id,
    label: stop.label,
    ...(stop.note ? { note: stop.note } : {}),
    lat: stop.lat,
    lng: stop.lng,
  };
}

function restoredStop(stop: SavedPassengerStop, kind: PassengerJourneyStop['kind']): PassengerJourneyStop {
  return {
    ...stop,
    kind,
    mapLabel: '',
    scheduledAt: null,
    estimatedArrivalAt: null,
  };
}

function DepartureStatusBadge({
  run,
  serviceDate,
  today,
}: {
  run: OfficialScheduleRun;
  serviceDate: string;
  today: string;
}) {
  if (run.departureStatus === 'completed') {
    return <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-black text-orange-700">Arrived</span>;
  }
  if (run.departureStatus === 'awaiting_departure') {
    if (serviceDate <= today) {
      return <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">On schedule</span>;
    }
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
        <AwaitingDepartureIcon /> Awaiting departure
      </span>
    );
  }
  if (run.departureStatus === 'on_time') {
    return <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">On schedule</span>;
  }
  if (run.departureStatus === 'delayed') {
    return <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-800">{run.delayMinutes} min delayed</span>;
  }
  if (run.departureStatus === 'live_estimate') {
    return <span className="rounded-full bg-brand-ink/10 px-3 py-1 text-xs font-black text-brand-ink">Live estimate</span>;
  }
  return <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">Live status unavailable</span>;
}

function serviceDateToCalendarDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function calendarDateToServiceDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatRefreshTime(date: Date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function formatPublishedDeparture(serviceDate: string, time: string) {
  const departure = getScheduledDepartureInstant(serviceDate, time);
  if (!departure) return 'Time unavailable';
  const timeLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  }).format(departure);
  const departureDate = getNewYorkServiceDate(departure);
  if (departureDate === serviceDate) return timeLabel;
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).format(departure);
  return `${timeLabel} (${weekday})`;
}

function ScheduleRunCard({
  run,
  serviceDate,
  today,
  legend,
  runKey,
  originAreaId,
  destinationAreaId,
  testId,
  connectionBusy,
  onSelect,
  verifiedJourney,
}: {
  run: OfficialScheduleRun;
  serviceDate: string;
  today: string;
  legend: ReadonlyArray<{ key: string; meaning: string }>;
  runKey: string;
  originAreaId: number;
  destinationAreaId: number;
  testId: string;
  connectionBusy: boolean;
  onSelect: () => void;
  verifiedJourney?: PassengerJourney;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="w-full rounded-[20px] border border-[#e2e8f0] bg-white p-4 text-left text-[#0f172a] shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          disabled={connectionBusy}
          onClick={onSelect}
          className="min-w-0 flex-1 rounded-xl text-left disabled:opacity-60"
          data-testid={`button-select-run-${testId}`}
        >
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-xl font-black">{formatPublishedDeparture(serviceDate, run.scheduledTime || run.firstPickupTime)}</span>
            <ArrivalEstimate serviceDate={serviceDate} run={run} />
          </span>
          <span className="mt-1 block truncate text-xs font-bold text-[#64748b]">
            {run.pickupDescription} <span aria-hidden="true">→</span> {run.dropoffDescription}
          </span>
        </button>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <DepartureStatusBadge run={run} serviceDate={serviceDate} today={today} />
          <span className="px-2 text-[10px] font-bold text-[#64748b]">{formatTripDuration(run.durationMinutes)} trip</span>
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <ScheduleKeyBadges keys={run.displayKeys} legend={legend} />
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-[#cbd5e1] px-3 py-1.5 text-xs font-black text-secondary"
        >
          {expanded ? 'Hide stops' : 'Stops & boarding'}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>
      <ServiceDisruptionNotices disruptions={run.disruptions} compact />
      <div className={`${expanded ? 'mt-3 border-t border-[#e2e8f0] pt-3' : 'hidden'}`} aria-hidden={!expanded}>
          <ScheduleRunRoutes
            run={run}
            runKey={runKey}
            originAreaId={originAreaId}
            destinationAreaId={destinationAreaId}
            testId={testId}
            verifiedJourney={verifiedJourney}
          />
          <button
            type="button"
            disabled={connectionBusy}
            onClick={onSelect}
            className="mt-4 w-full rounded-full bg-secondary px-4 py-2.5 text-xs font-black text-secondary-foreground disabled:opacity-60"
            data-testid={`button-view-trip-${testId}`}
          >
            View this trip
          </button>
      </div>
    </article>
  );
}

function ScheduleRunRoutes({
  run,
  runKey,
  originAreaId,
  destinationAreaId,
  testId,
  verifiedJourney,
}: {
  run: OfficialScheduleRun;
  runKey: string;
  originAreaId: number;
  destinationAreaId: number;
  testId: string;
  verifiedJourney?: PassengerJourney;
}) {
  const [journey, setJourney] = useState<PassengerJourney | null>(verifiedJourney ?? null);
  const [journeyProgress, setJourneyProgress] = useState<JourneyProgressItem[]>([]);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const [date, line, origin, destination, runId] = runKey.split('|');
    const load = () => {
      void Promise.all([
        verifiedJourney ?? getPassengerJourney({
            date,
            line: Number(line) as 1 | 2 | 3,
            origin: Number(origin),
            destination: Number(destination),
            runId,
          }, { signal: controller.signal }),
        fetchPublicRunTrip(runKey),
      ]).then(([nextJourney, liveTrip]) => {
        if (controller.signal.aborted) return;
        setJourney(nextJourney);
        setJourneyProgress(liveTrip?.journeyProgress ?? []);
        setCurrentLocation(liveTrip?.locationVisibility === 'live' ? liveTrip.currentLocation : null);
      }).catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [runKey, verifiedJourney]);
  const pickups = journey?.stops.filter((stop) => stop.kind === 'pickup');
  const dropoffs = journey?.stops.filter((stop) => stop.kind === 'dropoff');
  return (
    <>
      <StopRoute
        title="Pickup route"
        description={run.pickupDescription}
        areaId={originAreaId}
        variant="pickup"
        testId={testId}
        journeyStops={pickups}
        serviceDate={journey?.serviceDate}
        trafficStatus={journey?.trafficStatus}
        journeyProgress={journeyProgress}
        currentLocation={currentLocation}
      />
      <div className="flex h-9 items-center justify-center" aria-hidden="true">
        <ArrowDown className="h-5 w-5 text-[#94a3b8]" />
      </div>
      <StopRoute
        title="Drop-off route"
        description={run.dropoffDescription}
        areaId={destinationAreaId}
        variant="dropoff"
        testId={testId}
        journeyStops={dropoffs}
        serviceDate={journey?.serviceDate}
        trafficStatus={journey?.trafficStatus}
        journeyProgress={journeyProgress}
        currentLocation={currentLocation}
      />
    </>
  );
}

function StopRoute({
  title,
  description,
  areaId,
  variant,
  testId,
  journeyStops,
  serviceDate,
  trafficStatus,
  journeyProgress = [],
  currentLocation,
}: {
  title: string;
  description: string;
  areaId: number;
  variant: 'pickup' | 'dropoff';
  testId: string;
  journeyStops?: PassengerJourneyStop[];
  serviceDate?: string;
  trafficStatus?: string;
  journeyProgress?: JourneyProgressItem[];
  currentLocation?: { lat: number; lng: number } | null;
}) {
  const fallbackStops = description.split(' • ').map((stop) => stop.trim()).filter(Boolean);
  const stops = journeyStops?.length
    ? journeyStops.map((stop) => ({ label: stop.label, journeyStop: stop }))
    : fallbackStops.map((label) => ({ label, journeyStop: undefined }));
  const [expanded, setExpanded] = useState(false);
  const [selectedStop, setSelectedStop] = useState<number | null>(null);
  const [preview, setPreview] = useState<OfficialStopPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const requestId = useRef(0);
  const isPickup = variant === 'pickup';

  async function showStop(index: number) {
    if (selectedStop === index) {
      requestId.current += 1;
      setSelectedStop(null);
      setPreview(null);
      setPreviewError('');
      setPreviewLoading(false);
      return;
    }
    const currentRequest = ++requestId.current;
    setSelectedStop(index);
    setPreview(null);
    setPreviewError('');
    setPreviewLoading(true);
    try {
      const journeyStop = stops[index].journeyStop;
      const point = journeyStop
        && Number.isFinite(journeyStop.lat)
        && Number.isFinite(journeyStop.lng)
        ? {
            label: journeyStop.label,
            lat: journeyStop.lat,
            lng: journeyStop.lng,
            note: journeyStop.note,
          }
        : await resolveOfficialStop(stops[index].label, areaId);
      if (requestId.current === currentRequest) setPreview(point);
    } catch (error) {
      if (requestId.current === currentRequest) {
        setPreviewError(error instanceof Error ? error.message : 'A map preview is not available for this stop.');
      }
    } finally {
      if (requestId.current === currentRequest) setPreviewLoading(false);
    }
  }

  return (
    <div
      className="rounded-2xl bg-[#f8fafc] px-3 py-3"
      data-testid={`${variant}-route-${testId}`}
    >
      <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-[#64748b]">
        <MapPin className={`h-3.5 w-3.5 ${isPickup ? 'text-[#10b981]' : 'text-[#f97316]'}`} />
        {title}
      </div>
      <ol aria-label={`${title} stops`}>
        {stops.slice(0, expanded ? stops.length : 4).map((stop, index) => {
          const first = index === 0;
          const last = index === stops.length - 1;
          const progress = stop.journeyStop
            ? journeyProgress.find((item) => item.id === stop.journeyStop?.id)
            : undefined;
          const completed = progress?.status === 'completed';
          return (
             <li key={`${stop.label}-${index}`}>
              <div className="flex min-h-9 gap-2.5">
                <span className="flex w-7 shrink-0 flex-col items-center" aria-hidden="true">
                   <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-black ${
                     completed
                       ? 'border-green-700 bg-green-600 text-white'
                       : isPickup
                      ? first
                        ? 'border-[#10b981] bg-[#10b981] text-white'
                        : last
                          ? 'border-[#0b2147] bg-[#c7ef36] text-[#0b2147]'
                          : 'border-[#10b981] bg-white text-[#047857]'
                      : first
                        ? 'border-[#f97316] bg-[#f97316] text-white'
                        : last
                          ? 'border-[#9a3412] bg-[#ffedd5] text-[#9a3412]'
                          : 'border-[#fb923c] bg-white text-[#c2410c]'
                  }`}>
                    {index + 1}
                  </span>
                  {!last && (
                    <>
                      <span className={`h-1.5 w-0.5 ${isPickup ? 'bg-emerald-200' : 'bg-orange-200'}`} />
                      <ChevronDown className={`h-3 w-3 shrink-0 ${isPickup ? 'text-emerald-400' : 'text-orange-400'}`} strokeWidth={3} />
                      <span className={`min-h-1 flex-1 w-0.5 ${isPickup ? 'bg-emerald-200' : 'bg-orange-200'}`} />
                    </>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => void showStop(index)}
                  aria-expanded={selectedStop === index}
                  className={`mb-2 min-w-0 flex-1 rounded-lg px-1 text-left text-sm leading-5 transition-colors ${
                    selectedStop === index ? isPickup ? 'bg-emerald-50' : 'bg-orange-50' : 'hover:bg-white'
                  } ${first || last ? 'font-extrabold text-[#0f172a]' : 'font-semibold text-[#475569]'}`}
                  data-testid={`button-map-${variant}-stop-${testId}-${index + 1}`}
                >
                  <span className="flex flex-wrap items-center justify-between gap-x-2">
                    <span>{stop.label}</span>
                    {stop.journeyStop && serviceDate && !completed && (
                      <StopTimeEvidence
                        stop={stop.journeyStop}
                        serviceDate={serviceDate}
                        trafficStatus={trafficStatus}
                      />
                    )}
                  </span>
                   <StopProgressBadge progress={progress} currentLocation={currentLocation} />
                  {first && <span className={`ml-2 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${isPickup ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>First</span>}
                  {last && stops.length > 1 && <span className={`ml-2 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${isPickup ? 'bg-[#e8eef7] text-[#0b2147]' : 'bg-orange-100 text-orange-800'}`}>Last</span>}
                </button>
              </div>
              {selectedStop === index && (
                <div className={`mb-3 ml-9 overflow-hidden rounded-xl border bg-white ${isPickup ? 'border-emerald-200' : 'border-orange-200'}`}>
                  {previewLoading ? (
                    <div className="flex h-32 items-center justify-center gap-2 text-xs font-bold text-[#64748b]">
                      <Loader2 className="h-4 w-4 animate-spin" /> Finding stop…
                    </div>
                  ) : previewError ? (
                    <div className="px-4 py-6 text-center text-xs font-bold text-red-700">{previewError}</div>
                  ) : preview ? (
                    <TinyStopMap point={preview} variant={variant} />
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {stops.length > 4 && (
        <button
          type="button"
          onClick={() => {
            setExpanded((current) => !current);
            setSelectedStop(null);
            setPreview(null);
          }}
          aria-expanded={expanded}
          className="mt-2 w-full rounded-full border border-[#cbd5e1] bg-white px-3 py-2 text-xs font-black text-[#0b2147]"
        >
          {expanded ? 'Show fewer stops' : `Show all ${stops.length} stops`}
        </button>
      )}
    </div>
  );
}

function TinyStopMap({ point, variant }: { point: OfficialStopPreview; variant: 'pickup' | 'dropoff' }) {
  const zoom = 18;
  const scale = 2 ** zoom;
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, point.lat));
  const tileX = ((point.lng + 180) / 360) * scale;
  const latitudeRadians = latitude * Math.PI / 180;
  const tileY = (1 - Math.log(Math.tan(latitudeRadians) + (1 / Math.cos(latitudeRadians))) / Math.PI) / 2 * scale;
  const x = Math.floor(tileX);
  const y = Math.floor(tileY);
  const markerLeft = (tileX - x) * 100;
  const markerTop = (tileY - y) * 100;

  return (
    <figure className="relative" data-testid={`map-stop-${variant}`}>
      <div className="border-b border-[#e2e8f0] px-3 py-2">
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-[#64748b]">
          {variant === 'pickup' ? 'Where do I wait?' : 'Drop-off location'}
        </div>
        <div className="mt-0.5 text-sm font-extrabold text-[#0f172a]">{point.label}</div>
        {point.note && <div className="mt-1 text-xs font-semibold text-[#475569]">{point.note}</div>}
      </div>
      <div className="relative h-48 overflow-hidden bg-[#e2e8f0]">
        <img
          src={`/api/map-tiles/${zoom}/${x}/${y}.png`}
          alt={`Map around ${point.label}`}
          className="h-full w-full object-fill"
        />
        <MapPin
          className={`absolute h-9 w-9 -translate-x-1/2 -translate-y-full drop-shadow-[0_3px_3px_rgba(15,23,42,0.45)] ${
            variant === 'pickup' ? 'fill-[#10b981]' : 'fill-[#f97316]'
          } text-white`}
          style={{ left: `${markerLeft}%`, top: `${markerTop}%` }}
          strokeWidth={1.8}
          aria-hidden="true"
        />
      </div>
      <figcaption className="flex items-center justify-between gap-3 px-3 py-2 text-xs font-extrabold text-[#0f172a]">
        <span>Verified stop pin</span>
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${point.lat},${point.lng}`)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-secondary underline underline-offset-2"
        >
          Open map <ExternalLink className="h-3 w-3" />
        </a>
      </figcaption>
    </figure>
  );
}

function StopTimeEvidence({
  stop,
  serviceDate,
  trafficStatus,
}: {
  stop: PassengerJourneyStop;
  serviceDate: string;
  trafficStatus?: string;
}) {
  if (stop.scheduledAt) {
    return (
      <span className="whitespace-nowrap rounded border border-[#0b2147]/20 bg-[#0b2147]/10 px-1.5 py-0.5 text-[10px] font-black text-[#0b2147]">
        Scheduled {formatJourneyTime(stop.scheduledAt, serviceDate)}
      </span>
    );
  }
  if (!stop.estimatedArrivalAt) return null;
  return (
    <span className="whitespace-nowrap rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-black text-amber-800">
      {trafficStatus === 'live' ? 'GPS est.' : 'Est.'} {formatJourneyTime(stop.estimatedArrivalAt, serviceDate)}
    </span>
  );
}

function ArrivalEstimate({ serviceDate, run }: { serviceDate: string; run: OfficialScheduleRun }) {
  if (
    !run.arrivalTime
    || run.arrivalVerification === 'unavailable'
    || run.arrivalVerification === 'unverified'
  ) return null;

  const normalizedArrival = run.arrivalTime.replace(
    /\.(\d{3})\d+(?=Z|[+-]\d{2}:\d{2}$)/,
    '.$1',
  );
  const scheduledArrival = getScheduledDepartureInstant(serviceDate, normalizedArrival);
  if (!scheduledArrival) return null;

  const hasGpsEstimate = (
    run.departureStatus === 'on_time'
    || run.departureStatus === 'delayed'
  ) && run.delayMinutes !== null;
  const arrival = new Date(
    scheduledArrival.getTime() + (hasGpsEstimate ? Math.max(0, run.delayMinutes ?? 0) * 60_000 : 0),
  );
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  }).format(arrival);

  return (
    <span className="text-sm font-bold text-[#64748b]" data-testid={`arrival-estimate-${run.id}`}>
      → arrives {label}{hasGpsEstimate ? ' GPS est.' : ' scheduled'}
    </span>
  );
}
