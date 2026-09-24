import { useLiveTrip } from '@/providers/live-trip';
import { getTranslation, isRTL } from '@/lib/translations';
import { Info, Megaphone } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

export function AnnouncementsView({ compact = false }: { compact?: boolean }) {
  const liveTrip = useLiveTrip();
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(liveTrip.passengerLanguage, key);
  const storedAnnouncements = liveTrip.announcements ?? [];
  const announcements = useMemo(
    () => liveTrip.displayMode === 'announcements'
      ? storedAnnouncements
      : storedAnnouncements.filter((announcement) => announcement.active),
    [liveTrip.displayMode, storedAnnouncements],
  );

  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (announcements.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % announcements.length);
    }, 10000); // cycle internal announcements every 10s if shown
    return () => clearInterval(timer);
  }, [announcements.length]);

  if (announcements.length === 0) {
    return (
      <div dir={isRTL(liveTrip.passengerLanguage) ? 'rtl' : 'ltr'} className={`flex-1 flex items-center justify-center ${compact ? 'p-6' : 'p-12'}`}>
        <div className="text-center text-muted-foreground space-y-6">
          <Info className={`${compact ? 'h-14 w-14' : 'h-24 w-24'} mx-auto opacity-50`} />
          <h2 className={`${compact ? 'text-2xl' : 'text-4xl'} font-medium`}>{t('noAnnouncements')}</h2>
        </div>
      </div>
    );
  }

  const current = announcements[currentIndex];

  return (
    <div dir={isRTL(liveTrip.passengerLanguage) ? 'rtl' : 'ltr'} className={`flex-1 min-h-0 flex flex-col animate-in fade-in duration-700 ${compact ? 'p-5' : 'p-10'}`}>
      <div className={`flex items-center gap-4 ${compact ? 'mb-5' : 'mb-8'}`}>
        <Megaphone className={`${compact ? 'h-7 w-7' : 'h-10 w-10'} text-primary`} />
        <h2 className={`${compact ? 'text-2xl' : 'text-4xl'} font-bold tracking-tight`}>{t('passengerInformation')}</h2>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center overflow-y-auto">
        <div key={current.id} className="max-w-4xl min-w-0 w-full text-center space-y-8 animate-in zoom-in-95 fade-in duration-500">
          <h3 className={`${compact ? 'text-3xl' : 'text-5xl'} font-bold text-foreground leading-tight tracking-tight break-words`}>
            <bdi dir="auto">{current.title}</bdi>
          </h3>
          <p className={`${compact ? 'text-xl' : 'text-3xl'} text-muted-foreground leading-snug break-words`}>
            <bdi dir="auto">{current.message}</bdi>
          </p>
          
          {/* Pagination dots if multiple */}
          {announcements.length > 1 && (
            <div className="flex justify-center gap-3 pt-6">
              {announcements.map((_, i) => (
                <div 
                  key={i} 
                  className={`h-2.5 rounded-full transition-all duration-300 ${i === currentIndex ? 'w-10 bg-primary' : 'w-2.5 bg-muted-foreground/30'}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
