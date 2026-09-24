import type { JourneyProgressItem } from '@/providers/live-trip';

export function distanceMiles(
  from: { lat: number; lng: number } | null | undefined,
  to: { lat: number; lng: number },
) {
  if (!from || !Number.isFinite(from.lat) || !Number.isFinite(from.lng) || !Number.isFinite(to.lat) || !Number.isFinite(to.lng)) {
    return null;
  }
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latDelta = radians(to.lat - from.lat);
  const lngDelta = radians(to.lng - from.lng);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(lngDelta / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function progressBadgeDetails(
  progress: JourneyProgressItem | undefined,
  currentLocation: { lat: number; lng: number } | null | undefined,
  now = Date.now(),
) {
  if (!progress) return null;
  const pickup = progress.kind === 'pickup';
  if (progress.status === 'completed') {
    return {
      label: pickup ? 'Departed' : 'Arrived',
      tone: pickup ? 'green' as const : 'orange' as const,
      pulse: false,
    };
  }
  const milesAway = distanceMiles(currentLocation, progress);
  if (progress.status !== 'current' || milesAway === null || milesAway > 2) return null;
  const etaMinutes = progress.eta
    ? Math.max(1, Math.ceil((new Date(progress.eta).getTime() - now) / 60_000))
    : null;
  return {
    label: etaMinutes === null ? 'Arriving soon' : `Arriving in ${etaMinutes} min`,
    tone: pickup ? 'green' as const : 'orange' as const,
    pulse: true,
  };
}

export function StopProgressBadge({
  progress,
  currentLocation,
}: {
  progress: JourneyProgressItem | undefined;
  currentLocation?: { lat: number; lng: number } | null;
}) {
  const details = progressBadgeDetails(progress, currentLocation);
  if (!details) return null;
  const colors = details.tone === 'green'
    ? 'bg-emerald-100 text-emerald-700'
    : 'bg-orange-100 text-orange-700';
  return (
    <span className={`ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${colors}`}>
      {details.pulse && <SignalPulse />}
      {details.label}
    </span>
  );
}

function SignalPulse() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 14" className="h-3.5 w-4 overflow-visible">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8">
        <path d="M2 3.5a10 10 0 0 1 14 0" className="animate-[pulse_1.5s_ease-in-out_infinite] motion-reduce:animate-none" />
        <path d="M5 7a5.8 5.8 0 0 1 8 0" className="animate-[pulse_1.5s_ease-in-out_.2s_infinite] motion-reduce:animate-none" />
        <path d="M8 10.5a1.8 1.8 0 0 1 2 0" className="animate-[pulse_1.5s_ease-in-out_.4s_infinite] motion-reduce:animate-none" />
      </g>
    </svg>
  );
}