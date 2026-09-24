import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Volume2, VolumeX, Navigation2, Map as MapIcon, AlertTriangle, RotateCcw, GitMerge, CornerDownLeft, CornerUpLeft, CornerUpRight, ArrowUp, MoveLeft, MoveRight, ShieldAlert } from 'lucide-react';
import { useLiveTrip, getTripNavigation, selectTripNavigationRoute, type NavigationManeuver, type TripNavigation } from '@/providers/live-trip';
import { OperatorMap } from './OperatorMap';
import { DriverJourneyFocus } from './DriverJourneyFocus';
import { getDriverMotionState } from './driver-motion';
import { getPassengerJourney, type PassengerJourney, type PassengerJourneyRequest } from '@workspace/api-client-react';

export function ManeuverIcon({ type, modifier, className }: { type: string; modifier?: string; className?: string }) {
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

/** Local planar projection is accurate enough for the short road segments used
 * by rerouting and avoids a provider call for GPS jitter. */
export function distanceToRouteMeters(point: { lat: number; lng: number }, route: { lat: number; lng: number }[]) {
  if (route.length < 2) return Infinity;
  const scale = 111_320;
  const cosLat = Math.cos(point.lat * Math.PI / 180);
  const px = point.lng * scale * cosLat;
  const py = point.lat * scale;
  let nearest = Infinity;
  for (let i = 1; i < route.length; i += 1) {
    const ax = route[i - 1].lng * scale * cosLat;
    const ay = route[i - 1].lat * scale;
    const bx = route[i].lng * scale * cosLat;
    const by = route[i].lat * scale;
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    nearest = Math.min(nearest, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return nearest;
}

export function passengerJourneyRequestFromRunKey(runKey: string | null | undefined): PassengerJourneyRequest | null {
  if (!runKey) return null;
  const [date, lineValue, originValue, destinationValue, runId, extra] = runKey.split('|');
  const line = Number(lineValue);
  const origin = Number(originValue);
  const destination = Number(destinationValue);
  if (
    extra !== undefined
    || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || ![1, 2, 3].includes(line)
    || !Number.isInteger(origin) || origin < 1
    || !Number.isInteger(destination) || destination < 1
    || !runId
  ) return null;
  return { date, line: line as 1 | 2 | 3, origin, destination, runId };
}

export function verifiedJourneyStopForTripStop(
  journey: PassengerJourney | null,
  stop: { id: string; lat: number; lng: number } | null | undefined,
) {
  if (!journey || !stop) return undefined;
  return journey.stops.find(candidate => (
    candidate.id === stop.id
    && Math.abs(candidate.lat - stop.lat) < 0.000001
    && Math.abs(candidate.lng - stop.lng) < 0.000001
  ));
}

function routeDifferenceLabel(seconds: number) {
  const minutes = Math.max(1, Math.round(Math.abs(seconds) / 60));
  if (seconds < 0) return `${minutes} min faster`;
  if (seconds > 0) return `${minutes} min slower`;
  return 'Same time';
}

function promotePreviewRoute(navigation: TripNavigation, routeId: string): TripNavigation {
  const selected = navigation.alternatives.find(route => route.id === routeId);
  if (!selected) return navigation;
  const { id: _id, timeDifferenceSeconds: _difference, ...selectedRoute } = selected;
  const { alternatives: _alternatives, currentRouteId, ...currentRoute } = navigation;
  return {
    ...selectedRoute,
    currentRouteId: routeId,
    alternatives: [
      {
        ...currentRoute,
        id: currentRouteId,
        timeDifferenceSeconds: currentRoute.travelTimeSeconds - selectedRoute.travelTimeSeconds,
      },
      ...navigation.alternatives.filter(route => route.id !== routeId).map(route => ({
        ...route,
        timeDifferenceSeconds: route.travelTimeSeconds - selectedRoute.travelTimeSeconds,
      })),
    ],
  };
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

function VerifiedGuidance({ maneuver }: { maneuver: NavigationManeuver }) {
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

export function NavigationCockpit({
  onExit,
  onEmergencyAccess,
  previewNavigation,
  gpsAccuracy,
  dispatchMessage,
}: {
  onExit: () => void;
  onEmergencyAccess?: () => void;
  previewNavigation?: TripNavigation;
  gpsAccuracy?: number | null;
  dispatchMessage?: string | null;
}) {
   const liveTrip = useLiveTrip();
   const [navData, setNavData] = useState<TripNavigation | null>(previewNavigation ?? null);
   const [isMuted, setIsMuted] = useState(false);
   const [overviewMode, setOverviewMode] = useState(false);
   const [navigationUnavailable, setNavigationUnavailable] = useState(false);
    const [rerouting, setRerouting] = useState(false);
    const [navigationError, setNavigationError] = useState('');
     const [consecutiveFailures, setConsecutiveFailures] = useState(0);
     const [motionClock, setMotionClock] = useState(() => Date.now());
     const [stoppedControlsConfirmed, setStoppedControlsConfirmed] = useState(false);
     const [speakingStopInstruction, setSpeakingStopInstruction] = useState(false);
     const [officialJourney, setOfficialJourney] = useState<PassengerJourney | null>(null);
   const lastVoiceId = useRef<string | null>(null);
    const offRouteObservations = useRef(0);
    const lastRerouteAt = useRef(0);
    const fetchNavRef = useRef<(() => void) | null>(null);
    const guidanceExpired = consecutiveFailures >= 3;
     const actionableNavigation = guidanceExpired ? null : navData;
     const motionState = getDriverMotionState({
       speedMph: liveTrip.speedMph,
       locationUpdatedAt: liveTrip.locationUpdatedAt,
       now: motionClock,
     });
     const stoppedControlsVisible = motionState !== 'moving' && stoppedControlsConfirmed;

     useEffect(() => {
       const timer = window.setInterval(() => setMotionClock(Date.now()), 5_000);
       return () => window.clearInterval(timer);
     }, []);

     useEffect(() => {
       if (motionState === 'moving') setStoppedControlsConfirmed(false);
     }, [motionState]);

     useEffect(() => {
       const request = passengerJourneyRequestFromRunKey(liveTrip.officialRunKey);
       if (!request) {
         setOfficialJourney(null);
         return;
       }
       const controller = new AbortController();
       void getPassengerJourney(request, { signal: controller.signal })
         .then(setOfficialJourney)
         .catch((error) => {
           if (!(error instanceof DOMException && error.name === 'AbortError')) setOfficialJourney(null);
         });
       return () => controller.abort();
     }, [liveTrip.officialRunKey]);

   useEffect(() => {
      if (previewNavigation) return;
      let timeoutId: number;
      const controller = new AbortController();
      const fetchNav = async () => {
          setRerouting(true);
         try {
            const data = await getTripNavigation(controller.signal);
            setNavData(data);
            setNavigationUnavailable(false);
             setNavigationError('');
             setConsecutiveFailures(0);
          } catch (error) {
            setNavigationUnavailable(true);
             setNavigationError(error instanceof Error ? error.message : 'Live guidance is unavailable.');
             setConsecutiveFailures((failures) => failures + 1);
         } finally {
             setRerouting(false);
            if (!controller.signal.aborted) {
                // GPS and the server route cache are intentionally ~5s paced.
                // A slower cadence avoids repeatedly asking TomTom while the
                // coach is stationary; focus/reconnect still refresh immediately.
                timeoutId = window.setTimeout(fetchNav, 5000);
            }
         }
      };
       fetchNavRef.current = () => void fetchNav();
      fetchNav();
      return () => {
         controller.abort();
         clearTimeout(timeoutId);
      };
    }, [previewNavigation]);

   useEffect(() => {
     const route = navData?.routeGeometry;
     const location = liveTrip.currentLocation;
     if (!route?.length || !location) return;
     const tolerance = Math.max(120, (gpsAccuracy ?? 0) + 35);
     if (distanceToRouteMeters(location, route) > tolerance) offRouteObservations.current += 1;
     else offRouteObservations.current = 0;
     if (offRouteObservations.current >= 2 && Date.now() - lastRerouteAt.current > 20_000) {
       offRouteObservations.current = 0;
       lastRerouteAt.current = Date.now();
       setRerouting(true);
       fetchNavRef.current?.();
     }
   }, [liveTrip.currentLocation, navData?.routeGeometry, gpsAccuracy]);

   useEffect(() => {
       if (guidanceExpired || isMuted || speakingStopInstruction || !navData?.voicePrompt || !navData.voicePromptId) return;
       const stage = navData.currentManeuver && navData.currentManeuver.distanceMiles < 0.1 ? 'now' : 'prepare';
       const spokenId = `${navData.voicePromptId}:${stage}`;
       if (lastVoiceId.current === spokenId) return;
       lastVoiceId.current = spokenId;
      
       if ('speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined') {
          if (typeof window.speechSynthesis.cancel === 'function') window.speechSynthesis.cancel();
         const utterance = new SpeechSynthesisUtterance(navData.voicePrompt);
         window.speechSynthesis.speak(utterance);
      }
    }, [navData?.voicePrompt, navData?.voicePromptId, isMuted, guidanceExpired, speakingStopInstruction]);

    useEffect(() => {
      if ((isMuted || guidanceExpired) && typeof window.speechSynthesis?.cancel === 'function') window.speechSynthesis.cancel();
      return () => {
        if (typeof window.speechSynthesis?.cancel === 'function') window.speechSynthesis.cancel();
      };
    }, [isMuted, guidanceExpired]);

   useEffect(() => {
      if (liveTrip.status !== 'running') {
         onExit();
      }
   }, [liveTrip.status, onExit]);

    const hasCurrent = !!actionableNavigation?.currentManeuver;

     const arrivalTime = actionableNavigation?.arrivalTime ?? liveTrip.eta;
     const remainingDistance = actionableNavigation?.remainingDistanceMiles ?? liveTrip.remainingDistanceMiles;
     const nextStop = liveTrip.intermediateStops[0];
     const nextStopName = nextStop?.address || liveTrip.destinationAddress || 'Stop information unavailable';
     const officialStop = verifiedJourneyStopForTripStop(officialJourney, nextStop);
     const officialDestinationStop = !nextStop && liveTrip.destination
       ? officialJourney?.stops.find(candidate => (
         Math.abs(candidate.lat - liveTrip.destination!.lat) < 0.000001
         && Math.abs(candidate.lng - liveTrip.destination!.lng) < 0.000001
       ))
       : undefined;
     const nextStopKind = nextStop ? officialStop?.kind : 'destination';
     const verifiedStopInstruction = nextStop
       ? officialStop?.note
       : officialDestinationStop?.note;
     const authoritativePickupTime = officialStop?.kind === 'pickup' ? officialStop.scheduledAt : null;
     const speakStopInstruction = () => {
       if (!verifiedStopInstruction || isMuted || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
       if (speakingStopInstruction) {
         window.speechSynthesis.cancel();
         setSpeakingStopInstruction(false);
         return;
       }
       window.speechSynthesis.cancel();
       const utterance = new SpeechSynthesisUtterance(`Stop instruction. ${verifiedStopInstruction}`);
       utterance.onend = () => setSpeakingStopInstruction(false);
       utterance.onerror = () => setSpeakingStopInstruction(false);
       setSpeakingStopInstruction(true);
       window.speechSynthesis.speak(utterance);
     };
    const selectAlternative = async (routeId: string) => {
      if (!navData) return;
      try {
        const selected = previewNavigation
          ? promotePreviewRoute(navData, routeId)
          : await selectTripNavigationRoute(routeId);
        setNavData(selected);
        setNavigationUnavailable(false);
        setNavigationError('');
        setConsecutiveFailures(0);
        setOverviewMode(false);
      } catch (error) {
        setNavigationUnavailable(true);
        setNavigationError(error instanceof Error ? error.message : 'Could not change routes.');
      }
    };

    return (
      <div className="fixed inset-0 z-50 overflow-hidden bg-[#e8f4ea] text-foreground">
        <OperatorMap
          coach={liveTrip.currentLocation}
          route={actionableNavigation?.routeGeometry?.length ? actionableNavigation.routeGeometry : liveTrip.routeGeometry}
          nextStop={liveTrip.intermediateStops[0] ?? liveTrip.destination}
          speedMph={liveTrip.speedMph}
          overviewMode={overviewMode}
          onInteract={stoppedControlsVisible ? () => setOverviewMode(true) : undefined}
          alternatives={stoppedControlsVisible && !guidanceExpired ? navData?.alternatives ?? [] : []}
          selectedRouteId={navData?.currentRouteId}
          onSelectAlternative={stoppedControlsVisible ? (routeId) => void selectAlternative(routeId) : undefined}
        />

        {stoppedControlsVisible && !guidanceExpired && navData?.alternatives.length ? (
          <div className="absolute right-2 top-48 z-30 w-44 rounded-xl border bg-background/95 p-3 shadow-xl backdrop-blur sm:right-4 sm:top-60 xl:top-4">
            <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Route choices</div>
            <div className="grid gap-2">
              <Button size="sm" variant="default" disabled>Current route</Button>
              {navData.alternatives.map((route, index) => (
           <Button
                  key={route.id}
                  size="sm"
                  variant="outline"
                  aria-label={`Route ${index + 2}: ${routeDifferenceLabel(route.timeDifferenceSeconds)}`}
                  onClick={() => void selectAlternative(route.id)}
                >
                  Route {index + 2} · {routeDifferenceLabel(route.timeDifferenceSeconds)}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {!overviewMode && (
          <div className="pointer-events-none absolute inset-x-2 top-2 z-30 flex justify-center sm:inset-x-4 sm:top-4">
            <div className="pointer-events-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-emerald-950/25 bg-[#087d68] text-white shadow-2xl sm:rounded-3xl">
              {hasCurrent ? (
                <>
                  <VerifiedGuidance maneuver={actionableNavigation.currentManeuver!} />
                  <div className="flex min-h-24 items-center gap-3 px-4 py-3 sm:min-h-32 sm:gap-5 sm:px-6 sm:py-5">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center sm:h-20 sm:w-20">
                      <ManeuverIcon
                        type={actionableNavigation.currentManeuver!.type}
                        modifier={actionableNavigation.currentManeuver!.modifier}
                        className="h-12 w-12 drop-shadow-md sm:h-16 sm:w-16"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-3xl font-black leading-none tracking-tight drop-shadow-sm sm:text-5xl">
                        {formatDistance(actionableNavigation.currentManeuver!.distanceMiles)}
                      </div>
                      <div className="mt-1 line-clamp-2 text-lg font-bold leading-tight drop-shadow-sm sm:text-3xl">
                        {actionableNavigation.currentManeuver!.instruction}
                      </div>
                    </div>
                  </div>
                  {actionableNavigation.nextManeuver && (
                    <div className="flex items-center gap-3 border-t border-white/15 bg-black/20 px-4 py-2.5 sm:px-6 sm:py-3">
                      <ManeuverIcon
                        type={actionableNavigation.nextManeuver.type}
                        modifier={actionableNavigation.nextManeuver.modifier}
                        className="h-6 w-6 shrink-0 opacity-85 sm:h-8 sm:w-8"
                      />
                      <div className="truncate font-semibold sm:text-xl">
                        Then {actionableNavigation.nextManeuver.instruction}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex min-h-24 items-center justify-center gap-3 px-5 py-4 text-xl font-bold sm:min-h-32 sm:text-2xl">
                  {guidanceExpired ? <AlertTriangle className="h-8 w-8" /> : <Navigation2 className="h-8 w-8 animate-pulse" />}
                  <span>{guidanceExpired ? 'Guidance unavailable' : 'Preparing live guidance'}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {navigationUnavailable && (
          <div
            role="status"
            className="pointer-events-none absolute inset-x-3 top-40 z-30 flex justify-center sm:top-52"
          >
            <div className="max-w-2xl rounded-xl border border-amber-300/50 bg-amber-500 px-4 py-2.5 text-center text-sm font-bold text-amber-950 shadow-xl sm:text-base">
              {guidanceExpired
                ? `Live guidance expired: ${navigationError || 'navigation service unavailable.'} Keep following road signs while navigation reconnects.`
                : 'Live guidance is reconnecting. The visible route remains available.'}
            </div>
          </div>
        )}

        {!overviewMode && (
          <div className="pointer-events-none absolute bottom-72 left-2 z-30 sm:bottom-80 sm:left-4">
            <div className="pointer-events-auto w-16 overflow-hidden rounded-2xl border bg-card shadow-2xl sm:w-20">
              <div className="bg-white p-2 text-black">
                <div className="flex aspect-[4/5] w-full flex-col items-center justify-center rounded-lg border-4 border-black leading-none">
                  <div className="text-[8px] font-black uppercase tracking-tighter sm:text-[10px]">Speed</div>
                  <div className="text-[8px] font-black uppercase tracking-tighter sm:text-[10px]">Limit</div>
                  <div className="mt-1 text-xl font-black sm:text-2xl">{actionableNavigation?.speedLimitMph || '--'}</div>
                </div>
              </div>
              <div className="border-t px-2 py-2 text-center">
                <div className="text-2xl font-black leading-none sm:text-3xl">
                  {liveTrip.speedMph != null ? Math.round(liveTrip.speedMph) : '--'}
                </div>
                <div className="mt-1 text-[10px] font-bold uppercase text-muted-foreground sm:text-xs">mph</div>
              </div>
            </div>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-72 right-2 z-30 flex flex-col gap-3 sm:bottom-80 sm:right-4">
          {stoppedControlsVisible && (
            <Button
              variant="secondary"
              size="icon"
              className="pointer-events-auto h-12 w-12 rounded-full border shadow-2xl sm:h-14 sm:w-14"
              onClick={() => { lastRerouteAt.current = 0; fetchNavRef.current?.(); }}
              aria-label="Refresh navigation route"
            >
              <RotateCcw className="h-6 w-6" />
            </Button>
          )}
          <Button
            variant="secondary"
            size="icon"
            className="pointer-events-auto h-12 w-12 rounded-full border shadow-2xl sm:h-14 sm:w-14"
            onClick={() => setIsMuted((muted) => !muted)}
            aria-label="Toggle mute"
          >
            {isMuted ? <VolumeX className="h-6 w-6" /> : <Volume2 className="h-6 w-6 text-primary" />}
          </Button>
          {stoppedControlsVisible && (
            <Button
              variant={overviewMode ? 'default' : 'secondary'}
              size="icon"
              className="pointer-events-auto h-12 w-12 rounded-full border shadow-2xl sm:h-14 sm:w-14"
              onClick={() => setOverviewMode((overview) => !overview)}
              aria-label={overviewMode ? 'Recenter navigation map' : 'Show full route'}
            >
              {overviewMode ? <Navigation2 className="h-6 w-6 sm:h-7 sm:w-7" /> : <MapIcon className="h-6 w-6 sm:h-7 sm:w-7" />}
            </Button>
          )}
          <Button
            variant="destructive"
            size="icon"
            className="pointer-events-auto h-12 w-12 rounded-full shadow-2xl sm:h-14 sm:w-14"
            onClick={onEmergencyAccess ?? onExit}
            aria-label="Emergency controls"
          >
            <ShieldAlert className="h-6 w-6 sm:h-7 sm:w-7" />
          </Button>
          <Button
            variant="secondary"
            size="icon"
            className="pointer-events-auto h-12 w-12 rounded-full border shadow-2xl sm:h-14 sm:w-14"
            onClick={onExit}
            aria-label="Exit Navigation"
          >
            <ArrowLeft className="h-6 w-6 sm:h-7 sm:w-7" />
          </Button>
        </div>

        <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20 flex justify-center sm:inset-x-4 sm:bottom-4">
          <div className="pointer-events-auto w-full max-w-3xl">
            <DriverJourneyFocus
              stopName={nextStopName}
              stopKind={nextStopKind}
              verifiedInstruction={verifiedStopInstruction}
              eta={arrivalTime}
              authoritativePickupTime={authoritativePickupTime}
              dispatchMessage={dispatchMessage}
              motionState={motionState}
              stoppedControlsConfirmed={stoppedControlsConfirmed}
              onConfirmStoppedControls={() => setStoppedControlsConfirmed(true)}
              onSpeakInstruction={verifiedStopInstruction && !isMuted ? speakStopInstruction : undefined}
              speakingInstruction={speakingStopInstruction}
            />
            <div className="mt-1 flex flex-wrap justify-center gap-x-3 px-3 text-[11px] font-bold text-slate-700">
              <span>{guidanceExpired ? '--' : remainingDistance?.toFixed(1) ?? '--'} mi</span>
              <span>{actionableNavigation ? `${Math.max(1, Math.round(actionableNavigation.travelTimeSeconds / 60))} min` : '-- min'}</span>
              <span>{rerouting ? 'Rerouting…' : navigationUnavailable ? 'Last route retained' : 'Route current'}</span>
              {gpsAccuracy != null && <span>GPS ±{Math.round(gpsAccuracy)}m</span>}
            </div>
          </div>
        </div>
      </div>
    );
}
