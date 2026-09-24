import { AlertCircle, Bus, CalendarClock, CheckCircle2, Loader2, MapPin, Play, RefreshCw } from 'lucide-react';
import { getGetDriverScheduledTripsQueryKey, useGetDriverScheduledTrips, type DriverScheduledTrip } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ScheduleKeyBadges, ScheduleKeyLegend } from '@/components/schedule-keys';
import { NewYorkSchedulePdf } from '@/components/new-york-schedule-pdf';

function departureLabel(value: string) {
  const departure = new Date(value);
  if (Number.isNaN(departure.getTime())) return 'Departure time unavailable';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(departure);
}

function ScheduledTripCard({
  trip,
  current,
  busy,
  onChoose,
}: {
  trip: DriverScheduledTrip;
  current: boolean;
  busy: boolean;
  onChoose: (busNumber: string) => void;
}) {
  const coachNumberIsValid = /^[A-Z0-9]{1,6}$/.test(trip.busNumber);
  return (
    <article className={cn('rounded-xl border p-4', current ? 'border-primary/40 bg-primary/5' : 'border-border bg-background')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-black uppercase tracking-wider text-primary">
              {trip.assignmentSource === 'dispatch' ? 'Dispatch assigned' : 'Scheduled run'}
            </span>
            {current && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3" /> Current trip
              </span>
            )}
          </div>
          <h3 className="text-lg font-black">{trip.direction}</h3>
          <ScheduleKeyBadges keys={trip.displayKeys} legend={trip.keyLegend} />
          {!trip.scheduleKeysAvailable && (
            <p className="text-xs font-bold text-amber-700">Current schedule keys are unavailable. Refresh trips to try again.</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><CalendarClock className="h-4 w-4" />{departureLabel(trip.scheduledDepartureAt)}</span>
            <span className="inline-flex items-center gap-1.5"><Bus className="h-4 w-4" />Coach {trip.busNumber}</span>
          </div>
          <p className="flex items-start gap-1.5 text-sm font-semibold">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {trip.destinationAddress || `${trip.stopCount + 1} published destinations`}
          </p>
          {!coachNumberIsValid && (
            <p className="text-xs font-bold text-destructive" role="alert">
              Dispatch returned an invalid coach number. Coach numbers must use 1–6 letters or numbers.
            </p>
          )}
        </div>
        {!current && (
          <Button type="button" disabled={busy || !coachNumberIsValid} onClick={() => onChoose(trip.busNumber)} className="rounded-xl font-black">
            <Play className="mr-2 h-4 w-4" /> Use assigned coach
          </Button>
        )}
      </div>
    </article>
  );
}

export function AssignedScheduledTrips({
  driverId,
  currentBusNumber,
  currentOfficialRunKey,
  currentStatus,
  currentDestination,
  currentStopCount,
  busy,
  onChoose,
}: {
  driverId: string | undefined;
  currentBusNumber: string;
  currentOfficialRunKey: string | null;
  currentStatus: string;
  currentDestination: string;
  currentStopCount: number;
  busy: boolean;
  onChoose: (busNumber: string) => void;
}) {
  const scheduledTrips = useGetDriverScheduledTrips({
    query: {
      queryKey: [...getGetDriverScheduledTripsQueryKey(), driverId],
      enabled: Boolean(driverId),
      staleTime: 15_000,
      refetchInterval: 30_000,
      retry: false,
    },
  });
  const trips = (scheduledTrips.data ?? []).filter(trip => trip.assignmentSource === 'dispatch');
  const currentAssignment = trips.find(trip => (
    trip.busNumber === currentBusNumber
    && trip.officialRunKey === currentOfficialRunKey
  ));
  const hasCurrentTrip = Boolean(currentOfficialRunKey && currentDestination);
  const newYorkTrips = trips.filter(trip => trip.officialRunKey.split('|')[1] === '1');
  const hasNewYorkTrip = newYorkTrips.length > 0 || currentOfficialRunKey?.split('|')[1] === '1';
  const keyLegend = trips.find(trip => trip.keyLegend.length)?.keyLegend;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" aria-labelledby="assigned-trips-heading">
      <div className="flex items-center justify-between border-b border-border/50 bg-primary/5 px-5 py-4">
        <div>
          <h2 id="assigned-trips-heading" className="flex items-center gap-2 text-base font-black">
            <CalendarClock className="h-5 w-5 text-primary" /> Dispatch-assigned trips
          </h2>
          <p className="mt-1 text-xs font-semibold text-muted-foreground">Choose or resume a coach and published schedule assigned by dispatch.</p>
        </div>
        {scheduledTrips.isFetching && !scheduledTrips.isLoading && <RefreshCw className="h-4 w-4 animate-spin text-primary" aria-label="Refreshing trips" />}
      </div>
      <div className="space-y-3 p-5">
        {hasNewYorkTrip && <NewYorkSchedulePdf />}
        {trips.some(trip => trip.displayKeys.length > 0) && <ScheduleKeyLegend legend={keyLegend} />}
        {hasCurrentTrip && !currentAssignment && (
          <article className="rounded-xl border border-primary/40 bg-primary/5 p-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-primary">
                {currentStatus === 'running' ? 'Trip in progress' : 'Selected official run'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3" /> Current trip
              </span>
            </div>
            <p className="mt-2 flex items-start gap-2 text-base font-black"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{currentDestination}</p>
            <p className="mt-1 text-xs font-semibold text-muted-foreground">{currentStopCount + 1} published destinations loaded{currentBusNumber ? ` · Coach ${currentBusNumber}` : ''}</p>
          </article>
        )}

        {scheduledTrips.isLoading && (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-sm font-bold text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading assigned trips…
          </div>
        )}
        {scheduledTrips.isError && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm font-bold text-destructive" role="alert">
            <span className="flex items-center gap-2"><AlertCircle className="h-4 w-4" />Assigned trips could not be loaded.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void scheduledTrips.refetch()}>Retry</Button>
          </div>
        )}
        {!scheduledTrips.isLoading && !scheduledTrips.isError && trips.map(trip => (
          <ScheduledTripCard
            key={`${trip.busNumber}-${trip.officialRunKey}`}
            trip={trip}
            current={trip === currentAssignment}
            busy={busy}
            onChoose={onChoose}
          />
        ))}
        {!scheduledTrips.isLoading && !scheduledTrips.isError && trips.length === 0 && !hasCurrentTrip && (
          <div className="rounded-xl border border-dashed p-6 text-center">
            <p className="font-black">No dispatch-assigned trips</p>
            <p className="mt-1 text-sm text-muted-foreground">Ask dispatch to assign your driver account to a coach and published schedule.</p>
          </div>
        )}
      </div>
    </section>
  );
}