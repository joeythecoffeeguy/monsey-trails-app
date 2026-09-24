import { BookOpen, CalendarDays, Flame, MoonStar, WifiOff } from 'lucide-react';
import { format } from 'date-fns';
import { useDailyDaf, useJewishCalendar } from '@/providers/jewish-content';
import { useLiveTrip } from '@/providers/live-trip';
import { getTranslation, isRTL } from '@/lib/translations';

export function DailyDafView() {
  const daf = useDailyDaf();
  const language = useLiveTrip().passengerLanguage;
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(language, key);
  const calendar = useJewishCalendar();
  const unavailable = [daf.freshness, calendar.freshness].some(
    (freshness) => freshness === 'offline' || freshness === 'stale',
  );

  return (
    <div dir={isRTL(language) ? 'rtl' : 'ltr'} className="flex-1 min-h-0 flex flex-col p-8 animate-in fade-in duration-700">
      <div className="flex min-w-0 flex-wrap items-center gap-4">
        <CalendarDays className="h-10 w-10 text-primary" />
        <h2 className="text-4xl font-bold">{t('jewishToday')}</h2>
        <span className="ms-auto rounded-full bg-primary/15 px-4 py-2 text-sm font-bold uppercase tracking-wider text-primary">
          {unavailable && <WifiOff className="me-2 inline h-4 w-4" />}
           {!unavailable && daf.freshness === 'live' ? t('updatedAutomatically') : unavailable ? t('lastSavedInfo') : t('updating')}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] items-stretch gap-6 pt-6">
        <section className="min-w-0 flex flex-col justify-center rounded-[2.5rem] border border-border/50 bg-secondary/40 p-8 text-center shadow-2xl">
          <BookOpen className="mx-auto h-12 w-12 text-primary" />
           <p dir="rtl" lang={language} className="mt-4 text-4xl font-semibold text-primary">{t('dafDaily')}</p>
          <p dir="rtl" lang="he" className="mt-6 text-6xl font-bold leading-tight break-words">{daf.refHebrew}</p>
           <p dir="auto" className="mt-3 text-3xl font-medium text-muted-foreground break-words"><bdi dir="auto">{daf.refEnglish}</bdi></p>
        </section>

        <section className="min-w-0 grid grid-rows-[1fr_auto] gap-5">
          <div className="min-w-0 rounded-[2.5rem] border border-border/50 bg-secondary/40 p-6 text-center shadow-2xl">
             <p dir="rtl" lang={language} className="text-2xl font-medium text-primary">{t('hebrewDateLabel')}</p>
            <p dir="rtl" lang="he" className="mt-3 text-4xl font-bold break-words">{calendar.hebrewDate}</p>
            {calendar.parsha && (
              <p dir="rtl" lang="he" className="mt-4 rounded-2xl bg-background/50 px-5 py-3 text-2xl font-semibold break-words">
                {calendar.parsha}
              </p>
            )}
            {calendar.holiday && (
              <p dir="rtl" lang="he" className="mt-4 text-2xl font-semibold text-primary">{calendar.holiday}</p>
            )}
          </div>

          {(calendar.candleLighting || calendar.havdalah) && (
            <div className={`grid gap-5 ${calendar.candleLighting && calendar.havdalah ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {calendar.candleLighting && (
                <div className="rounded-3xl border border-border/50 bg-secondary/40 p-6">
                  <Flame className="h-8 w-8 text-primary" />
                   <p className="mt-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">{t('candleLighting')}</p>
                  <p className="mt-1 text-3xl font-bold tabular-nums">
                    {format(calendar.candleLighting, 'h:mm a')}
                  </p>
                </div>
              )}
              {calendar.havdalah && (
                <div className="rounded-3xl border border-border/50 bg-secondary/40 p-6">
                  <MoonStar className="h-8 w-8 text-primary" />
                   <p className="mt-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">{t('shabbatEnds')}</p>
                  <p className="mt-1 text-3xl font-bold tabular-nums">
                    {format(calendar.havdalah, 'h:mm a')}
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}