import { format } from 'date-fns';
import { AlertTriangle, CheckCircle2, Clock3, Route, WifiOff } from 'lucide-react';
import { useSettingsStore } from '@/lib/store';
import { useTrafficData } from '@/providers/api-interfaces';
import { useLiveTrip } from '@/providers/live-trip';
import { getTranslation, isRTL } from '@/lib/translations';

export function TrafficView() {
  const routeId = useSettingsStore((state) => state.routeId);
  const language = useLiveTrip().passengerLanguage;
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(language, key);
  const traffic = useTrafficData(routeId);
  const localizedStatus = traffic.status === 'clear'
    ? t('trafficClear')
    : traffic.status === 'moderate' ? t('trafficModerate') : t('trafficHeavy');
  const isClear = traffic.status === 'clear';

  return (
    <div dir={isRTL(language) ? 'rtl' : 'ltr'} className="flex-1 min-h-0 flex flex-col p-12 animate-in fade-in duration-700">
      <div className="flex items-center gap-4 mb-10">
        <Route className="w-10 h-10 text-primary" />
        <h2 className="text-4xl font-bold tracking-tight">{t('travelConditions')}</h2>
        {traffic.state !== 'live' && (
          <span data-testid="status-traffic-freshness" className="ms-auto flex items-center gap-2 rounded-full bg-amber-400/10 px-4 py-2 text-lg font-semibold text-amber-300">
            <WifiOff className="h-5 w-5" /> {traffic.state === 'offline' ? t('offlineConditions') : t('conditionsDelayed')}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)] gap-8">
        <section className="min-w-0 rounded-3xl border border-white/10 bg-secondary/45 p-10 flex flex-col justify-center">
          <div className="flex items-center gap-4 mb-8">
            {isClear ? (
              <CheckCircle2 className="w-12 h-12 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-12 h-12 text-primary" />
            )}
            <span className="text-2xl font-bold uppercase tracking-widest text-white/65">
              {localizedStatus} {t('traffic')}
            </span>
          </div>
          <p data-testid="text-traffic-summary" className="text-4xl font-semibold leading-tight max-w-4xl break-words">
             <bdi dir="auto">{traffic.summary}</bdi>
          </p>
          <div className="mt-8 pt-6 border-t border-white/10 text-xl text-white/60 break-words">
            {t('currentCorridor')}: <bdi dir="auto"><span className="text-white font-semibold">{traffic.road}</span></bdi>
          </div>
        </section>

        <aside className="min-w-0 rounded-3xl border border-white/10 bg-white/5 p-8 flex flex-col justify-center gap-8">
          <div>
            <span className="block text-sm font-bold uppercase tracking-[0.2em] text-white/50 mb-3">
              {t('estimatedArrival')}
            </span>
            <span data-testid="text-traffic-arrival" className="text-6xl font-bold tabular-nums text-white">
              {traffic.arrivalTime ? format(traffic.arrivalTime, 'h:mm a') : '—'}
            </span>
            {traffic.travelTimeMinutes !== null && (
              <span className="mt-2 block text-lg font-semibold text-white/60">
                {traffic.travelTimeMinutes} {t('minutesRemaining')}
              </span>
            )}
          </div>
          <div>
            <span className="block text-sm font-bold uppercase tracking-[0.2em] text-white/50 mb-3">
              {t('estimatedDelay')}
            </span>
            <div className="flex items-baseline gap-3">
              <span data-testid="text-traffic-delay" className="text-5xl font-bold tabular-nums text-primary">{traffic.delayMinutes}</span>
               <span className="text-2xl font-semibold text-white/65">{getTranslation(language, 'minutes')}</span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-white/60">
            <Clock3 className="w-6 h-6 text-primary" />
            <span className="text-lg">{t('updated')} {format(traffic.updatedAt, 'HH:mm')}</span>
          </div>
        </aside>
      </div>
    </div>
  );
}