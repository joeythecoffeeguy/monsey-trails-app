import { useEffect, useState } from 'react';
import { Accessibility, Check, Clock3, Copy, Languages, Share2, Star, Trash2, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import type { PassengerScheduleFilters } from './PersonalUnpairedView';
import {
  clearSavedPassengerTimes,
  readPassengerHistory,
  readPassengerPreferences,
  savePassengerPreferences,
  setPassengerFavorite,
  savedTripIdentity,
  type SavedPassengerTrip,
} from './passengerWebStorage';
import { passengerShareUrl, sharePassengerTrip } from './passengerShare';

const labels = {
  en: { preferences: 'Accessibility & language', close: 'Close', large: 'Large text', motion: 'Reduce motion', language: 'Language', clear: 'Clear saved offline times', cleared: 'Saved times cleared', favorite: 'Save favorite', saved: 'Saved favorite', share: 'Share exact trip', copied: 'Link copied', error: 'Could not share this trip.' },
  yi: { preferences: 'צוטריטלעכקייט און שפראך', close: 'פארמאכן', large: 'גרויסע שריפט', motion: 'ווייניקער באוועגונג', language: 'שפראך', clear: 'מעקן געראטעוועטע אף־ליין צייטן', cleared: 'געראטעוועטע צייטן זענען געמעקט', favorite: 'היט אלס באליבט', saved: 'געהיט אלס באליבט', share: 'טיילן די גענויע רייזע', copied: 'לינק קאפירט', error: 'מען קען נישט טיילן די רייזע.' },
  he: { preferences: 'נגישות ושפה', close: 'סגירה', large: 'טקסט גדול', motion: 'הפחתת תנועה', language: 'שפה', clear: 'מחיקת זמני אופליין שמורים', cleared: 'הזמנים השמורים נמחקו', favorite: 'שמירה כמועדף', saved: 'נשמר כמועדף', share: 'שיתוף הנסיעה המדויקת', copied: 'הקישור הועתק', error: 'לא ניתן לשתף את הנסיעה.' },
};

export function usePersonalPreferences() {
  const [preferences, setPreferences] = useState(readPassengerPreferences);
  useEffect(() => {
    const update = () => setPreferences(readPassengerPreferences());
    window.addEventListener('passenger-preferences', update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener('passenger-preferences', update);
      window.removeEventListener('storage', update);
    };
  }, []);
  return preferences;
}

export function personalPreferenceClasses(preferences: ReturnType<typeof readPassengerPreferences>) {
  return `${preferences.largeText ? '[&_.text-xs]:!text-sm [&_.text-sm]:!text-base [&_.text-base]:!text-lg [&_.text-lg]:!text-xl' : ''} ${preferences.reducedMotion ? '[&_*]:!scroll-auto [&_*]:!transition-none [&_*]:!animate-none' : ''}`;
}

export function PassengerPreferenceButton() {
  const preferences = usePersonalPreferences();
  const [open, setOpen] = useState(false);
  const [cleared, setCleared] = useState(false);
  const text = labels[preferences.language];
  const update = (next: Partial<typeof preferences>) => savePassengerPreferences({ ...preferences, ...next });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" aria-label={text.preferences} className="flex h-11 w-11 items-center justify-center rounded-full border border-current/20 bg-white/10 focus-visible:ring-2 focus-visible:ring-primary">
          <Accessibility className="h-5 w-5" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[190] bg-black/65 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <Dialog.Content
          aria-describedby={undefined}
          dir={preferences.language === 'en' ? 'ltr' : 'rtl'}
          className="fixed left-1/2 top-1/2 z-[200] max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl border border-border bg-background p-5 text-foreground shadow-2xl focus:outline-none"
        >
          <Dialog.Title className="pe-8 text-lg font-black">{text.preferences}</Dialog.Title>
          <Dialog.Close aria-label={text.close} className="absolute end-4 top-4 rounded-full p-1 focus-visible:ring-2 focus-visible:ring-primary">
            <X className="h-5 w-5" />
          </Dialog.Close>
          <div className="mt-4 space-y-3">
          {([
            ['largeText', text.large],
            ['reducedMotion', text.motion],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex min-h-12 items-center justify-between gap-4 rounded-xl border border-border px-4 py-3 font-bold">
              <span>{label}</span>
              <input type="checkbox" checked={preferences[key]} onChange={(event) => update({ [key]: event.target.checked })} className="h-5 w-5" />
            </label>
          ))}
          <label className="block rounded-xl border border-border px-4 py-3 font-bold">
            <span className="flex items-center gap-2"><Languages className="h-4 w-4" />{text.language}</span>
            <select value={preferences.language} onChange={(event) => update({ language: event.target.value as 'en' | 'yi' | 'he' })} className="mt-2 w-full rounded-lg border border-border bg-background p-2">
              <option value="en">English</option><option value="yi">יידיש</option><option value="he">עברית</option>
            </select>
          </label>
          <button type="button" onClick={() => { clearSavedPassengerTimes(); setCleared(true); }} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 font-bold">
            {cleared ? <Check className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}{cleared ? text.cleared : text.clear}
          </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function PassengerTripActions({ runKey, departureTime, filters, originName, destinationName, pickupStop, dropoffStop }: {
  runKey: string;
  departureTime: string;
  filters: PassengerScheduleFilters;
  originName?: string;
  destinationName?: string;
  pickupStop?: SavedPassengerTrip['pickupStop'];
  dropoffStop?: SavedPassengerTrip['dropoffStop'];
}) {
  const preferences = usePersonalPreferences();
  const text = labels[preferences.language];
  const trip: SavedPassengerTrip = { runKey, departureTime, filters, originName, destinationName, pickupStop, dropoffStop, savedAt: new Date().toISOString() };
  const [favorite, setFavorite] = useState(() => readPassengerHistory().favorites.some((item) => savedTripIdentity(item) === savedTripIdentity(trip)));
  const [status, setStatus] = useState('');
  async function share() {
    setStatus('');
    try {
      const result = await sharePassengerTrip(passengerShareUrl({ filters, runKey, departureTime, view: 'trip', pickupStop, dropoffStop }), `${originName ?? ''} – ${destinationName ?? ''}`);
      if (result === 'copied') setStatus(text.copied);
    } catch {
      setStatus(text.error);
    }
  }
  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-pressed={favorite} aria-label={favorite ? text.saved : text.favorite} onClick={() => { const next = !favorite; setFavorite(next); setPassengerFavorite(trip, next); }} className="rounded-full p-2 hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-primary">
        <Star className={`h-5 w-5 ${favorite ? 'fill-current' : ''}`} />
      </button>
      <button type="button" aria-label={text.share} onClick={() => void share()} className="rounded-full p-2 hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-primary"><Share2 className="h-5 w-5" /></button>
      {status && <span role={status === text.error ? 'alert' : 'status'} className="absolute right-4 top-16 z-50 rounded-lg bg-background px-3 py-2 text-xs font-bold text-foreground shadow-lg">{status === text.copied ? <Copy className="mr-1 inline h-3 w-3" /> : null}{status}</span>}
    </div>
  );
}

export function PassengerSavedTrips({ onRestore }: { onRestore: (trip: SavedPassengerTrip) => void }) {
  const preferences = usePersonalPreferences();
  const [history, setHistory] = useState(readPassengerHistory);
  useEffect(() => {
    const update = () => setHistory(readPassengerHistory());
    window.addEventListener('passenger-history', update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener('passenger-history', update);
      window.removeEventListener('storage', update);
    };
  }, []);
  const items = [...history.favorites, ...history.recent.filter((recent) => !history.favorites.some((favorite) => savedTripIdentity(favorite) === savedTripIdentity(recent)))].slice(0, 5);
  if (!items.length) return null;
  const rtl = preferences.language !== 'en';
  const heading = preferences.language === 'he' ? 'מועדפים ונסיעות אחרונות' : preferences.language === 'yi' ? 'באליבטע און לעצטע רייזעס' : 'Favorites & recent trips';
  return (
    <section className="mb-4 rounded-[20px] border border-border bg-white p-4 text-[#0f172a] shadow-sm" dir={rtl ? 'rtl' : 'ltr'}>
      <h2 className="flex items-center gap-2 text-sm font-black"><Clock3 className="h-4 w-4" />{heading}</h2>
      <div className="mt-3 flex gap-2 overflow-x-auto">
        {items.map((trip) => (
          <button key={`${trip.runKey}-${trip.savedAt}`} type="button" onClick={() => onRestore(trip)} className="min-w-40 rounded-xl border border-[#e2e8f0] px-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-secondary">
            <span className="block truncate text-xs font-black">{trip.originName && trip.destinationName ? `${trip.originName} → ${trip.destinationName}` : `${trip.filters.date} · Line ${trip.filters.line}`}</span>
            <span className="mt-1 block text-xs font-bold text-[#64748b]">{trip.filters.date} · {trip.departureTime}</span>
            {(trip.pickupStop || trip.dropoffStop) && (
              <span className="mt-1 block max-w-48 truncate text-[10px] font-semibold text-[#64748b]">
                {trip.pickupStop?.label ?? 'Any pickup'} → {trip.dropoffStop?.label ?? 'Any drop-off'}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}