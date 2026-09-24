import { Clock3, MapPin, MessageSquareText, ShieldCheck, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type DriverMotionState = 'moving' | 'stopped' | 'unknown';

export interface DriverJourneyFocusProps {
  stopName: string;
  stopKind?: 'pickup' | 'dropoff' | 'destination';
  verifiedInstruction?: string;
  eta?: string | null;
  authoritativePickupTime?: string | null;
  dispatchMessage?: string | null;
  motionState: DriverMotionState;
  stoppedControlsConfirmed: boolean;
  onConfirmStoppedControls?: () => void;
  onSpeakInstruction?: () => void;
  speakingInstruction?: boolean;
}

function timeLabel(value: string | null | undefined) {
  if (!value) return null;
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  }).format(time);
}

function kindLabel(kind: DriverJourneyFocusProps['stopKind']) {
  if (kind === 'pickup') return 'Next pickup';
  if (kind === 'dropoff') return 'Next drop-off';
  if (kind === 'destination') return 'Final destination';
  return 'Next stop';
}

export function DriverJourneyFocus({
  stopName,
  stopKind,
  verifiedInstruction,
  eta,
  authoritativePickupTime,
  dispatchMessage,
  motionState,
  stoppedControlsConfirmed,
  onConfirmStoppedControls,
  onSpeakInstruction,
  speakingInstruction = false,
}: DriverJourneyFocusProps) {
  const etaLabel = timeLabel(eta);
  const pickupTimeLabel = stopKind === 'pickup' ? timeLabel(authoritativePickupTime) : null;
  const canConfirmStopped = motionState !== 'moving' && !stoppedControlsConfirmed;

  return (
    <section
      aria-label="Next stop guidance"
      className="overflow-hidden rounded-[24px] border border-slate-950/20 bg-[#071f2b] text-white shadow-2xl"
    >
      <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-[#0d3442] px-5 py-3">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200">{kindLabel(stopKind)}</p>
        {etaLabel && (
          <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm font-black">
            <Clock3 className="h-4 w-4 text-cyan-200" aria-hidden="true" />
            ETA {etaLabel}
          </div>
        )}
      </div>

      <div className="px-5 py-4 sm:px-6 sm:py-5">
        <div className="flex items-start gap-4">
          <div className="mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cyan-300 text-[#071f2b]">
            <MapPin className="h-7 w-7" aria-hidden="true" />
          </div>
          <h2 className="min-w-0 text-2xl font-black leading-tight tracking-tight sm:text-4xl">{stopName}</h2>
        </div>

        {verifiedInstruction && (
          <div className="mt-4 rounded-2xl border border-amber-200/30 bg-amber-300/10 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-200">Verified stop instruction</p>
                <p className="mt-1 text-base font-bold leading-snug sm:text-xl">{verifiedInstruction}</p>
              </div>
              {onSpeakInstruction && (
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className={cn('h-12 w-12 shrink-0 rounded-full', speakingInstruction && 'ring-2 ring-cyan-300')}
                  onClick={onSpeakInstruction}
                  aria-label={speakingInstruction ? 'Stop speaking stop instruction' : 'Speak stop instruction'}
                >
                  <Volume2 className="h-5 w-5" />
                </Button>
              )}
            </div>
          </div>
        )}

        {pickupTimeLabel && (
          <div className="mt-3 flex items-center gap-2 text-sm font-bold text-cyan-100">
            <Clock3 className="h-4 w-4" aria-hidden="true" />
            Published pickup time {pickupTimeLabel}
          </div>
        )}

        {dispatchMessage && (
          <div className="mt-3 flex items-start gap-3 rounded-xl bg-white/8 px-4 py-3 text-sm font-semibold text-slate-100">
            <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" aria-hidden="true" />
            <div>
              <span className="font-black text-cyan-100">Dispatch: </span>
              {dispatchMessage}
            </div>
          </div>
        )}

        {canConfirmStopped && onConfirmStoppedControls && (
          <Button
            type="button"
            variant="secondary"
            className="mt-4 h-12 w-full rounded-xl font-black"
            onClick={onConfirmStoppedControls}
          >
            <ShieldCheck className="mr-2 h-5 w-5" />
            I am safely stopped — show controls
          </Button>
        )}

        {motionState === 'unknown' && !stoppedControlsConfirmed && (
          <p className="mt-3 text-xs font-bold text-slate-300">
            Motion status is unavailable. Confirm only after the coach is safely stopped.
          </p>
        )}
      </div>
    </section>
  );
}
