import { useSettingsStore } from '@/lib/store';
import { useGPSData, useTrafficData } from '@/providers/api-interfaces';
import { useLiveTrip } from '@/providers/live-trip';
import { format } from 'date-fns';
import { MapPin } from 'lucide-react';
import { formatPassengerDestination } from '@/lib/destination-label';
import { getTranslation, isRTL } from '@/lib/translations';
import { StopNote } from '@/components/passenger/StopNote';
import { LocationConfidenceIndicator } from '@/components/passenger/LocationConfidenceIndicator';

export function Footer() {
  const routeId = useSettingsStore((s) => s.routeId);
  const { route } = useGPSData(routeId);
  const traffic = useTrafficData(routeId);
  const liveTrip = useLiveTrip();
  const hasDestination = liveTrip.destinationAddress.trim().length > 0;

  if (!hasDestination) return null;

  const destinationName = formatPassengerDestination(liveTrip.destinationAddress);
  const isRunning = liveTrip.status === 'running';
  const nextStop = isRunning
    ? route.stops.find((stop) => stop.status !== 'departed')
    : undefined;
  const nextStopName = nextStop?.name ?? destinationName;
  const nextStopNote = nextStop?.note ?? liveTrip.destinationNote;
  const liveArrivalTime = traffic.state === 'live' ? traffic.arrivalTime : null;
  const hasProgress = isRunning
    && liveTrip.totalDistanceMiles !== null
    && liveTrip.remainingDistanceMiles !== null;
  const progressPercent = hasProgress
    ? Math.min(100, Math.max(0, ((liveTrip.totalDistanceMiles! - liveTrip.remainingDistanceMiles!) / liveTrip.totalDistanceMiles!) * 100))
    : 0;

  const lang = liveTrip.passengerLanguage;
  const rtl = isRTL(lang);
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(lang, key);

  return (
    <footer className="bg-secondary p-6 border-t border-border/40 shrink-0 text-secondary-foreground" dir={rtl ? 'rtl' : 'ltr'}>
      <div className="flex min-w-0 items-center justify-between gap-6 mb-4">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span className="shrink-0 text-secondary-foreground/65 uppercase tracking-widest text-sm font-bold">{t('nextStop')}</span>
          <div className="min-w-0">
            <h2 className="min-w-0 text-4xl font-bold leading-tight text-secondary-foreground break-words line-clamp-2">
              {nextStopName}
            </h2>
            <StopNote
              note={nextStopNote}
              label={nextStopName}
              className="mt-1 line-clamp-2 text-base font-semibold leading-snug text-secondary-foreground/75"
            />
          </div>
        </div>
        
        {nextStop && (
          <div className="shrink-0 flex flex-col items-end" dir={rtl ? 'ltr' : 'ltr'}>
            <span className="text-secondary-foreground/65 uppercase tracking-widest text-sm font-bold w-full text-right">{t('eta')}</span>
            <div data-testid="text-footer-eta" className="text-4xl font-bold text-primary tabular-nums tracking-tight">
              {liveArrivalTime
                ? format(liveArrivalTime, 'h:mm a')
                : 'Updating traffic…'}
            </div>
          </div>
        )}
      </div>

      {hasProgress && (
        <div className="relative h-2 w-full bg-background rounded-full overflow-hidden mt-4" dir="ltr">
          <div
            className="absolute top-0 left-0 h-full bg-primary transition-all duration-1000 ease-in-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}
      
        <div className="flex justify-between mt-3 text-sm font-medium text-secondary-foreground/70">
        <div className="flex min-w-0 max-w-[48%] items-center gap-1.5">
          <MapPin className="shrink-0 w-4 h-4" />
          <span className="truncate">{isRunning ? route.origin : t('awaitingDeparture')}</span>
          <LocationConfidenceIndicator
            trip={liveTrip}
            tone="dark"
            className={rtl ? 'mr-4' : 'ml-4'}
          />
        </div>
        <div className="flex min-w-0 max-w-[48%] items-center justify-end gap-1.5">
          <span className={`shrink-0 text-xs font-bold uppercase tracking-wider text-secondary-foreground/50 ${rtl ? 'ml-2' : 'mr-2'}`}>{t('final')}</span>
          <span className="truncate">{destinationName}</span>
          <MapPin className="shrink-0 w-4 h-4" />
        </div>
      </div>
    </footer>
  );
}
