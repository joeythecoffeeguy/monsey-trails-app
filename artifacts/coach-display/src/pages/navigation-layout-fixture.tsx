import { useEffect, useState } from 'react';
import { NavigationCockpit } from '@/components/operator/NavigationCockpit';
import { setLiveTripFixture, type LiveTrip, type TripNavigation } from '@/providers/live-trip';

const routeGeometry = [
  { lat: 41.109068, lng: -74.044419 },
  { lat: 41.116, lng: -74.052 },
  { lat: 41.126, lng: -74.066 },
  { lat: 41.138563, lng: -74.082685 },
];

const navigation: TripNavigation = {
  currentRouteId: 'tomtom-primary',
  currentManeuver: {
    instruction: 'Turn left onto Lawler Boulevard',
    distanceMiles: 0.47,
    type: 'exit',
    modifier: 'slight right',
    laneGuidance: {
      lanes: [
        { directions: ['STRAIGHT'], follow: null },
        { directions: ['STRAIGHT'], follow: null },
        { directions: ['SLIGHT_RIGHT'], follow: 'SLIGHT_RIGHT' },
      ],
      laneSeparators: ['SINGLE_SOLID', 'SINGLE_DASHED', 'SINGLE_DASHED', 'SINGLE_SOLID'],
    },
    exitNumber: '14B',
    roadShields: [{ reference: 'usa-interstate', shieldContent: 'I-287', affixes: ['I'] }],
    signpostText: 'Mahwah',
  },
  nextManeuver: {
    instruction: 'Turn right onto North Madison Avenue',
    distanceMiles: 0.53,
    type: 'turn',
    modifier: 'right',
    laneGuidance: null,
    exitNumber: null,
    roadShields: [],
    signpostText: null,
  },
  trafficDelaySeconds: 97,
  speedLimitMph: 20,
  voicePrompt: 'In half a mile, turn left onto Lawler Boulevard',
  voicePromptId: 'preview-lawler',
  routeGeometry,
  remainingDistanceMiles: 3.5,
  travelTimeSeconds: 1061,
  arrivalTime: new Date(Date.now() + 1061_000).toISOString(),
  alternatives: [{
    id: 'alternative-1',
    timeDifferenceSeconds: -180,
    currentManeuver: {
      instruction: 'Keep right onto Route 59',
      distanceMiles: 0.61,
      type: 'fork',
      modifier: 'right',
      laneGuidance: null,
      exitNumber: null,
      roadShields: [],
      signpostText: null,
    },
    nextManeuver: null,
    trafficDelaySeconds: 34,
    speedLimitMph: 35,
    voicePrompt: 'Keep right onto Route 59',
    voicePromptId: 'preview-route-59',
    routeGeometry: [
      routeGeometry[0],
      { lat: 41.119, lng: -74.046 },
      { lat: 41.132, lng: -74.061 },
      routeGeometry.at(-1)!,
    ],
    remainingDistanceMiles: 3.2,
    travelTimeSeconds: 881,
    arrivalTime: new Date(Date.now() + 881_000).toISOString(),
  }],
};

export default function NavigationLayoutFixture() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const now = new Date();
    const trip: LiveTrip = {
      status: 'running',
      destinationAddress: '18 Forshay Road, Monsey, NY 10952',
      destination: routeGeometry.at(-1)!,
      intermediateStops: [],
      routeGeometry,
      origin: routeGeometry[0],
      currentLocation: routeGeometry[0],
      totalDistanceMiles: 3.5,
      remainingDistanceMiles: 3.5,
      eta: navigation.arrivalTime,
      speedMph: 18,
      startedAt: now.toISOString(),
      emergencyOverride: false,
      emergencyMessage: '',
      routeId: 'route-1',
      displayMode: 'auto',
      passengerLanguage: 'en',
      rotationIntervalSeconds: 15,
      arrivalSoundsEnabled: true,
      announcements: [],
      chimeTestRequestedAt: null,
      passengerDisplays: [],
      locationVisibility: 'live',
      scheduledDepartureAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    setLiveTripFixture('NAV-PREVIEW', trip);
    setReady(true);
  }, []);
  if (!ready) return null;
  return <NavigationCockpit onExit={() => undefined} previewNavigation={navigation} />;
}
