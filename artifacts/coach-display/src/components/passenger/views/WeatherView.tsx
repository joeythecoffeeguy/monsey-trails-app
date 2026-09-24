import { useSettingsStore } from '@/lib/store';
import { useGPSData, useWeatherData } from '@/providers/api-interfaces';
import { Cloud, CloudRain, CloudSnow, CloudLightning, Sun, Thermometer, Droplets, Wind, WifiOff } from 'lucide-react';
import { useLiveTrip } from '@/providers/live-trip';
import { getTranslation, isRTL } from '@/lib/translations';

const WEATHER_ICONS = {
  sun: Sun,
  cloud: Cloud,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning
};

export function WeatherView() {
  const routeId = useSettingsStore((s) => s.routeId);
  const language = useLiveTrip().passengerLanguage;
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(language, key);
  const { route, position, locationStatus } = useGPSData(routeId);
  const destination = route.stops.find((stop) => stop.isDestination) ?? route.stops[route.stops.length - 1];
  const weather = useWeatherData(locationStatus === 'live' ? position : destination.location);
  
  const Icon = WEATHER_ICONS[weather.icon] || Cloud;

  return (
    <div dir={isRTL(language) ? 'rtl' : 'ltr'} className="flex-1 min-h-0 flex flex-col p-10 animate-in fade-in duration-700">
      <div className="flex min-w-0 items-center gap-4 mb-8">
        <Thermometer className="w-10 h-10 text-primary" />
        <h2 className="text-4xl font-bold tracking-tight">{locationStatus === 'live' ? t('weatherAlongRoute') : t('destinationWeather')}</h2>
        <span className={`ms-auto rounded-full px-4 py-2 text-sm font-bold uppercase tracking-wider ${
          weather.status === 'live' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-primary/15 text-primary'
        }`} data-testid="status-weather-freshness">
          {weather.state === 'offline' && <WifiOff className="me-2 inline h-4 w-4" />}
          {weather.state === 'offline' ? t('offlineWeather') : weather.state === 'stale' ? t('weatherDelayed') : locationStatus === 'live' ? t('liveCoachLocation') : <><span>{t('liveAt')} </span><bdi dir="auto">{destination.name}</bdi></>}
        </span>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div className="bg-secondary/40 border border-border/50 rounded-[3rem] p-10 flex min-w-0 items-center gap-12 w-full max-w-5xl shadow-2xl relative overflow-hidden">
          
          {/* Decorative background glow based on weather */}
          <div className="absolute top-1/2 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/10 rounded-full blur-[100px] pointer-events-none" />

          <div className="shrink-0 relative">
            <Icon className="w-52 h-52 text-primary relative z-10 drop-shadow-lg" strokeWidth={1} />
          </div>

          <div className="flex min-w-0 flex-col gap-4 relative z-10">
            <h3 className="text-3xl font-medium text-muted-foreground break-words line-clamp-2">
              {locationStatus === 'live' ? t('currentCoachLocation') : <bdi dir="auto">{destination.name}</bdi>}
            </h3>
            <div className="flex items-start gap-4">
              <span className="text-8xl font-bold leading-none tracking-tighter tabular-nums drop-shadow-md">
                <span data-testid="text-weather-temperature">{weather.status === 'loading' ? '—' : weather.tempF}°F</span>
              </span>
            </div>
            <p className="text-4xl font-medium text-foreground tracking-tight">
               <bdi dir="auto"><span data-testid="text-weather-condition">{weather.condition}</span></bdi>
            </p>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-xl text-muted-foreground">
              <span className="flex items-center gap-2">
                <Thermometer className="w-5 h-5 text-primary" />
                {t('feelsLike')} {weather.feelsLikeF}°F
              </span>
              <span className="flex items-center gap-2">
                <Droplets className="w-5 h-5 text-primary" />
                {weather.humidityPercent}%
              </span>
              <span className="flex items-center gap-2">
                <Wind className="w-5 h-5 text-primary" />
                 {weather.windMph} {t('mph')}
              </span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
