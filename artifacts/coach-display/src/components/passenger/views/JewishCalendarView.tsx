import { AlarmClock, MapPin, Sunrise, Sunset, WifiOff } from 'lucide-react';
import { format } from 'date-fns';
import { useZmanim } from '@/providers/jewish-content';
import { useEffect, useState } from 'react';
import { useLiveTrip } from '@/providers/live-trip';
import { getTranslation, isRTL } from '@/lib/translations';

export function JewishCalendarView() {
  const zmanim = useZmanim();
  const language = useLiveTrip().passengerLanguage;
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(language, key);
  const [page, setPage] = useState(0);
  const unavailable = zmanim.freshness === 'offline' || zmanim.freshness === 'stale';
  const entryKeys = [
    ['alotHaShachar', 'עלות השחר', 'alotHaShachar'],
    ['earliestTallit', 'משיכיר', 'misheyakir'],
    ['sunrise', 'הנץ החמה', 'sunrise'],
    ['latestShemaMGA', 'סוף זמן שמע מג״א', 'sofZmanShmaMGA'],
    ['latestShemaGRA', 'סוף זמן שמע גר״א', 'sofZmanShma'],
    ['latestShacharit', 'סוף זמן תפילה', 'sofZmanTfilla'],
    ['chatzot', 'חצות היום', 'chatzot'],
    ['minchaGedola', 'מנחה גדולה', 'minchaGedola'],
    ['plagHaMincha', 'פלג המנחה', 'plagHaMincha'],
    ['sunset', 'שקיעה', 'sunset'],
    ['nightfall', 'צאת הכוכבים', 'tzeit7083deg'],
  ] as const;
  const entries = entryKeys.map(([labelKey, hebrew, key]) => [t(labelKey), hebrew, key] as const);
  const pageSize = 6;
  const pageCount = Math.ceil(entries.length / pageSize);
  const visibleEntries = entries.slice(page * pageSize, (page + 1) * pageSize);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPage((current) => (current + 1) % pageCount);
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [pageCount]);

  return (
    <div dir={isRTL(language) ? 'rtl' : 'ltr'} className="flex-1 flex flex-col p-10 animate-in fade-in duration-700">
      <div className="flex items-center gap-4">
        <AlarmClock className="h-10 w-10 text-primary" />
         <h2 className="text-4xl font-bold">{t('dailyZmanim')}</h2>
         <span className="ms-auto rounded-full bg-primary/15 px-4 py-2 text-sm font-bold uppercase tracking-wider text-primary">
           {unavailable && <WifiOff className="me-2 inline h-4 w-4" />}
           {zmanim.freshness === 'live' ? t('monseyTimes') : unavailable ? t('lastSavedTimes') : t('updating')}
        </span>
      </div>

      <div className="mt-7 flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-border/50 bg-secondary/35 px-6 py-3 text-lg text-muted-foreground">
        <MapPin className="h-6 w-6 text-primary" />
         <span dir="auto" className="min-w-0 break-words"><bdi dir="auto">{zmanim.location}</bdi></span>
         <span className="ms-auto shrink-0">{t('timesUpdate')} · {page + 1} {t('pageOf')} {pageCount}</span>
      </div>

      <div className="mt-6 grid flex-1 grid-cols-2 gap-x-6 gap-y-3">
        {visibleEntries.map(([english, hebrew, key], index) => {
          const Icon = key === 'sunrise' ? Sunrise : key === 'sunset' || key === 'tzeit7083deg' ? Sunset : AlarmClock;
          return (
            <div
              key={key}
              className={`flex min-w-0 items-center rounded-2xl border border-border/50 bg-secondary/40 px-6 py-3 animate-in fade-in duration-500 ${
                visibleEntries.length % 2 === 1 && index === visibleEntries.length - 1 ? 'col-span-2' : ''
              }`}
            >
              <Icon className="me-4 h-7 w-7 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-xl font-semibold leading-tight break-words">{english}</p>
                <p dir="rtl" lang="he" className="text-base text-muted-foreground">{hebrew}</p>
              </div>
              <p className="ms-auto shrink-0 ps-4 text-2xl font-bold tabular-nums text-primary">
                {zmanim.times[key] ? format(zmanim.times[key], 'h:mm a') : '—'}
              </p>
            </div>
          );
        })}
        </div>
    </div>
  );
}