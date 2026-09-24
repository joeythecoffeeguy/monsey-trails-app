import { useSyncExternalStore } from 'react';
import { resolvePlusCodeSuggestion } from '@/lib/plus-code';
import type { Coordinates } from './api-interfaces';
import type { Announcement, DisplayMode } from '@/lib/store';
import { getClientPath } from '@/lib/app-routes';
import { clearDriverOfflineRoutes } from '@/lib/driver-offline-route';

export interface NavigationManeuver {
  instruction: string;
  distanceMiles: number;
  type: 'turn' | 'merge' | 'arrive' | 'depart' | 'continue' | 'exit' | 'roundabout' | 'fork';
  modifier?: 'left' | 'right' | 'slight left' | 'slight right' | 'sharp left' | 'sharp right' | 'straight' | 'uturn';
  laneGuidance: {
    lanes: Array<{
      directions: string[];
      follow: string | null;
    }>;
    laneSeparators: string[];
  } | null;
  exitNumber: string | null;
  roadShields: Array<{
    reference: string;
    shieldContent: string;
    affixes: string[];
  }>;
  signpostText: string | null;
}

export interface TripNavigation {
  currentRouteId: string;
  currentManeuver: NavigationManeuver | null;
  nextManeuver: NavigationManeuver | null;
  trafficDelaySeconds: number;
  speedLimitMph: number | null;
  voicePrompt: string | null;
  voicePromptId: string | null;
  routeGeometry: Coordinates[];
  remainingDistanceMiles: number;
  travelTimeSeconds: number;
  arrivalTime: string | null;
  alternatives: TripRouteAlternative[];
}

export interface TripRouteAlternative extends Omit<TripNavigation, 'alternatives' | 'currentRouteId'> {
  id: string;
  timeDifferenceSeconds: number;
}
export interface LiveTrip {
  status: 'idle' | 'ready' | 'running' | 'stopped';
  destinationAddress: string;
  destinationNote?: string;
  destination: Coordinates | null;
  intermediateStops: TripStop[];
  routeGeometry: Coordinates[];
  origin: Coordinates | null;
  currentLocation: Coordinates | null;
  totalDistanceMiles: number | null;
  remainingDistanceMiles: number | null;
  eta: string | null;
  speedMph: number | null;
  startedAt: string | null;
  emergencyOverride: boolean;
  emergencyMessage: string;
  routeId: string;
  displayMode: DisplayMode;
  passengerLanguage: PassengerLanguage;
  rotationIntervalSeconds: number;
  arrivalSoundsEnabled: boolean;
  announcements: Announcement[];
  displaySettingsVersion?: number;
  enabledSlides?: DisplayMode[];
  chimeTestRequestedAt: string | null;
  passengerDisplays: PassengerDisplayStatus[];
  officialRunKey?: string | null;
  locationVisibility: 'before_departure' | 'live' | 'ended' | 'unavailable';
  scheduledDepartureAt: string | null;
  updatedAt: string;
  locationUpdatedAt?: string;
  /** Server-authored passenger journey statuses for public-run passengers. */
  journeyProgress?: JourneyProgressItem[];
  disruptions?: ServiceDisruption[];
}

export interface ServiceDisruption {
  id: string;
  officialRunKey: string;
  type: 'delay' | 'detour' | 'skipped_stop' | 'boarding_change' | 'cancellation';
  message: string;
  delayMinutes: number | null;
  stopName: string | null;
  targetCoachNumbers?: string[];
  startsAt: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface JourneyProgressItem {
  id: string;
  address: string;
  lat: number;
  lng: number;
  eta: string | null;
  status: 'completed' | 'current' | 'upcoming' | 'final';
  kind?: 'pickup' | 'dropoff' | 'destination';
  completedAt?: string | null;
}

export async function fetchPublicRunTrip(runKey: string): Promise<LiveTrip | null> {
  const assignment = await request<{
    assigned: boolean;
    coachNumber: string | null;
    trip: PolledLiveTrip | null;
  }>(`/api/passenger/public-run/${encodeURIComponent(runKey)}`);
  return assignment.assigned && assignment.trip
    ? normalizeTripResponse(assignment.trip)
    : null;
}

export type PassengerLanguage = 'en' | 'yi' | 'he';

export interface PassengerDisplayStatus {
  id: string;
  audioReady: boolean;
}

type PolledLiveTrip = Omit<LiveTrip, 'routeGeometry'> & {
  routeGeometry?: Coordinates[];
};

export interface TripStop {
  id: string;
  address: string;
  note?: string;
  lat: number;
  lng: number;
  eta?: string;
}

const initialTrip: LiveTrip = {
  status: 'idle',
  destinationAddress: '',
  destination: null,
  intermediateStops: [],
  routeGeometry: [],
  origin: null,
  currentLocation: null,
  totalDistanceMiles: null,
  remainingDistanceMiles: null,
  eta: null,
  speedMph: null,
  startedAt: null,
  emergencyOverride: false,
  emergencyMessage: 'Please remain seated and follow all instructions from the driver.',
  routeId: 'route-1',
  displayMode: 'auto',
  passengerLanguage: 'en',
  rotationIntervalSeconds: 15,
  arrivalSoundsEnabled: true,
  announcements: [],
  chimeTestRequestedAt: null,
  passengerDisplays: [],
  officialRunKey: null,
  locationVisibility: 'unavailable',
  scheduledDepartureAt: null,
  updatedAt: new Date(0).toISOString(),
  journeyProgress: [],
};

const snapshots = new Map<string, LiveTrip>();
const operatorSnapshotKeys = new Set<string>();
let developmentDisplayPreview: LiveTrip | null = null;
const PERSONAL_BUS_NUMBER_KEY = 'coach-personal-v2-bus-number';
const PERSONAL_DEPARTURE_TIME_KEY = 'coach-personal-v2-departure-time';
const PERSONAL_RUN_KEY = 'coach-personal-v2-run-key';
const ADMIN_DISPLAY_BUS_KEY = 'coach-admin-display-bus-number';
export const LIVE_TRIP_REFRESH_INTERVAL_MS = 3_000;
export interface LiveTripRefreshStatus {
  isRefreshing: boolean;
  lastSuccessfulRefreshAt: number | null;
  lastRefreshFailed: boolean;
}
const initialRefreshStatus: LiveTripRefreshStatus = {
  isRefreshing: false,
  lastSuccessfulRefreshAt: null,
  lastRefreshFailed: false,
};
let refreshStatus = initialRefreshStatus;
let pollingTimer: number | null = null;
let refreshInFlight = false;
let tripMutationVersion = 0;
let tripMutationQueue: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

function updateRefreshStatus(next: Partial<LiveTripRefreshStatus>) {
  refreshStatus = { ...refreshStatus, ...next };
  listeners.forEach((listener) => listener());
}

export function getDisplayBusNumber() {
  return sessionStorage.getItem('coach-display-bus-number') ?? '';
}

export function setDisplayBusNumber(busNumber: string) {
  const normalized = busNumber.trim().toUpperCase();
  sessionStorage.setItem('coach-display-bus-number', normalized);
  ensurePolling();
  listeners.forEach((listener) => listener());
}

function clearDisplayPairingCode() {
  sessionStorage.removeItem('coach-display-bus-number');
  listeners.forEach((listener) => listener());
}

export function disconnectPassengerDisplay() {
  clearDisplayPairingCode();
}

export interface AdminActiveTrip {
  busNumber: string;
  status: 'ready' | 'running';
  destinationAddress: string;
  pairedScreenCount: number;
  scheduledDepartureAt: string | null;
  updatedAt: string;
}

export function getAdminDisplayBusNumber() {
  return sessionStorage.getItem(ADMIN_DISPLAY_BUS_KEY) ?? '';
}

export function setAdminDisplayBusNumber(busNumber: string) {
  const normalized = busNumber.trim().toUpperCase();
  sessionStorage.setItem(ADMIN_DISPLAY_BUS_KEY, normalized);
  snapshots.set(normalized, initialTrip);
  ensurePolling();
  listeners.forEach((listener) => listener());
}

export function clearAdminDisplayBusNumber() {
  const busNumber = getAdminDisplayBusNumber();
  sessionStorage.removeItem(ADMIN_DISPLAY_BUS_KEY);
  if (busNumber) snapshots.delete(busNumber);
  stopPolling();
  listeners.forEach((listener) => listener());
}

export function listAdminActiveTrips() {
  return request<AdminActiveTrip[]>('/api/admin/display');
}

export function adminDisconnectPassengerScreens(busNumber: string) {
  return request<{
    busNumber: string;
    pairingCode: string;
    disconnectedScreenCount: number;
    pairedScreenCount: 0;
    status: 'ready' | 'running';
    officialRunKey: string | null;
    startedAt: string | null;
    updatedAt: string;
  }>(`/api/admin/active-trips/${encodeURIComponent(busNumber)}/disconnect-screens`, {
    method: 'POST',
  });
}

export const ADMIN_DISPLAY_SLIDES = [
  'welcome', 'map', 'weather', 'traffic', 'daf', 'jewish-calendar',
  'announcements', 'destinations-info', 'fares-info', 'passenger-guide',
  'contact-info', 'charging-amenities', 'safety',
] as const;

export interface AdminDisplaySettings {
  busNumber: string;
  version: number;
  enabledSlides: DisplayMode[];
  passengerLanguage: PassengerLanguage;
  rotationIntervalSeconds: number;
  announcements: Announcement[];
  updatedAt: string | null;
}

export interface AdminDisplayHealth {
  settings: AdminDisplaySettings;
  screens: Array<{
    id: string;
    audioReady: boolean;
    latestReceivedVersion: number | null;
    receivedAt: string | null;
  }>;
}

export function getAdminDisplaySettings(busNumber: string) {
  return request<AdminDisplayHealth>(`/api/admin/display/${encodeURIComponent(busNumber)}`);
}

export function saveAdminDisplaySettings(busNumber: string, settings: Pick<AdminDisplaySettings,
  'enabledSlides' | 'passengerLanguage' | 'rotationIntervalSeconds' | 'announcements'>) {
  return request<AdminDisplaySettings>(`/api/admin/display/${encodeURIComponent(busNumber)}`, {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export function setAdminEmergencyTakeover(
  busNumber: string,
  enabled: boolean,
  message: string,
  confirmation: string,
) {
  return request<{ emergencyOverride: boolean; emergencyMessage: string }>(
    `/api/admin/display/${encodeURIComponent(busNumber)}/emergency`,
    { method: 'POST', body: JSON.stringify({ enabled, message, confirmation }) },
  );
}

export function getPersonalBusNumber() {
  return localStorage.getItem(PERSONAL_BUS_NUMBER_KEY) ?? '';
}

export function getPersonalDepartureTime() {
  return localStorage.getItem(PERSONAL_DEPARTURE_TIME_KEY) ?? '';
}

export function getPersonalRunKey() {
  return localStorage.getItem(PERSONAL_RUN_KEY) ?? '';
}

export function connectPersonalPassenger(runKey: string, departureTime: string) {
  localStorage.removeItem(PERSONAL_BUS_NUMBER_KEY);
  localStorage.setItem(PERSONAL_RUN_KEY, runKey);
  localStorage.setItem(PERSONAL_DEPARTURE_TIME_KEY, departureTime);
  snapshots.set(runKey, initialTrip);
  ensurePolling();
  listeners.forEach((listener) => listener());
}

export function disconnectPersonalPassenger() {
  localStorage.removeItem(PERSONAL_BUS_NUMBER_KEY);
  localStorage.removeItem(PERSONAL_RUN_KEY);
  localStorage.removeItem(PERSONAL_DEPARTURE_TIME_KEY);
  stopPolling();
  listeners.forEach((listener) => listener());
}

export function getOperatorBusNumber() {
  return localStorage.getItem('coach-operator-bus-number') ?? '';
}

export function setOperatorBusNumber(busNumber: string) {
  const normalized = busNumber.trim().toUpperCase();
  localStorage.setItem('coach-operator-bus-number', normalized);
  snapshots.set(normalized, initialTrip);
  operatorSnapshotKeys.add(normalized);
  ensurePolling();
  listeners.forEach((listener) => listener());
}

export function getOperatorPairingCode() {
  return localStorage.getItem('coach-operator-pairing-code') ?? '';
}

function clientPath() {
  return getClientPath(window.location.pathname);
}

function activeTripKey() {
  if (clientPath() === 'auth') return '';
  if (clientPath() === 'admin-display') return getAdminDisplayBusNumber();
  if (clientPath() === 'operator') return getOperatorBusNumber();
  if (clientPath() === 'mounted') return getDisplayBusNumber();
  return getPersonalRunKey();
}

function personalPassengerPath() {
  return clientPath() === 'personal';
}

function publish(coachCode: string, next: LiveTrip) {
  const path = clientPath();
  if (path === 'operator') operatorSnapshotKeys.add(coachCode);
  snapshots.set(
    coachCode,
    path === 'personal' || path === 'mounted' || path === 'admin-display'
      ? normalizeTripResponse(next, snapshots.get(coachCode))
      : next,
  );
  listeners.forEach((listener) => listener());
}

function isOlderTripSnapshot(next: LiveTrip, current?: LiveTrip) {
  if (!current) return false;
  const nextUpdatedAt = Date.parse(next.updatedAt);
  const currentUpdatedAt = Date.parse(current.updatedAt);
  if (Number.isFinite(nextUpdatedAt) && Number.isFinite(currentUpdatedAt) && nextUpdatedAt < currentUpdatedAt) {
    return true;
  }
  return Boolean(
    current.status === 'running'
    && current.startedAt
    && next.status !== 'idle'
    && next.status !== 'stopped'
    && (!next.startedAt || next.startedAt !== current.startedAt),
  );
}

function queueTripMutation<T>(mutation: () => Promise<T>): Promise<T> {
  tripMutationVersion += 1;
  const run = tripMutationQueue.then(mutation);
  tripMutationQueue = run.then(() => undefined, () => undefined);
  return run;
}

export function setLiveTripFixture(busNumber: string, trip: LiveTrip) {
  if (!import.meta.env.DEV) {
    throw new Error('Live trip fixtures are only available in development.');
  }
  setDisplayBusNumber(busNumber);
  publish(busNumber, trip);
}

export function enterDevelopmentDisplayPreview(trip: LiveTrip) {
  if (!import.meta.env.DEV || clientPath() !== 'mounted') {
    throw new Error('Mounted display preview is only available in development.');
  }
  developmentDisplayPreview = trip;
  listeners.forEach((listener) => listener());
}

export function exitDevelopmentDisplayPreview() {
  developmentDisplayPreview = null;
  listeners.forEach((listener) => listener());
}

class LiveTripRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'LiveTripRequestError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = response.status === 204 ? undefined as T : await response.json() as T & { error?: string };
  if (!response.ok) {
    throw new LiveTripRequestError(
      (body as T & { error?: string } | undefined)?.error || `Request failed with status ${response.status}`,
      response.status,
    );
  }
  return body;
}

function tripPath(busNumber: string, suffix = '') {
  if (!busNumber) throw new Error('Enter a bus number first.');
  return `/api/trips/${encodeURIComponent(busNumber)}${suffix}`;
}

export async function connectOperatorToBus(busNumber: string) {
  const normalized = busNumber.trim().toUpperCase();
  const result = await request<{ busNumber: string; pairingCode: string; trip: LiveTrip }>('/api/trips', {
    method: 'POST',
    body: JSON.stringify({ busNumber: normalized }),
  });
  setOperatorBusNumber(result.busNumber);
  localStorage.setItem('coach-operator-pairing-code', result.pairingCode);
  publish(result.busNumber, result.trip);
  return result;
}

export async function pairDisplayWithBus(busNumber: string) {
  const pairingCode = busNumber.trim();
  const result = await request<{ busNumber: string; pairingCode: string; trip: LiveTrip }>('/api/trips/pair', {
    method: 'POST',
    body: JSON.stringify({ pairingCode }),
  });
  setDisplayBusNumber(result.pairingCode);
  publish(result.pairingCode, result.trip);
  return result;
}

export interface QrInvitePreview {
  busNumber: string;
  expiresAt: string;
}

export async function createPassengerQrInvite() {
  const busNumber = getOperatorBusNumber();
  const passengerPairingCode = getOperatorPairingCode();
  return request<{ token: string; expiresAt: string }>(tripPath(busNumber, '/qr-invite'), {
    method: 'POST',
    body: JSON.stringify({ passengerPairingCode }),
  });
}

export async function previewPassengerQrInvite(token: string) {
  return request<QrInvitePreview>(`/api/trips/qr-invites/${encodeURIComponent(token)}`);
}

export async function pairDisplayWithQrInvite(token: string) {
  const result = await request<{ busNumber: string; pairingCode: string; trip: LiveTrip }>(
    `/api/trips/qr-invites/${encodeURIComponent(token)}/pair`,
    { method: 'POST' },
  );
  setDisplayBusNumber(result.pairingCode);
  publish(result.pairingCode, result.trip);
  return result;
}

export async function getPassengerPushPublicKey() {
  if (personalPassengerPath()) {
    const busNumber = getPersonalBusNumber();
    return request<{ publicKey: string }>(
      `/api/trips/public/${encodeURIComponent(busNumber)}/push-public-key`,
    );
  }
  const pairingCode = getDisplayBusNumber();
  return request<{ publicKey: string }>(
    tripPath(pairingCode, '/push-public-key?viewer=passenger'),
  );
}

export async function savePassengerPushSubscription(input: {
  displayId: string;
  stopKey: string;
  stopLabel: string;
  subscription: PushSubscriptionJSON;
}) {
  if (personalPassengerPath()) {
    const busNumber = getPersonalBusNumber();
    await request<void>(`/api/trips/public/${encodeURIComponent(busNumber)}/push-subscription`, {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    return;
  }
  const pairingCode = getDisplayBusNumber();
  await request<void>(tripPath(pairingCode, '/push-subscription?viewer=passenger'), {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function deletePassengerPushSubscription(displayId: string) {
  if (personalPassengerPath()) {
    const busNumber = getPersonalBusNumber();
    if (!busNumber) return;
    await request<void>(
      `/api/trips/public/${encodeURIComponent(busNumber)}/push-subscription/${encodeURIComponent(displayId)}`,
      { method: 'DELETE' },
    );
    return;
  }
  const pairingCode = getDisplayBusNumber();
  if (!pairingCode) return;
  await request<void>(
    tripPath(pairingCode, `/push-subscription/${encodeURIComponent(displayId)}?viewer=passenger`),
    { method: 'DELETE' },
  );
}

export async function logoutOperator() {
  const busNumber = getOperatorBusNumber();
  try {
    if (busNumber) {
      await request<void>(tripPath(busNumber, '/logout'), { method: 'POST' });
    }
  } finally {
    clearOperatorSession();
  }
}

/**
 * Clears only driver-scoped local state. This is intentionally synchronous and
 * performs no network request so auth can call it while changing accounts.
 */
export function clearOperatorSession() {
  localStorage.removeItem('coach-operator-bus-number');
  localStorage.removeItem('coach-operator-pairing-code');
  clearDriverOfflineRoutes();
  operatorSnapshotKeys.forEach((key) => snapshots.delete(key));
  operatorSnapshotKeys.clear();
  stopPolling();
  refreshInFlight = false;
  refreshStatus = initialRefreshStatus;
  listeners.forEach((listener) => listener());
}

const passengerDisplaySessionTokens = new Map<string, string>();

export async function reportPassengerAudioStatus(busNumber: string, id: string, audioReady: boolean) {
  const key = `${busNumber}:${id}`;
  const result = await request<{ sessionToken: string }>(`${tripPath(busNumber, '/passenger-status')}?viewer=passenger`, {
    method: 'PUT',
    body: JSON.stringify({ id, audioReady, sessionToken: passengerDisplaySessionTokens.get(key) ?? '' }),
  });
  passengerDisplaySessionTokens.set(key, result.sessionToken);
}

export async function acknowledgePassengerDisplaySettings(busNumber: string, displayId: string, version: number) {
  const sessionToken = passengerDisplaySessionTokens.get(`${busNumber}:${displayId}`);
  if (!sessionToken) throw new Error('The passenger display session is not registered yet.');
  await request<void>(`${tripPath(busNumber, '/display-settings-receipt')}?viewer=passenger`, {
    method: 'PUT',
    body: JSON.stringify({ displayId, version, sessionToken }),
  });
}

export async function refreshLiveTrip() {
  if (refreshInFlight) return;
  const tripKey = activeTripKey();
  if (!tripKey) {
    listeners.forEach((listener) => listener());
    return;
  }
  refreshInFlight = true;
  const mutationVersionAtRequest = tripMutationVersion;
  updateRefreshStatus({ isRefreshing: true });
  try {
    const current = snapshots.get(tripKey);
    let response: PolledLiveTrip;
    if (clientPath() === 'admin-display') {
      response = await request<PolledLiveTrip>(
        `/api/admin/active-trips/${encodeURIComponent(tripKey)}`,
      );
    } else if (personalPassengerPath()) {
      const assignment = await request<{
        assigned: boolean;
        coachNumber: string | null;
        trip: PolledLiveTrip | null;
      }>(
        `/api/passenger/public-run/${encodeURIComponent(tripKey)}`,
      );
      if (!assignment.assigned || !assignment.trip) {
        localStorage.removeItem(PERSONAL_BUS_NUMBER_KEY);
        publish(tripKey, { ...initialTrip, officialRunKey: tripKey });
        updateRefreshStatus({
          lastSuccessfulRefreshAt: Date.now(),
          lastRefreshFailed: false,
        });
        return;
      }
      if (assignment.coachNumber) localStorage.setItem(PERSONAL_BUS_NUMBER_KEY, assignment.coachNumber);
      response = assignment.trip;
    } else {
      const params = new URLSearchParams();
      if (current?.updatedAt) params.set('geometryVersion', current.updatedAt);
      if (clientPath() === 'mounted') params.set('viewer', 'passenger');
      const query = params.size > 0 ? `?${params.toString()}` : '';
      response = await request<PolledLiveTrip>(`${tripPath(tripKey)}${query}`);
    }
    if (tripKey !== activeTripKey() || mutationVersionAtRequest !== tripMutationVersion) return;
    const normalized = normalizeTripResponse(response, current);
    if (isOlderTripSnapshot(normalized, snapshots.get(tripKey))) return;
    const routeWasCleared = Boolean(current?.destination || current?.intermediateStops.length)
      && normalized.status === 'idle'
      && !normalized.destination
      && !normalized.destinationAddress
      && normalized.intermediateStops.length === 0
      && normalized.routeGeometry.length === 0;
    publish(tripKey, routeWasCleared
      ? { ...initialTrip, ...normalized, routeGeometry: [] }
      : normalized);
    updateRefreshStatus({
      lastSuccessfulRefreshAt: Date.now(),
      lastRefreshFailed: false,
    });
  } catch (error) {
    if (clientPath() === 'operator'
        && error instanceof LiveTripRequestError
        && (error.status === 401 || error.status === 403)) {
      clearOperatorSession();
      return;
    }
    const waitingForDriver = personalPassengerPath()
      && error instanceof Error
      && /driver has not assigned a bus/i.test(error.message);
    updateRefreshStatus({ lastRefreshFailed: !waitingForDriver });
    if (clientPath() === 'mounted'
        && error instanceof Error && /404|410|expired|not found|no longer active|pairing code|no longer paired|invalid.*code/i.test(error.message)) {
      clearDisplayPairingCode();
    }
    // Passenger clients must never retain a previously precise marker while
    // disconnected: the server may have closed the visibility window.
    if (clientPath() === 'personal' || clientPath() === 'mounted') {
      const currentKey = activeTripKey();
      const current = snapshots.get(currentKey);
      if (currentKey && current) publish(currentKey, hidePreciseLocation(current, 'unavailable'));
    }
  } finally {
    refreshInFlight = false;
    updateRefreshStatus({ isRefreshing: false });
  }
}

function hidePreciseLocation(
  trip: LiveTrip,
  locationVisibility: LiveTrip['locationVisibility'],
): LiveTrip {
  return {
    ...trip,
    locationVisibility,
    currentLocation: null,
    origin: null,
    routeGeometry: [],
    speedMph: null,
    eta: null,
    totalDistanceMiles: null,
    remainingDistanceMiles: null,
  };
}

function normalizeTripResponse(response: PolledLiveTrip, current?: LiveTrip): LiveTrip {
  const visibility = response.locationVisibility ?? 'unavailable';
  const merged: LiveTrip = {
    ...(current ?? initialTrip),
    ...response,
    locationVisibility: visibility,
    scheduledDepartureAt: response.scheduledDepartureAt === undefined
      ? current?.scheduledDepartureAt ?? null
      : response.scheduledDepartureAt,
    routeGeometry: visibility === 'live'
      ? response.routeGeometry ?? (current?.locationVisibility === 'live' ? current.routeGeometry : [])
      : [],
  };
  return visibility === 'live' ? merged : hidePreciseLocation(merged, visibility);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) ensurePolling();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopPolling();
  };
}

function ensurePolling() {
  if (pollingTimer !== null || listeners.size === 0 || !activeTripKey()) return;
  void refreshLiveTrip();
  pollingTimer = window.setInterval(refreshLiveTrip, LIVE_TRIP_REFRESH_INTERVAL_MS);
  window.addEventListener('online', refreshLiveTrip);
  document.addEventListener('visibilitychange', handleVisibilityRefresh);
}

function stopPolling() {
  if (pollingTimer !== null) window.clearInterval(pollingTimer);
  pollingTimer = null;
  window.removeEventListener('online', refreshLiveTrip);
  document.removeEventListener('visibilitychange', handleVisibilityRefresh);
}

function handleVisibilityRefresh() {
  if (document.visibilityState === 'visible') void refreshLiveTrip();
}

export function useLiveTrip() {
  return useSyncExternalStore(
    subscribe,
    () => developmentDisplayPreview ?? snapshots.get(activeTripKey()) ?? initialTrip,
    () => initialTrip,
  );
}

export function useLiveTripRefreshStatus() {
  return useSyncExternalStore(
    subscribe,
    () => refreshStatus,
    () => initialRefreshStatus,
  );
}

window.addEventListener('driver-account-changed', clearOperatorSession);

export async function resolveDestination(address: string) {
  const busNumber = activeTripKey();
  const result = await request<{ address: string; destination: Coordinates }>(tripPath(busNumber, '/resolve'), {
    method: 'POST',
    body: JSON.stringify({ address }),
  });
  await refreshLiveTrip();
  return result;
}

export async function configureTripRoute(
  destination: TripStop,
  intermediateStops: TripStop[],
  officialRunKey: string | null = null,
) {
  const busNumber = activeTripKey();
  const result = await request<LiveTrip>(tripPath(busNumber, '/route-plan'), {
    method: 'PUT',
    body: JSON.stringify({ destination, intermediateStops, officialRunKey }),
  });
  publish(busNumber, result);
  return result;
}

export async function clearTripRoute() {
  const busNumber = activeTripKey();
  const result = await request<LiveTrip>(tripPath(busNumber, '/route-plan'), {
    method: 'DELETE',
  });
  publish(busNumber, result);
  return result;
}

export interface AddressSuggestion {
  id: string;
  label: string;
  lat: number;
  lng: number;
  type: string;
}

export async function suggestDestinations(query: string, signal?: AbortSignal) {
  const busNumber = activeTripKey();
  const providerLookup = (providerQuery: string, providerSignal?: AbortSignal) => request<AddressSuggestion[]>(
    `${tripPath(busNumber, '/address-suggestions')}?q=${encodeURIComponent(providerQuery)}`,
    { signal: providerSignal },
  );
  const plusCode = await resolvePlusCodeSuggestion(query, providerLookup, signal);
  return plusCode ? [plusCode] : providerLookup(query, signal);
}

export async function startLiveTrip(location?: Coordinates) {
  const busNumber = activeTripKey();
  return queueTripMutation(async () => {
    const result = await request<LiveTrip>(tripPath(busNumber, '/start'), {
      method: 'POST',
      body: JSON.stringify(location ?? {}),
    });
    if (busNumber === activeTripKey() && !isOlderTripSnapshot(result, snapshots.get(busNumber))) {
      publish(busNumber, result);
    }
    return result;
  });
}

export async function publishTripLocation(location: Coordinates, speedMph: number | null) {
  const busNumber = activeTripKey();
  const result = await request<LiveTrip>(tripPath(busNumber, '/location'), {
    method: 'POST',
    body: JSON.stringify({ ...location, speedMph }),
  });
  publish(busNumber, result);
  return result;
}

export async function stopLiveTrip() {
  const busNumber = activeTripKey();
  const result = await request<LiveTrip>(tripPath(busNumber, '/stop'), { method: 'POST' });
  publish(busNumber, result);
  return result;
}

export async function arriveAtNextDestination(expectedStopIdentity: string, expectedStartedAt: string) {
  const busNumber = activeTripKey();
  if (!expectedStopIdentity || !expectedStartedAt) {
    throw new Error('The active trip is still synchronizing. Wait a moment and try again.');
  }
  return queueTripMutation(async () => {
    const result = await request<{
      trip: LiveTrip;
      arrivedAt: string;
      nextDestination: string | null;
      tripComplete: boolean;
    }>(tripPath(busNumber, '/arrive'), {
      method: 'POST',
      body: JSON.stringify({ expectedStopIdentity, expectedStartedAt }),
    });
    if (busNumber === activeTripKey() && !isOlderTripSnapshot(result.trip, snapshots.get(busNumber))) {
      publish(busNumber, result.trip);
    }
    return result;
  });
}

export async function logoutPairedScreens() {
  const busNumber = getOperatorBusNumber();
  const result = await request<{ busNumber: string; pairingCode: string; trip: LiveTrip }>(
    tripPath(busNumber, '/disconnect-screens'),
    {
      method: 'POST',
    },
  );
  localStorage.setItem('coach-operator-pairing-code', result.pairingCode);
  publish(result.busNumber, result.trip);
  return result;
}

export async function getTripRouteGeometry(signal?: AbortSignal) {
  const busNumber = activeTripKey();
  return request<{ geometry: Coordinates[] }>(tripPath(busNumber, '/route-geometry'), { signal });
}

export async function updateEmergencySettings(emergencyOverride: boolean, emergencyMessage: string) {
  const busNumber = activeTripKey();
  const result = await request<LiveTrip>(tripPath(busNumber, '/emergency'), {
    method: 'PATCH',
    body: JSON.stringify({ emergencyOverride, emergencyMessage }),
  });
  publish(busNumber, result);
  return result;
}

export async function updateTripDisplaySettings(settings: {
  routeId: string;
  displayMode: DisplayMode;
  passengerLanguage: PassengerLanguage;
  rotationIntervalSeconds: number;
  arrivalSoundsEnabled: boolean;
}) {
  const busNumber = activeTripKey();
  const result = await request<LiveTrip>(tripPath(busNumber, '/display-settings'), {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
  publish(busNumber, result);
  return result;
}

export async function updateTripAnnouncements(announcements: Announcement[]) {
  const busNumber = activeTripKey();
  const result = await request<LiveTrip>(tripPath(busNumber, '/announcements'), {
    method: 'PATCH',
    body: JSON.stringify({ announcements }),
  });
  publish(busNumber, result);
  return result;
}

export async function testPassengerChime() {
  const busNumber = activeTripKey();
  const result = await request<LiveTrip>(tripPath(busNumber, '/test-chime'), { method: 'POST' });
  publish(busNumber, result);
  return result;
}

export async function getTripNavigation(signal?: AbortSignal) {
  const busNumber = activeTripKey();
  return request<TripNavigation>(tripPath(busNumber, '/navigation'), { signal });
}

export async function selectTripNavigationRoute(routeId: string) {
  const busNumber = activeTripKey();
  return request<TripNavigation>(tripPath(busNumber, '/navigation-selection'), {
    method: 'PUT',
    body: JSON.stringify({ routeId }),
  });
}
