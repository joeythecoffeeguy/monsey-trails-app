import { MapPin, Navigation, Clock, Briefcase } from 'lucide-react';
import { formatPassengerDestination } from '@/lib/destination-label';
import { useLiveTrip } from '@/providers/live-trip';
import { useEffect, useState } from 'react';
import { getDistanceMiles, getNextStopPhase, parseEtaSeconds } from '@/lib/next-stop-trigger';
import { getTranslation, isRTL } from '@/lib/translations';
import { useSettingsStore } from '@/lib/store';
import { useTrafficData } from '@/providers/api-interfaces';
import { StopNote } from '@/components/passenger/StopNote';

export function NextStopView() {
  const trip = useLiveTrip();
  const traffic = useTrafficData(useSettingsStore((state) => state.routeId));
  const nextStop = trip.intermediateStops?.[0];
  const nextLocation = nextStop ? { lat: nextStop.lat, lng: nextStop.lng } : trip.destination;
  const scheduledEta = nextStop ? (nextStop.eta ?? null) : trip.eta;
  const nextEta = traffic.state === 'live' && traffic.arrivalTime
    ? traffic.arrivalTime.toISOString()
    : scheduledEta;
  const nextName = formatPassengerDestination(nextStop?.address ?? trip.destinationAddress);
  const nextNote = nextStop?.note ?? trip.destinationNote;
  const finalName = formatPassengerDestination(trip.destinationAddress);
  
  const remainingStopsCount = (trip.intermediateStops?.length || 0) + (trip.destination ? 1 : 0);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const localDistance = trip.currentLocation && nextLocation 
    ? getDistanceMiles(trip.currentLocation, nextLocation) 
    : null;
    
  const etaSeconds = parseEtaSeconds(nextEta, now);
  const phase = getNextStopPhase(trip.currentLocation, nextLocation, nextEta, now);

  const isArriving = phase === 'arriving';
  const etaMinutes = etaSeconds !== null ? Math.max(1, Math.ceil(etaSeconds / 60)) : null;

  const lang = trip.passengerLanguage;
  const rtl = isRTL(lang);
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(lang, key);

  return (
    <main className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,rgba(212,175,55,0.08),transparent_70%)] px-14 py-5" dir={rtl ? 'rtl' : 'ltr'}>
      {isArriving && (
        <div className="absolute inset-0 bg-primary/5 animate-in fade-in duration-1000" />
      )}
      
      <section className="relative flex max-h-full w-full max-w-5xl flex-col items-center overflow-hidden rounded-[2.5rem] border border-primary/30 bg-secondary/90 px-16 py-6 text-center shadow-[0_0_80px_rgba(212,175,55,0.15)] backdrop-blur-md">
        
        {isArriving && (
          <div className="absolute inset-0 motion-safe:animate-pulse rounded-[2.5rem] border-4 border-primary/40" aria-hidden="true" />
        )}
        
        <div className="relative mb-4 flex items-center gap-4 text-primary" dir="ltr">
          {isArriving ? (
            <span className="relative flex h-6 w-6">
              <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-6 w-6 rounded-full bg-primary shadow-[0_0_15px_rgba(212,175,55,1)]" />
            </span>
          ) : (
            <span className="relative flex h-5 w-5">
              <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-primary opacity-45" />
              <span className="relative inline-flex h-5 w-5 rounded-full bg-primary" />
            </span>
          )}
          <span className={`font-black uppercase tracking-[0.3em] transition-all duration-700 ${isArriving ? 'text-3xl text-primary drop-shadow-md' : 'text-2xl'}`}>
            {isArriving ? t('nowArriving') : t('nextStop')}
          </span>
        </div>

        <div className="relative mb-4 flex items-center justify-center gap-7">
          <div className={`flex shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_35px_rgba(212,175,55,0.45)] transition-all duration-700 ${isArriving ? 'h-24 w-24' : 'h-20 w-20'}`}>
            <MapPin className={isArriving ? 'h-12 w-12' : 'h-10 w-10'} />
          </div>
          <h1 className={`max-w-3xl break-words text-balance font-black leading-[1.05] tracking-tight text-white transition-all duration-700 ${isArriving ? 'text-7xl' : 'text-6xl'}`}>
            {nextName || t('destinationAhead')}
          </h1>
        </div>
        <StopNote
          note={nextNote}
          label={nextName}
          className="relative -mt-1 mb-2 line-clamp-2 max-w-3xl text-2xl font-semibold leading-snug text-white/80"
        />
        
        <div className="my-3 flex w-full max-w-2xl items-center gap-4 text-primary/70" dir="ltr">
          <div className="flex flex-col items-center">
            <div className="w-4 h-4 rounded-full border-2 border-primary/50 bg-secondary" />
          </div>
          <div className="flex-1 h-[2px] bg-primary/20 relative overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-primary/60 w-3/4 rounded-full motion-safe:animate-[pulse_3s_ease-in-out_infinite]" />
          </div>
          <div className="flex flex-col items-center">
            <MapPin className="w-6 h-6 text-primary" />
          </div>
          {nextStop && (
            <>
              <div className="flex-1 h-[2px] bg-primary/20 relative" />
              <div className="flex flex-col items-center opacity-50">
                <Navigation className="w-5 h-5 text-primary" />
              </div>
            </>
          )}
        </div>

        {isArriving && (
          <div className="relative mb-3 mt-1 animate-in slide-in-from-bottom-4 fade-in duration-700">
            <div className="flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/10 px-7 py-2.5 text-xl font-bold text-white">
              <Briefcase className="h-6 w-6 text-primary" />
              {t('gatherBelongings')}
            </div>
          </div>
        )}

        <div className="relative flex flex-wrap items-center justify-center gap-x-8 gap-y-2 rounded-[2rem] border border-white/10 bg-black/40 px-10 py-3 text-lg backdrop-blur-md">
          {localDistance !== null && !isArriving && (
            <span className="flex items-center gap-2 font-semibold text-white" dir="ltr">
              <Navigation className="h-5 w-5 text-primary" />
              {localDistance.toFixed(1)} {t('miles')}
            </span>
          )}
          
          {etaMinutes !== null && !isArriving && (
            <>
              {localDistance !== null && <span className="h-6 w-px bg-white/20" />}
              <span className="flex items-center gap-2 font-semibold text-white" dir="ltr">
                <Clock className="h-5 w-5 text-primary" />
                {etaMinutes} {t('minutes')}
              </span>
            </>
          )}

          {(localDistance !== null || etaMinutes !== null) && !isArriving && (
             <span className="h-6 w-px bg-white/20" />
          )}

          {remainingStopsCount > 1 && (
            <span className="font-bold text-primary">
              {remainingStopsCount - 1} {remainingStopsCount - 1 > 1 ? t('stopsAfterThis') : t('stopAfterThis')}
            </span>
          )}
          
          {nextStop && (
            <>
              {remainingStopsCount > 1 && <span className="h-6 w-px bg-white/20" />}
              <span className="flex items-center gap-3 text-white/75">
                <span className="truncate max-w-lg">{t('finalDestinationIs')} <strong className="text-white ml-2">{finalName}</strong></span>
              </span>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
