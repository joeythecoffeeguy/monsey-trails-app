import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Clock, CloudSun } from 'lucide-react';
import { useSettingsStore } from '@/lib/store';
import { useGPSData, useWeatherData } from '@/providers/api-interfaces';
import { useDailyDaf, useJewishCalendar } from '@/providers/jewish-content';
import { useLiveTrip } from '@/providers/live-trip';
import { isRTL } from '@/lib/translations';

export function Header({ isDriving }: { activeMode: string; isDriving: boolean }) {
  const [time, setTime] = useState(new Date());
  const { brandName } = useSettingsStore();
  const { position } = useGPSData(useSettingsStore((s) => s.routeId));
  const weather = useWeatherData(position);
  const daf = useDailyDaf();
  const jewishCalendar = useJewishCalendar();
  const liveTrip = useLiveTrip();
  
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  
  const rtl = isRTL(liveTrip.passengerLanguage);

  return (
    <header className="flex min-w-0 items-center justify-between gap-3 px-6 py-4 bg-secondary/70 backdrop-blur z-40 border-b border-white/10" dir={rtl ? 'rtl' : 'ltr'}>
      <div className="flex min-w-0 items-center gap-4">
        <img
          src={`${import.meta.env.BASE_URL}monsey-trails-logo.png`}
          alt={brandName}
          className="h-10 w-auto max-w-[18rem] object-contain brightness-0 invert"
        />
      </div>

      <div className="flex min-w-0 shrink-0 items-center gap-4" dir="ltr">
        <div className="flex items-center gap-2 text-xl font-semibold whitespace-nowrap" aria-label={`Current weather: ${weather.condition}`}>
          <CloudSun className="w-6 h-6 text-primary" />
          <span>{weather.status === 'loading' ? '—°' : `${weather.tempF}°F`}</span>
        </div>
        {isDriving && (
          <div className="flex items-center gap-2 whitespace-nowrap border-l border-white/15 pl-5">
            <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Daf</span>
            <span className="text-base font-bold text-primary">{daf.refEnglish}</span>
          </div>
        )}
        {isDriving && (
          <div className="flex flex-col whitespace-nowrap border-l border-white/15 pl-5 leading-tight">
            <span className="text-base font-bold" dir="rtl">{jewishCalendar.hebrewDate}</span>
            {jewishCalendar.holiday && (
              <span className="mt-1 max-w-44 truncate text-xs font-bold uppercase tracking-wide text-primary">
                {jewishCalendar.holiday}
              </span>
            )}
          </div>
        )}
        <div className="flex items-center gap-3 tabular-nums whitespace-nowrap border-l border-white/15 pl-5 pr-1">
          <Clock className="w-6 h-6 text-primary" />
          <div className="flex flex-col leading-tight">
            <span className="text-2xl font-semibold tracking-tight">{format(time, 'h:mm a')}</span>
            <span className="mt-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {format(time, 'EEE, MMM d')}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
