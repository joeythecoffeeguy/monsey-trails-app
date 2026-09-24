import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import { Header } from '@/components/passenger/Header';
import { Footer } from '@/components/passenger/Footer';
import { WelcomeView } from '@/components/passenger/views/WelcomeView';
import { MapProgressView } from '@/components/passenger/views/MapProgressView';
import { NextStopView } from '@/components/passenger/views/NextStopView';
import { WeatherView } from '@/components/passenger/views/WeatherView';
import { TrafficView } from '@/components/passenger/views/TrafficView';
import { DailyDafView } from '@/components/passenger/views/DailyDafView';
import { JewishCalendarView } from '@/components/passenger/views/JewishCalendarView';
import { AnnouncementsView } from '@/components/passenger/views/AnnouncementsView';
import { SafetyBriefingView } from '@/components/passenger/views/SafetyBriefingView';
import { ChargingAmenitiesView } from '@/components/passenger/views/ChargingAmenitiesView';
import { useSettingsStore, type DisplayMode } from '@/lib/store';
import { setLiveTripFixture } from '@/providers/live-trip';
import { createPassengerDemoTrip } from './passenger-demo';

const VIEWS: Partial<Record<DisplayMode, ComponentType>> = {
  welcome: WelcomeView,
  map: MapProgressView,
  'next-stop': NextStopView,
  weather: WeatherView,
  traffic: TrafficView,
  daf: DailyDafView,
  'jewish-calendar': JewishCalendarView,
  announcements: AnnouncementsView,
  'charging-amenities': ChargingAmenitiesView,
  safety: SafetyBriefingView,
};

const LONG_DESTINATION =
  '785 Extremely Long Passenger Terminal Boulevard & West One Hundred Eighty-Seventh Street, New York, NY';

function installLongFixtures(mode: DisplayMode) {
  const now = new Date();
  const eta = new Date(now.getTime() + 75 * 60_000).toISOString();
  const trip = {
    ...createPassengerDemoTrip(mode, now),
    status: 'running' as const,
    destinationAddress: LONG_DESTINATION,
    destination: { lat: 40.7549, lng: -73.984 },
    intermediateStops: [
      {
        id: 'long-stop',
        address: 'West One Hundred Eighty-Seventh Street & Extremely Long Passenger Transfer Avenue',
        lat: 40.9,
        lng: -74.02,
        eta,
      },
    ],
    routeGeometry: [
      { lat: 41.1112, lng: -74.0685 },
      { lat: 40.9, lng: -74.02 },
      { lat: 40.7549, lng: -73.984 },
    ],
    currentLocation: { lat: 40.98, lng: -74.04 },
    remainingDistanceMiles: 27,
    speedMph: 8,
    startedAt: now.toISOString(),
    locationVisibility: 'live' as const,
  };

  useSettingsStore.setState({
    brandName: 'Monsey Trails Regional Passenger Transportation Services',
    announcements: [{
      id: 'long-announcement',
      title: 'Important Passenger Service Update for All Connecting Routes',
      message: 'Due to unusually heavy traffic near the passenger terminal, please remain seated until the coach has stopped completely and listen carefully for connecting-route instructions from your operator.',
      active: true,
    }],
  });
  localStorage.setItem('coach-daily-daf-v1', JSON.stringify({
    refEnglish: 'Bava Metzia 123 — Extended Daily Learning Reference',
    refHebrew: 'בבא מציעא קכ״ג — לימוד הדף היומי המורחב',
  }));
  localStorage.setItem('coach-jewish-calendar-v1', JSON.stringify({
    hebrewDate: 'יום רביעי, כ״ד באלול תשפ״ו',
    parsha: 'פרשת ניצבים וילך',
    holiday: 'ערב ראש השנה — סליחות ותפילה מיוחדת',
    candleLighting: eta,
    havdalah: eta,
  }));
  localStorage.setItem('coach-zmanim-v1', JSON.stringify({
    location: 'Monsey and Greater Rockland County, New York',
    times: Object.fromEntries(['chatzotNight','alotHaShachar','misheyakir','dawn','sunrise','sofZmanShma','sofZmanTfilla','chatzot','minchaGedola','minchaKetana','plagHaMincha','sunset','beinHaShmashos','dusk','tzeit7083deg'].map((key) => [key, eta])),
  }));
  setLiveTripFixture('9923', trip);
}

function reportLayout() {
  const stage = document.querySelector<HTMLElement>('[data-layout-stage]');
  if (!stage) return;
  const bounds = stage.getBoundingClientRect();
  const candidates = Array.from(stage.querySelectorAll<HTMLElement>(
    'header, main, footer, nav, h1, h2, h3, [class*="rounded"]',
  )).filter((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  });
  const clipped = candidates.flatMap((element) => {
    const rect = element.getBoundingClientRect();
    const intersectsStage = rect.right > bounds.left && rect.left < bounds.right
      && rect.bottom > bounds.top && rect.top < bounds.bottom;
    const outside = intersectsStage && (rect.left < bounds.left - 1 || rect.top < bounds.top - 1
      || rect.right > bounds.right + 1 || rect.bottom > bounds.bottom + 1);
    return outside
      ? [{
        element: `${element.tagName.toLowerCase()}${element.getAttribute('aria-label') ? `[${element.getAttribute('aria-label')}]` : ''}`,
        className: element.className,
        rect: {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
        },
      }]
      : [];
  });
  const output = document.querySelector('[data-layout-result]');
  if (output) output.textContent = JSON.stringify({ clipped, checked: candidates.length });
}

export default function PassengerLayoutFixture({ mode }: { mode: DisplayMode }) {
  const [ready, setReady] = useState(false);
  const scale = Math.min(window.innerWidth / 1366, window.innerHeight / 768);
  useEffect(() => {
    installLongFixtures(mode);
    setReady(true);
  }, [mode]);
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(reportLayout, 350);
    return () => window.clearTimeout(timer);
  }, [ready]);

  if (!ready) return null;
  const View = VIEWS[mode] ?? WelcomeView;
  const isDriving = ['map', 'next-stop', 'traffic', 'weather'].includes(mode);
  return (
    <>
      <div className="passenger-viewport">
        <div
          data-layout-stage
          className="passenger-stage"
          style={{ width: 1366 * scale, height: 768 * scale }}
        >
          <div
            className="passenger-screen dark flex flex-col bg-background text-foreground overflow-hidden select-none"
            style={{ transform: `scale(${scale})` }}
          >
            <Header activeMode={mode} isDriving={isDriving} />
            <main className="flex-1 min-h-0 relative overflow-hidden flex flex-col">
              <View />
            </main>
            {mode !== 'next-stop' && <Footer />}
          </div>
        </div>
      </div>
      <pre data-layout-result className="fixed left-0 top-0 z-[100] bg-black text-white">pending</pre>
    </>
  );
}