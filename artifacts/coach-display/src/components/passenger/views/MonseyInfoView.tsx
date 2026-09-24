import { useEffect, useState } from 'react';
import { AlertTriangle, BusFront, CircleDollarSign, Info, Mail, MapPin } from 'lucide-react';
import { getPassengerInfo, type PassengerInfo } from '@/providers/passenger-info';
import { useLiveTrip } from '@/providers/live-trip';
import { getTranslation, isRTL } from '@/lib/translations';

type InfoSection = 'destinations' | 'fares' | 'guide' | 'contact';
export function MonseyInfoView({ section, compact = false }: { section: InfoSection; compact?: boolean }) {
  const language = useLiveTrip().passengerLanguage;
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(language, key);
  const metadata = {
    destinations: { eyebrow: t('whereWeGo'), title: t('destinationsTitle'), subtitle: t('destinationsSubtitle'), icon: MapPin },
    fares: { eyebrow: t('planTrip'), title: t('faresTitle'), subtitle: t('faresSubtitle'), icon: CircleDollarSign },
    guide: { eyebrow: t('knowBeforeGo'), title: t('guideTitle'), subtitle: t('guideSubtitle'), icon: BusFront },
    contact: { eyebrow: t('hereToHelp'), title: t('contactTitle'), subtitle: t('contactSubtitle'), icon: Mail },
  };
  const [info, setInfo] = useState<PassengerInfo | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void getPassengerInfo(controller.signal).then(setInfo).catch(() => undefined);
    return () => controller.abort();
  }, []);
  const meta = metadata[section];
  const Icon = meta.icon;
  const cards = info?.content[language]?.[section] ?? [];

  return (
    <div dir={isRTL(language) ? 'rtl' : 'ltr'} className={`flex-1 min-h-0 animate-in fade-in duration-500 ${compact ? 'p-4' : 'p-8'}`}>
      <div className="mx-auto flex h-full max-w-6xl min-w-0 flex-col">
        <div className={`flex justify-between ${compact ? 'mb-4 flex-col items-start gap-3' : 'mb-6 items-end gap-8'}`}>
          <div className="min-w-0">
            <p className={`${compact ? 'text-xs' : 'text-base'} font-bold uppercase tracking-[0.22em] text-primary`}>{meta.eyebrow}</p>
            <h2 className={`mt-2 font-black tracking-tight ${compact ? 'text-3xl' : 'text-5xl'}`}>{meta.title}</h2>
            <p className={`mt-2 text-muted-foreground ${compact ? 'text-base' : 'text-xl'}`}>{meta.subtitle}</p>
          </div>
          {info && <p className={`${compact ? 'text-start text-xs' : 'shrink-0 text-end text-sm'} font-semibold text-muted-foreground`}>
            {t('officialWebsite')}<br />{t('reviewed')} {new Date(info.reviewedAt).toLocaleDateString()}
          </p>}
        </div>
        {info?.stale && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-base font-semibold text-amber-200">
            <AlertTriangle className="h-5 w-5" /> {t('informationOverdue')}
          </div>
        )}
        <div className={`grid min-h-0 flex-1 ${compact ? 'grid-cols-1 gap-3' : `gap-5 ${cards.length > 4 ? 'grid-cols-3' : 'grid-cols-2'}`}`}>
          {cards.map((card) => (
            <section key={card.title} className={`min-w-0 border border-white/10 bg-secondary/55 ${compact ? 'rounded-2xl p-4' : 'rounded-3xl p-6'}`}>
              <div className="flex items-center gap-3">
                <div className={`flex shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary ${compact ? 'h-9 w-9' : 'h-11 w-11'}`}><Icon className={compact ? 'h-5 w-5' : 'h-6 w-6'} /></div>
                <h3 dir="auto" className={`${compact ? 'text-xl' : 'text-2xl'} font-bold`}>{card.title}</h3>
              </div>
              <p dir="auto" className={`mt-4 whitespace-pre-line leading-relaxed text-muted-foreground ${compact ? 'text-base' : 'text-lg'}`}>{card.text}</p>
            </section>
          ))}
          {!info && <section className="col-span-full flex items-center justify-center rounded-3xl border border-white/10 bg-secondary/55 text-xl text-muted-foreground"><Info className="me-3 h-6 w-6" />{t('loadingInfo')}</section>}
        </div>
      </div>
    </div>
  );
}