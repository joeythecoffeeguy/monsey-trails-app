import { ArrowUp, CornerDownLeft, CornerUpLeft, CornerUpRight, GitMerge, MoveLeft, MoveRight, RotateCcw } from 'lucide-react';
import { DriverJourneyFocus } from './_DriverJourneyFocus';
import './_group.css';

type Maneuver = {
  type: string;
  modifier?: string;
  distanceMiles: number;
  instruction: string;
  exitNumber?: string;
  signpostText?: string;
  roadShields: Array<{ reference: string; shieldContent: string }>;
  laneGuidance?: {
    lanes: Array<{ directions: string[]; follow?: string }>;
    laneSeparators: string[];
  };
};

function ManeuverIcon({ type, modifier, className }: { type: string; modifier?: string; className?: string }) {
  if (type === 'roundabout') return <RotateCcw className={className} />;
  if (type === 'merge') return <GitMerge className={className} />;
  if (modifier === 'uturn') return <CornerDownLeft className={className} />;
  if (modifier?.includes('left')) return <CornerUpLeft className={className} />;
  if (modifier?.includes('right')) return <CornerUpRight className={className} />;
  return <ArrowUp className={className} />;
}

function formatDistance(miles: number) {
  if (miles < 0.1) return `${Math.round(miles * 5280)} ft`;
  return `${miles.toFixed(1)} mi`;
}

function LaneDirection({ direction }: { direction: string }) {
  const normalized = direction.toUpperCase();
  if (normalized.includes('LEFT')) return <MoveLeft aria-hidden="true" className="h-6 w-6" />;
  if (normalized.includes('RIGHT')) return <MoveRight aria-hidden="true" className="h-6 w-6" />;
  return <ArrowUp aria-hidden="true" className="h-6 w-6" />;
}

function LaneSeparator({ separator }: { separator: string | undefined }) {
  if (!separator) return null;
  const normalized = separator.toUpperCase();
  return (
    <span
      data-lane-separator={separator}
      aria-hidden="true"
      className={`h-9 ${normalized.includes('DOUBLE') ? 'border-l-4' : 'border-l-2'} ${
        normalized.includes('DASHED') ? 'border-dashed' : 'border-solid'
      } border-white/55`}
    />
  );
}

function VerifiedGuidance({ maneuver }: { maneuver: Maneuver }) {
  const hasSignData = !!(maneuver.exitNumber || maneuver.signpostText || maneuver.roadShields.length);
  if (!hasSignData && !maneuver.laneGuidance) return null;

  return (
    <div data-testid="verified-guidance" className="bg-emerald-950 px-4 py-3 text-white border-b border-white/15">
      {hasSignData && (
        <div className="flex items-center gap-2 text-lg font-black min-w-0">
          {maneuver.exitNumber && (
            <span className="shrink-0 rounded-md bg-amber-400 px-2 py-1 text-sm text-emerald-950 uppercase">
              Exit {maneuver.exitNumber}
            </span>
          )}
          {maneuver.roadShields.map((shield, index) => (
            <span key={`${shield.reference}-${shield.shieldContent}-${index}`} className="shrink-0 rounded-md border-2 border-white bg-white px-2 py-0.5 text-sm text-emerald-950">
              {shield.shieldContent}
            </span>
          ))}
          {maneuver.signpostText && <span className="truncate">{maneuver.signpostText}</span>}
        </div>
      )}
      {maneuver.laneGuidance && (
        <div aria-label="Verified lane guidance" className={`flex justify-center gap-1.5 ${hasSignData ? 'mt-3' : ''}`}>
          {maneuver.laneGuidance.lanes.map((lane, index) => (
            <div key={`${lane.directions.join('-')}-${index}`} className="flex items-center gap-1.5">
              <LaneSeparator separator={maneuver.laneGuidance?.laneSeparators[index]} />
              <div
                aria-label={`Lane ${index + 1}${lane.follow ? ', follow this lane' : ''}`}
                className={`flex h-10 min-w-10 items-center justify-center rounded-lg border px-2 ${
                  lane.follow ? 'border-amber-300 bg-amber-400 text-emerald-950' : 'border-white/35 bg-black/20 text-white/55'
                }`}
              >
                <LaneDirection direction={lane.follow ?? lane.directions[0] ?? 'STRAIGHT'} />
              </div>
            </div>
          ))}
          <LaneSeparator separator={maneuver.laneGuidance.laneSeparators[maneuver.laneGuidance.lanes.length]} />
        </div>
      )}
    </div>
  );
}

const maneuver: Maneuver = {
  type: 'turn',
  modifier: 'right',
  distanceMiles: 0.3,
  instruction: 'Turn right onto New York 59 West',
  exitNumber: '14B',
  signpostText: 'Spring Valley / Monsey',
  roadShields: [{ reference: 'NY-59', shieldContent: '59' }],
  laneGuidance: {
    lanes: [
      { directions: ['LEFT'] },
      { directions: ['STRAIGHT'] },
      { directions: ['RIGHT'], follow: 'RIGHT' },
    ],
    laneSeparators: ['SOLID', 'DASHED', 'DASHED', 'SOLID'],
  },
};

export function Driving() {
  return (
    <main className="operator-theme min-h-screen bg-[#e8f4ea] p-4 text-foreground sm:p-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <p className="text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">Sample route data</p>
        <div className="w-full overflow-hidden rounded-2xl border border-emerald-950/25 bg-[#087d68] text-white shadow-2xl sm:rounded-3xl">
          <VerifiedGuidance maneuver={maneuver} />
          <div className="flex min-h-24 items-center gap-3 px-4 py-3 sm:min-h-32 sm:gap-5 sm:px-6 sm:py-5">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center sm:h-20 sm:w-20">
              <ManeuverIcon type={maneuver.type} modifier={maneuver.modifier} className="h-12 w-12 drop-shadow-md sm:h-16 sm:w-16" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-3xl font-black leading-none tracking-tight drop-shadow-sm sm:text-5xl">
                {formatDistance(maneuver.distanceMiles)}
              </div>
              <div className="mt-1 line-clamp-2 text-lg font-bold leading-tight drop-shadow-sm sm:text-3xl">
                {maneuver.instruction}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 border-t border-white/15 bg-black/20 px-4 py-2.5 sm:px-6 sm:py-3">
            <ManeuverIcon type="turn" modifier="left" className="h-6 w-6 shrink-0 opacity-85 sm:h-8 sm:w-8" />
            <div className="truncate font-semibold sm:text-xl">Then turn left onto Main Street</div>
          </div>
        </div>
        <DriverJourneyFocus
          stopName="Maple Avenue & Route 306"
          stopKind="pickup"
          verifiedInstruction="Board on Maple Avenue, across from the pharmacy entrance."
          eta="2025-09-23T14:18:00-04:00"
          authoritativePickupTime="2025-09-23T14:20:00-04:00"
          dispatchMessage="Use the marked curb space; do not block the crosswalk."
          motionState="stopped"
          stoppedControlsConfirmed
          onSpeakInstruction={() => undefined}
        />
        <div className="flex flex-wrap justify-center gap-x-3 px-3 text-[11px] font-bold text-slate-700">
          <span>2.8 mi</span><span>9 min</span><span>Route current</span><span>GPS ±6m</span>
        </div>
      </div>
    </main>
  );
}
