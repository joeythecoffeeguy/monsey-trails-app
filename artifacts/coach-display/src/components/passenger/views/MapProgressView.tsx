import { useEffect, useRef } from 'react';
import { useSettingsStore } from '@/lib/store';
import { useGPSData, useTrafficData, type Coordinates } from '@/providers/api-interfaces';
import { useLiveTrip } from '@/providers/live-trip';
import { Navigation } from 'lucide-react';
import { LiveCoachMap } from './LiveCoachMap';
import { getTranslation, isRTL } from '@/lib/translations';
import { StopNote } from '@/components/passenger/StopNote';

const MAX_FOCUS_MILES = 3;

function milesBetween(a: Coordinates, b: Coordinates) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function focusRouteGeometry(
  geometry: Coordinates[],
  coach: Coordinates | null,
  nextStop: Coordinates | null,
  maxMiles = MAX_FOCUS_MILES,
) {
  if (geometry.length < 2 || !coach) return geometry;
  const nearestIndex = (target: Coordinates) =>
    geometry.reduce(
      (best, point, index) =>
        milesBetween(point, target) < milesBetween(geometry[best], target)
          ? index
          : best,
      0,
    );
  const startIndex = nearestIndex(coach);
  const stopIndex = nextStop ? nearestIndex(nextStop) : geometry.length - 1;
  const endIndex = Math.max(startIndex + 1, stopIndex);
  const focused = [geometry[startIndex]];
  let distance = 0;
  for (
    let index = startIndex + 1;
    index <= endIndex && index < geometry.length;
    index += 1
  ) {
    distance += milesBetween(geometry[index - 1], geometry[index]);
    focused.push(geometry[index]);
    if (distance >= maxMiles) break;
  }
  return focused;
}

export function MapProgressView() {
  const routeId = useSettingsStore((state) => state.routeId);
  const { route } = useGPSData(routeId);
  const traffic = useTrafficData(routeId);
  const trip = useLiveTrip();
  
  const nextStop = route.stops.find((stop) => stop.status !== 'departed') ?? route.stops.at(-1);
  const currentLocation = trip.locationVisibility === 'live' ? trip.currentLocation : null;
  const remainingStops = route.stops.filter((stop) => stop.status !== 'departed');
  
  const locations = currentLocation
    ? [currentLocation, ...remainingStops.map((stop) => stop.location)]
    : route.stops.map((stop) => stop.location);
  const fullGeometry = trip.routeGeometry.length >= 2 ? trip.routeGeometry : locations;
  // The map slide is an all-route overview. A close follow camera can leave
  // every stop off-screen while the coach is between route endpoints.
  const geometry = fullGeometry;
  
  const nextStopMiles = currentLocation && nextStop ? milesBetween(currentLocation, nextStop.location) : null;
  const visibleStops = nextStop && nextStopMiles !== null && nextStopMiles <= MAX_FOCUS_MILES
    ? [nextStop]
    : [];
    
  const isApproaching = nextStopMiles !== null && nextStopMiles <= 0.75;
  const minutesAway = nextStop
    ? traffic.state === 'live' && traffic.travelTimeMinutes !== null
      ? traffic.travelTimeMinutes
      : nextStop.eta && Number.isFinite(nextStop.eta.getTime())
        ? Math.max(1, Math.round((nextStop.eta.getTime() - Date.now()) / 60_000))
        : null
    : null;

  // Keep the complete ordered schedule on screen. The active row is also
  // scrolled into view automatically so a mounted display never needs touch.
  const nextStopRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (typeof nextStopRef.current?.scrollIntoView === 'function') {
      nextStopRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [nextStop?.id]);

  const formatStopEta = (eta: Date | null, scheduledArrival: Date | null) => {
    const value = eta && Number.isFinite(eta.getTime()) ? eta
      : scheduledArrival && Number.isFinite(scheduledArrival.getTime()) ? scheduledArrival
        : null;
    if (!value) return { clock: 'ETA unavailable', minutes: null };
    const minutes = Math.max(0, Math.round((value.getTime() - Date.now()) / 60_000));
    return {
      clock: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(value),
      minutes,
    };
  };

  const lang = trip.passengerLanguage;
  const rtl = isRTL(lang);
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(lang, key);

  return (
    <main className="relative flex min-h-0 flex-1 gap-6 p-7 animate-in fade-in duration-700" dir={rtl ? 'rtl' : 'ltr'}>
      
      {/* Left: Map Area */}
      <section className="relative min-w-0 flex-[1.65] overflow-hidden rounded-[2rem] border border-white/10 bg-[#dfe8df] shadow-2xl">
        <div className={`absolute ${rtl ? 'right-6' : 'left-6'} top-6 z-20 flex items-center gap-4 rounded-2xl bg-white/95 dark:bg-black/80 px-5 py-3 shadow-xl backdrop-blur-md border border-white/20`} dir={rtl ? 'rtl' : 'ltr'}>
          <div className="relative flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 shrink-0">
            <span className="absolute h-full w-full animate-ping rounded-full bg-primary opacity-40" />
            <Navigation className="relative z-10 h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">{t('liveGps')}</p>
            <p className="text-sm font-bold text-foreground">{t('followingRoute')}</p>
          </div>
        </div>

        <LiveCoachMap
          coach={currentLocation ?? null}
          route={geometry}
          nextStop={visibleStops[0]?.location ?? null}
          stops={route.stops}
          speedMph={trip.speedMph}
          cameraMode="overview"
        />

        {/* Telemetry overlay bottom */}
        <div className={`absolute bottom-6 ${rtl ? 'right-6' : 'left-6'} z-20 rounded-2xl border border-white/20 bg-white/95 p-5 shadow-xl backdrop-blur-md dark:bg-black/80 min-w-[16rem]`}>
          <div className="flex flex-col gap-4">
            <div className="flex justify-between items-end gap-6">
              <div className="flex flex-col">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">{t('remaining')}</p>
                <p className="mt-1 text-3xl leading-none font-black text-foreground tabular-nums tracking-tight">
                  {trip.remainingDistanceMiles?.toFixed(1) ?? '—'} <span className="text-base font-bold text-muted-foreground ml-0.5">{t('miles')}</span>
                </p>
              </div>
              
              {minutesAway !== null && (
                <div className="flex flex-col text-right">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">{t('eta')}</p>
                  <p className="mt-1 text-3xl leading-none font-black text-primary tabular-nums tracking-tight">
                    {minutesAway} <span className="text-base font-bold text-primary/70 ml-0.5">{t('minutes')}</span>
                  </p>
                </div>
              )}
            </div>
            
            {trip.totalDistanceMiles && trip.remainingDistanceMiles !== null && (
              <div className="w-full h-2.5 bg-secondary/50 rounded-full overflow-hidden" dir="ltr">
                <div 
                  className="h-full bg-primary transition-all duration-1000 ease-in-out" 
                  style={{ width: `${Math.min(100, Math.max(0, ((trip.totalDistanceMiles - trip.remainingDistanceMiles) / trip.totalDistanceMiles) * 100))}%` }}
                />
              </div>
            )}
          </div>
        </div>

      </section>

      {/* Right: Route Sequence Panel */}
      <aside className={`relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[2rem] border transition-colors duration-1000 ${
        isApproaching 
          ? 'border-primary/50 bg-card shadow-[0_0_50px_rgba(212,175,55,.15)]' 
          : 'border-white/10 bg-card shadow-2xl'
      }`}>
        
        {/* Panel Header */}
        <div className={`flex flex-col border-b border-border/50 p-8 pb-6 transition-colors duration-1000 ${
          isApproaching ? 'bg-primary/10' : 'bg-transparent'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Navigation className="h-6 w-6 text-primary" />
              <span className="text-sm font-black uppercase tracking-[0.2em] text-primary">
                {isApproaching ? t('approaching') : t('nextStop')}
              </span>
            </div>
          </div>
          <h2 className={`mt-2 break-words text-balance font-black leading-tight tracking-tight text-foreground ${
            (nextStop?.name.length ?? 0) > 52
              ? 'text-2xl'
              : (nextStop?.name.length ?? 0) > 30
                ? 'text-3xl'
                : 'text-4xl'
          }`}>
            {nextStop?.name ?? route.destination}
          </h2>
          <StopNote
            note={nextStop?.note}
            label={nextStop?.name}
            className="mt-2 line-clamp-2 text-base font-semibold leading-snug text-foreground/75"
          />
        </div>

        {/* Vertical Timeline List */}
        <div data-testid="upcoming-stop-cards" className="relative flex-1 overflow-y-auto p-8">
          {route.stops.map((stop, index) => {
            const isNext = stop.id === nextStop?.id;
            const isLast = index === route.stops.length - 1;
            const eta = formatStopEta(stop.eta, stop.scheduledArrival);
            const isPassed = stop.status === 'departed' && !isNext;
            
            return (
              <div ref={isNext ? nextStopRef : undefined} key={stop.id} data-testid={`sequence-item-${stop.id}`} className={`relative flex min-h-[4.5rem] items-stretch gap-4 ${isPassed ? 'opacity-50' : ''}`}>
                
                {/* Timeline Line & Node */}
                <div className="relative flex w-8 shrink-0 flex-col items-center justify-center">
                   {index > 0 && <div className="absolute top-0 bottom-1/2 w-1.5 bg-primary/20" />}
                  {!isLast && <div className="absolute top-1/2 bottom-0 w-1.5 bg-primary/20" />}
                  
                  <div className="relative z-10 flex items-center justify-center bg-card py-3">
                    {isNext ? (
                      <div className="relative flex h-6 w-6 items-center justify-center">
                        <span className="absolute h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                        <span className="h-4 w-4 rounded-full bg-primary ring-[5px] ring-card" />
                      </div>
                    ) : stop.isDestination ? (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary ring-[5px] ring-card">
                        <span className="h-2 w-2 rounded-full bg-card" />
                      </div>
                    ) : (
                      <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-primary/50 bg-card text-[10px] font-black text-primary">{index + 1}</div>
                    )}
                  </div>
                </div>

                {/* Timeline Content */}
                <div className={`flex flex-1 items-center justify-between py-4 ${!isLast ? 'border-b border-white/5' : ''}`}>
                    <div className="flex flex-1 items-center justify-between gap-4">
                      <div className="min-w-0 flex-1 py-1">
                        <p className={`break-words text-balance font-black tracking-tight leading-[1.15] ${
                           stop.name.length > 52
                             ? isNext ? 'text-lg text-primary' : 'text-base text-foreground'
                             : isNext ? 'text-xl text-primary' : 'text-lg text-foreground'
                        }`}>
                           {stop.name}
                        </p>
                        <StopNote
                           note={stop.note}
                           label={stop.name}
                          className={`mt-1 line-clamp-2 text-sm font-semibold leading-snug ${
                             isNext ? 'text-primary/80' : 'text-muted-foreground'
                          }`}
                        />
                         {stop.isDestination && (
                           <p className={`mt-1.5 text-[11px] font-bold uppercase tracking-[0.2em] ${isNext ? 'text-primary/80' : 'text-muted-foreground'}`}>
                            {t('finalDestination')}
                          </p>
                        )}
                      </div>
                      <div className={`shrink-0 ${rtl ? 'text-left' : 'text-right'}`}>
                        <p className={`text-3xl font-black tabular-nums tracking-tighter ${
                           isNext ? 'text-primary' : 'text-foreground'
                        }`}>
                           {eta.clock}
                           {eta.minutes !== null && <span className={`ml-2 text-xs font-bold tracking-normal ${isNext ? 'text-primary/70' : 'text-muted-foreground'}`}>({eta.minutes} {t('minutes')})</span>}
                        </p>
                      </div>
                    </div>
                </div>
                
              </div>
            );
          })}
        </div>
      </aside>
    </main>
  );
}
