import { useEffect, useState } from 'react';

type Freshness = 'loading' | 'live' | 'stale' | 'offline';

export interface DailyDafData {
  refEnglish: string;
  refHebrew: string;
  freshness: Freshness;
}

export interface JewishCalendarData {
  hebrewDate: string;
  parsha: string;
  holiday: string;
  candleLighting: Date | null;
  havdalah: Date | null;
  freshness: Freshness;
}

export interface ZmanimData {
  location: string;
  times: Record<string, Date>;
  freshness: Freshness;
}

const DAF_CACHE_KEY = 'coach-daily-daf-v1';
const CALENDAR_CACHE_KEY = 'coach-jewish-calendar-v1';
const ZMANIM_CACHE_KEY = 'coach-zmanim-v1';
const SIX_HOURS = 6 * 60 * 60_000;
const ONE_HOUR = 60 * 60_000;

function readCache<T>(key: string): T | null {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : null;
  } catch {
    return null;
  }
}

export function useDailyDaf(): DailyDafData {
  const [data, setData] = useState<DailyDafData>(() => {
    const cached = readCache<Omit<DailyDafData, 'freshness'>>(DAF_CACHE_KEY);
    return cached
      ? { ...cached, freshness: navigator.onLine ? 'stale' : 'offline' }
      : { refEnglish: 'Daily Daf', refHebrew: 'דף היומי', freshness: 'loading' };
  });

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch('https://www.sefaria.org/api/calendars', {
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(`Sefaria returned ${response.status}`);
        const body = await response.json() as {
          calendar_items: Array<{
            title: { en: string; he: string };
            displayValue: { en: string; he: string };
          }>;
        };
        const daf = body.calendar_items.find((item) => item.title.en === 'Daf Yomi');
        if (!daf) throw new Error('Daf Yomi entry was not returned');
        const next = {
          refEnglish: daf.displayValue.en,
          refHebrew: daf.displayValue.he,
          freshness: 'live' as const,
        };
        localStorage.setItem(DAF_CACHE_KEY, JSON.stringify({
          refEnglish: next.refEnglish,
          refHebrew: next.refHebrew,
        }));
        if (active) setData(next);
      } catch {
        if (active) setData((current) => ({
          ...current,
          freshness: navigator.onLine ? 'stale' : 'offline',
        }));
      }
    };

    void refresh();
    const timer = window.setInterval(refresh, SIX_HOURS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return data;
}

function localIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function occursOnDate(eventDate: string, date = localIsoDate()) {
  return eventDate.slice(0, 10) === date;
}

export function useJewishCalendar(): JewishCalendarData {
  const [data, setData] = useState<JewishCalendarData>(() => {
    const cached = readCache<{
      hebrewDate: string;
      parsha: string;
      holiday: string;
      candleLighting: string | null;
      havdalah: string | null;
    }>(CALENDAR_CACHE_KEY);
    return cached
      ? {
          ...cached,
          candleLighting: cached.candleLighting ? new Date(cached.candleLighting) : null,
          havdalah: cached.havdalah ? new Date(cached.havdalah) : null,
          freshness: navigator.onLine ? 'stale' : 'offline',
        }
      : {
          hebrewDate: 'התאריך העברי',
          parsha: '',
          holiday: '',
          candleLighting: null,
          havdalah: null,
          freshness: 'loading',
        };
  });

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [dateResponse, shabbatResponse] = await Promise.all([
          fetch(`https://www.hebcal.com/converter?cfg=json&g2h=1&strict=1&date=${localIsoDate()}`, {
            signal: AbortSignal.timeout(10_000),
          }),
          fetch('https://www.hebcal.com/shabbat?cfg=json&zip=10952&M=on&leyning=off&lg=h', {
            signal: AbortSignal.timeout(10_000),
          }),
        ]);
        if (!dateResponse.ok || !shabbatResponse.ok) throw new Error('Hebcal request failed');

        const dateBody = await dateResponse.json() as { hebrew: string };
        const shabbatBody = await shabbatResponse.json() as {
          items: Array<{
            category: string;
            subcat?: string;
            hebrew?: string;
            title: string;
            date: string;
          }>;
        };
        const today = localIsoDate();
        const parsha = shabbatBody.items.find((item) =>
          item.category === 'parashat' && occursOnDate(item.date, today),
        );
        const holiday = Array.from(new Set(
          shabbatBody.items
            .filter((item) =>
              (item.category === 'holiday' || item.category === 'fast')
              && item.subcat !== 'shabbat'
              && occursOnDate(item.date, today),
            )
            .map((item) => item.hebrew ?? item.title),
        )).join(' · ');
        const candles = shabbatBody.items.find((item) =>
          item.category === 'candles' && occursOnDate(item.date, today),
        );
        const havdalah = shabbatBody.items.find((item) =>
          item.category === 'havdalah' && occursOnDate(item.date, today),
        );
        const next = {
          hebrewDate: dateBody.hebrew,
          parsha: parsha?.hebrew ?? parsha?.title ?? '',
          holiday,
          candleLighting: candles ? new Date(candles.date) : null,
          havdalah: havdalah ? new Date(havdalah.date) : null,
          freshness: 'live' as const,
        };
        localStorage.setItem(CALENDAR_CACHE_KEY, JSON.stringify(next));
        if (active) setData(next);
      } catch {
        if (active) setData((current) => ({
          ...current,
          freshness: navigator.onLine ? 'stale' : 'offline',
        }));
      }
    };

    void refresh();
    const timer = window.setInterval(refresh, SIX_HOURS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return data;
}

export function useZmanim(): ZmanimData {
  const [data, setData] = useState<ZmanimData>(() => {
    const cached = readCache<{
      location: string;
      times: Record<string, string>;
    }>(ZMANIM_CACHE_KEY);
    return cached
      ? {
          location: cached.location,
          times: Object.fromEntries(
            Object.entries(cached.times).map(([key, value]) => [key, new Date(value)]),
          ),
          freshness: navigator.onLine ? 'stale' : 'offline',
        }
      : { location: 'Monsey, New York', times: {}, freshness: 'loading' };
  });

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(
          `https://www.hebcal.com/zmanim?cfg=json&zip=10952&date=${localIsoDate()}`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (!response.ok) throw new Error(`Hebcal Zmanim returned ${response.status}`);
        const body = await response.json() as {
          location: { title: string };
          times: Record<string, string>;
        };
        const next = {
          location: body.location.title,
          times: Object.fromEntries(
            Object.entries(body.times).map(([key, value]) => [key, new Date(value)]),
          ),
          freshness: 'live' as const,
        };
        localStorage.setItem(ZMANIM_CACHE_KEY, JSON.stringify({
          location: body.location.title,
          times: body.times,
        }));
        if (active) setData(next);
      } catch {
        if (active) setData((current) => ({
          ...current,
          freshness: navigator.onLine ? 'stale' : 'offline',
        }));
      }
    };

    void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const refreshWhenOnline = () => void refresh();
    const timer = window.setInterval(refresh, ONE_HOUR);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('online', refreshWhenOnline);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('online', refreshWhenOnline);
    };
  }, []);

  return data;
}