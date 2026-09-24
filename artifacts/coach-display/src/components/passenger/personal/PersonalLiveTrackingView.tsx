import { AlertTriangle, Bus, ChevronLeft, Clock3, Radio, WifiOff } from 'lucide-react';
import type { LiveTrip } from '@/providers/live-trip';
import type { PassengerJourney } from './usePassengerJourney';
import { PersonalJourneyMap } from './PersonalJourneyMap';
import { formatJourneyTime } from './journeyTime';
import { getLiveTrackingState } from './liveTracking';
import { StopNote } from '@/components/passenger/StopNote';
import { LocationConfidenceIndicator } from '@/components/passenger/LocationConfidenceIndicator';

interface PersonalLiveTrackingViewProps {
  trip: LiveTrip;
  assignedBusNumber: string | null;
  journey: PassengerJourney | undefined;
  now: number;
  onBack: () => void;
}

const stateCopy = {
  stale: {
    title: 'Live location is stale',
    detail: 'The latest coach position is too old to show as live. Waiting for a fresh GPS update.',
  },
  completed: {
    title: 'This trip has ended',
    detail: 'Live tracking is no longer available for this completed trip.',
  },
  disconnected: {
    title: 'Coach location disconnected',
    detail: 'The coach is assigned, but a valid live GPS position is not currently available.',
  },
  unavailable: {
    title: 'Live tracking unavailable',
    detail: 'This trip does not currently have a passenger-visible live coach location.',
  },
} as const;

export function PersonalLiveTrackingView({
  trip,
  assignedBusNumber,
  journey,
  now,
  onBack,
}: PersonalLiveTrackingViewProps) {
  const trackingState = getLiveTrackingState(trip, assignedBusNumber, now);
  const isLive = trackingState === 'live';
  const liveCoach = isLive ? trip.currentLocation : null;
  const nextStop = trip.intermediateStops[0];
  const nextStopLabel = nextStop?.address
    ?? (trip.destination ? journey?.destinationName ?? trip.destinationAddress : null);
  const nextStopNote = nextStop?.note ?? trip.destinationNote;
  const nextEta = nextStop?.eta ?? trip.eta;
  const lastUpdated = trip.locationUpdatedAt && Number.isFinite(new Date(trip.locationUpdatedAt).getTime())
    ? formatJourneyTime(trip.locationUpdatedAt, journey?.serviceDate ?? '')
    : null;
  const unavailableCopy = isLive ? null : stateCopy[trackingState];

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background text-foreground">
      <header className="flex-none bg-secondary px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] text-secondary-foreground shadow-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-primary">Passenger tracking</p>
            <h1 className="truncate text-lg font-black">
              {journey ? `${journey.originName} to ${journey.destinationName}` : 'Trip live map'}
            </h1>
            <p className="text-xs font-semibold text-secondary-foreground/70">
              {assignedBusNumber ? `Coach ${assignedBusNumber}` : 'Coach assignment unavailable'}
            </p>
          </div>
          <button
            type="button"
            onClick={onBack}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-sm font-bold hover:bg-white/20"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to trip details
          </button>
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-3 p-3 md:grid md:grid-cols-[minmax(0,2fr)_minmax(17rem,1fr)] md:p-5">
        <section className="relative min-h-[48dvh] flex-1 overflow-hidden rounded-2xl border border-border bg-[#e8f4ea] shadow-sm md:min-h-0">
          {journey ? (
            <PersonalJourneyMap
              routeGeometry={journey.routeGeometry}
              stops={journey.stops}
              liveCoach={liveCoach}
              selectedStopId={null}
              onSelectStop={() => undefined}
              onShowFullRoute={() => undefined}
              showLiveCoachLegend={isLive}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center font-semibold text-muted-foreground">
              Route details are currently unavailable.
            </div>
          )}
        </section>

        <aside className="flex flex-none flex-col gap-3 md:min-h-0 md:overflow-y-auto">
          <LocationConfidenceIndicator trip={trip} now={now} className="self-start bg-card" />
          {isLive ? (
            <section className="rounded-2xl border border-primary/40 bg-card p-4 shadow-sm" aria-live="polite">
              <div className="flex items-center gap-2 text-sm font-black uppercase tracking-wider text-green-700">
                <Radio className="h-4 w-4" />
                Live coach location
              </div>
              <div className="mt-4 flex items-start gap-3">
                <div className="rounded-xl bg-primary/20 p-2 text-secondary"><Bus className="h-6 w-6" /></div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Next stop</p>
                  <p className="mt-1 text-base font-black">{nextStopLabel ?? 'Next stop unavailable'}</p>
                   <StopNote
                     note={nextStopNote}
                     label={nextStopLabel}
                     className="mt-1 line-clamp-3 text-sm font-medium leading-relaxed text-muted-foreground"
                   />
                  {nextEta && journey && (
                    <p className="mt-1 text-sm font-bold text-secondary">
                      ETA {formatJourneyTime(nextEta, journey.serviceDate)}
                    </p>
                  )}
                </div>
              </div>
              {lastUpdated && (
                <p className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  GPS updated {lastUpdated}
                </p>
              )}
            </section>
          ) : (
            <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm" aria-live="polite">
              <div className="flex items-center gap-2">
                {trackingState === 'stale' || trackingState === 'disconnected'
                  ? <WifiOff className="h-5 w-5" />
                  : <AlertTriangle className="h-5 w-5" />}
                <h2 className="font-black">{unavailableCopy?.title}</h2>
              </div>
              <p className="mt-2 text-sm font-medium leading-relaxed">{unavailableCopy?.detail}</p>
              {lastUpdated && trackingState === 'stale' && (
                <p className="mt-3 text-xs font-bold">Last GPS update: {lastUpdated}</p>
              )}
              <button
                type="button"
                onClick={onBack}
                className="mt-4 w-full rounded-xl bg-secondary px-4 py-3 text-sm font-black text-secondary-foreground"
              >
                Return to trip details
              </button>
            </section>
          )}
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">
            The route line shows the published trip route. Only the coach marker is a live GPS position.
          </p>
        </aside>
      </main>
    </div>
  );
}