import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChargingAmenitiesView } from './ChargingAmenitiesView';
import { MonseyInfoView } from './MonseyInfoView';
import { SafetyBriefingView } from './SafetyBriefingView';
import { TrafficView } from './TrafficView';
import { WeatherView } from './WeatherView';
import { JewishCalendarView } from './JewishCalendarView';

let language: 'en' | 'yi' | 'he' = 'en';

vi.mock('@/providers/live-trip', () => ({
  useLiveTrip: () => ({ passengerLanguage: language }),
}));
vi.mock('@/lib/store', () => ({
  useSettingsStore: (selector: (state: { routeId: string }) => unknown) => selector({ routeId: 'route-1' }),
}));
vi.mock('@/providers/passenger-info', () => ({
  getPassengerInfo: () => Promise.resolve({
    reviewedAt: '2026-01-01T00:00:00.000Z',
    stale: false,
    content: Object.fromEntries(['en', 'yi', 'he'].map((lang) => [lang, {
      destinations: [{ title: 'Hudson Valley', text: lang === 'he' ? 'פרטי יעד מאושרים לצוות' : lang === 'yi' ? 'באשטעטיגטע דעסטינאציע דעטאלן' : 'Staff-authored destination details' }],
      fares: [{ title: 'Adult fare', text: 'Staff-authored fare details' }],
      guide: [{ title: 'Baggage', text: 'Staff-authored guide details' }],
      contact: [{ title: 'Dispatch', text: 'Staff-authored contact details' }],
    }])),
  }),
}));
vi.mock('@/providers/api-interfaces', () => ({
  useGPSData: () => ({
    route: { stops: [{ isDestination: true, name: 'New York', location: { lat: 40, lng: -73 } }] },
    position: { lat: 40, lng: -73 },
    locationStatus: 'idle',
  }),
  useWeatherData: () => ({
    icon: 'sun', state: 'live', status: 'live', tempF: 72, feelsLikeF: 71,
    condition: 'Operator weather condition', humidityPercent: 40, windMph: 8,
  }),
  useTrafficData: () => ({
    state: 'live', status: 'moderate', summary: 'Dynamic traffic summary', road: 'Route 59',
    delayMinutes: 12, travelTimeMinutes: 38,
    arrivalTime: new Date('2026-01-01T12:38:00Z'),
    updatedAt: new Date('2026-01-01T12:00:00Z'),
  }),
}));
vi.mock('@/providers/jewish-content', () => ({
  useZmanim: () => ({
    freshness: 'live', location: 'Monsey', times: {
      alotHaShachar: new Date('2026-01-01T05:00:00Z'), misheyakir: null, sunrise: null,
      sofZmanShmaMGA: null, sofZmanShma: null, sofZmanTfilla: null, chatzot: null,
      minchaGedola: null, plagHaMincha: null, sunset: null, tzeit7083deg: null,
    },
  }),
}));

afterEach(() => {
  cleanup();
  language = 'en';
});

describe('informational passenger language', () => {
  it.each(['yi', 'he'] as const)('localizes charging and safety chrome in %s with RTL direction', (selected) => {
    language = selected;
    const { container } = render(<><ChargingAmenitiesView /><SafetyBriefingView /></>);
    expect(container.querySelectorAll('[dir="rtl"]')).toHaveLength(2);
    expect(screen.getByText(selected === 'he' ? 'חשמל בהישג יד' : 'קראפט איז אין דער נאנט')).toBeTruthy();
    expect(screen.getByText(selected === 'he' ? 'הכירו את יציאות החירום' : 'קענט אייערע עמערדזשענסי ארויסגענג')).toBeTruthy();
  });

  it('keeps dynamic weather and traffic content unchanged while translating chrome', () => {
    language = 'he';
    const { container } = render(<><WeatherView /><TrafficView /></>);
    expect(container.querySelectorAll('[dir="rtl"]')).toHaveLength(2);
    expect(screen.getByTestId('text-weather-condition').textContent).toBe('Operator weather condition');
    expect(screen.getByTestId('text-traffic-summary').textContent).toBe('Dynamic traffic summary');
    expect(screen.getByTestId('text-traffic-arrival').textContent).not.toBe('—');
    expect(screen.getByText('Route 59')).toBeTruthy();
    expect(screen.getByText('תנאי הנסיעה')).toBeTruthy();
    expect(screen.getByText('מזג האוויר ביעד')).toBeTruthy();
    expect(screen.getByText('בינוני תנועה')).toBeTruthy();
    expect(screen.getAllByText('New York').every((element) => element.getAttribute('dir') === 'auto')).toBe(true);
  });

  it('uses Hebrew and Yiddish zmanim labels and localized page counters', () => {
    language = 'yi';
    const { rerender } = render(<JewishCalendarView />);
    expect(screen.getByText('זונ אויפגאנג')).toBeTruthy();
    expect(screen.getByText(/ פון 2/)).toBeTruthy();

    language = 'he';
    rerender(<JewishCalendarView />);
    expect(screen.getAllByText('הנץ החמה').length).toBeGreaterThan(0);
    expect(screen.getByText(/ מתוך 2/)).toBeTruthy();
    expect(screen.queryByText('Sunrise')).toBeNull();
  });

  it.each(['yi', 'he'] as const)('preserves fetched passenger cards in %s', async (selected) => {
    language = selected;
    const { container } = render(<MonseyInfoView section="destinations" />);
    expect(container.firstElementChild?.getAttribute('dir')).toBe('rtl');
    expect(await screen.findByText('Hudson Valley')).toBeTruthy();
    expect(screen.getByText(selected === 'he' ? 'פרטי יעד מאושרים לצוות' : 'באשטעטיגטע דעסטינאציע דעטאלן')).toBeTruthy();
    expect(screen.getByText(selected === 'he' ? 'יעדי מונסי טריילס' : 'מונסי טרעילס דעסטינאציעס')).toBeTruthy();
  });
});