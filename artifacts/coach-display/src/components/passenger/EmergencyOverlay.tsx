import { useLiveTrip } from '@/providers/live-trip';
import { AlertTriangle } from 'lucide-react';

export function EmergencyOverlay() {
  const { emergencyOverride, emergencyMessage } = useLiveTrip();

  if (!emergencyOverride) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-destructive/95 backdrop-blur-md p-12">
      <div className="max-w-4xl max-h-[90%] w-full overflow-y-auto text-center space-y-8 animate-in fade-in zoom-in duration-500">
        <AlertTriangle className="w-32 h-32 text-destructive-foreground mx-auto animate-pulse" />
        <h2 className="text-6xl font-bold text-destructive-foreground tracking-tight leading-tight">
          ATTENTION PASSENGERS
        </h2>
        <p className="text-4xl text-destructive-foreground/90 leading-snug font-medium break-words">
          {emergencyMessage}
        </p>
      </div>
    </div>
  );
}
