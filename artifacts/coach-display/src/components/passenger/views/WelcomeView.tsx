import { useSettingsStore } from '@/lib/store';
import { useGPSData } from '@/providers/api-interfaces';
import { useLiveTrip } from '@/providers/live-trip';
import { BusFront, MapPin, ShieldCheck } from 'lucide-react';

export function WelcomeView() {
  const { brandName, routeId } = useSettingsStore();
  const { route } = useGPSData(routeId);
  const liveTrip = useLiveTrip();
  const hasDestination = liveTrip.destinationAddress.trim().length > 0;

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-10 animate-in fade-in duration-700">
      <div className="max-w-5xl w-full min-w-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-10 items-center">
        
        <div className="min-w-0 space-y-8">
          <div className="space-y-2">
            <h2 className="text-6xl font-bold tracking-tight text-foreground leading-tight">
              Welcome aboard <br/>
              <span className="text-primary break-words">{brandName}</span>
            </h2>
            <p className="text-2xl text-muted-foreground mt-4 leading-relaxed">
               Reliable transportation connecting our communities across New York.
            </p>
          </div>
        </div>

        <div className="bg-secondary/50 border border-border/50 rounded-3xl p-10 flex flex-col items-center text-center space-y-8 relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary to-transparent opacity-50" />

          <div className="h-28 flex items-center justify-center">
            <img
              src={`${import.meta.env.BASE_URL}monsey-trails-logo.png`}
              alt="Monsey Trails"
              className="w-full max-w-sm h-auto object-contain brightness-0 invert"
            />
          </div>

          <div className="space-y-5 w-full">
            <h3 className="text-3xl font-semibold flex items-center justify-center gap-3">
              <BusFront className="w-8 h-8 text-primary" />
              Today&apos;s journey
            </h3>
            <div className="space-y-4 bg-background/70 rounded-xl p-5 text-left">
              {hasDestination && (
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 mt-1 text-primary shrink-0" />
                   <div className="min-w-0">
                    <span className="block text-sm uppercase tracking-widest text-muted-foreground font-bold">Traveling to</span>
                     <span className="text-xl font-bold break-words line-clamp-2">{route.destination}</span>
                  </div>
                </div>
              )}
              <div className={`flex items-start gap-3 ${hasDestination ? 'border-t border-border/50 pt-4' : ''}`}>
                <ShieldCheck className="w-5 h-5 mt-1 text-primary shrink-0" />
                 <div className="min-w-0">
                  <span className="block text-sm uppercase tracking-widest text-muted-foreground font-bold">For your safety</span>
                  <span className="text-lg font-semibold">Please remain seated while the coach is moving.</span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
