import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppText } from '@/components/AppText';
import {
  AccessibilityInfo, AppState, Linking, Platform, Pressable, RefreshControl, Share,
  Animated, Image, ScrollView, StyleSheet, Switch, Text, View, Modal
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import {
  useGetOfficialSchedule,
  useGetPublicRunPassengerTrip,
  useGetPassengerJourney,
  useSearchPassengerTransfers,
  getGetOfficialScheduleQueryKey,
  getGetPublicRunPassengerTripQueryKey,
  leavePassengerAlert,
  upsertPassengerAlert,
  addServiceDays,
  getNewYorkServiceDate,
  getScheduledDepartureInstant,
  getUpcomingScheduleRuns,
  type PassengerAlertResponseAlert,
  type OfficialScheduleRun,
  type OfficialSchedule,
  type ServiceDisruption,
} from '@workspace/api-client-react';
import { alertPayload, isRestorableAlert, makeAlertSelection, type AlertLeadTime, type AlertSelection } from '@/lib/alert-state';
import {
  makePendingAlertCancellation,
  parsePendingAlertCancellation,
  retryPendingAlertCancellation,
  type PendingAlertCancellation,
} from '@/lib/alert-cancellation';
import {
  protectPassengerTripLocation,
} from '@/lib/location-privacy';
import { useColors } from '@/hooks/useColors';
import { journeyCompletionLabel } from '@/lib/journey-progress-label';
import { LIVE_GPS_MAX_AGE_MS, passengerLocationConfidence } from '@/lib/location-confidence';
import * as Haptics from 'expo-haptics';
import { ScheduleRunCard } from '@/components/ScheduleRunCard';
import { Surface } from '@/components/Surface';
import { ServiceInformation } from '@/components/ServiceInformation';
import { MoreMenu } from '@/components/MoreMenu';
import { DepartureReminderCard } from '@/components/DepartureReminderCard';
import { RealtimeAlertsCard } from '@/components/RealtimeAlertsCard';
import { LiveActivityTrackingCard } from '@/components/LiveActivityTrackingCard';
import { RideMotionHintCard } from '@/components/RideMotionHintCard';
import { usePassengerJourneys } from '@/hooks/usePassengerJourneys';
import { PassengerJourneyMap } from '@/components/PassengerJourneyMap';
import { passengerMapData, validMapPoint, type MapStop } from '@/lib/journey-map';
import { TripInformation } from '@/components/TripInformation';
import { ExactStopSelectors, uniqueStops, useExactRunStops } from '@/components/ExactStopSelectors';
import {
  companionStorageKeys, decodeRunLink, encodeRunLink, prependUniqueChoice, routeChoiceKey,
  invalidateOfflineScheduleStatuses, scheduleCacheKey, type PassengerLanguage, type RouteChoice, type SavedSchedule, type StopChoice,
} from '@/lib/companion-preferences';
import { isRtlLanguage, passengerCopy } from '@/lib/passenger-i18n';
import { passengerStopIdentity } from '@workspace/passenger-stop-label';

const keys = {
  runSelection: 'passenger.runSelection',
  device: 'passenger.device',
  alert: 'passenger.alert',
  cancellation: 'passenger.alert-cancellation',
};

type AlertUpsertData = {
  passengerCode: string;
  deviceId: string;
  expoPushToken: string;
  selectedStopId: string;
  leadTime: AlertLeadTime;
  soundEnabled: boolean;
};

const ALERT_LEAD_OPTIONS: ReadonlyArray<{ value: AlertLeadTime; label: string; detail?: string }> = [
  { value: 'time-15m', label: '15 min' },
  { value: 'time-5m', label: '5 min' },
  { value: 'time-2m', label: '2 min' },
  { value: 'arriving-now', label: 'Arriving now', detail: 'Within 0.1 mi' },
  { value: 'distance-0.5mi', label: '0.5 mi' },
];

type RunSelection = {
  date: string;
  line: number;
  origin: number;
  destination: number;
  runId: string;
  summary: string;
  scheduledDepartureAt?: string | null;
  scheduledTime?: string | null;
  pickup?: StopChoice | null;
  dropoff?: StopChoice | null;
};

function milesBetween(
  from: { lat: number; lng: number } | null | undefined,
  to: { lat: number; lng: number },
) {
  if (!from) return null;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latDelta = radians(to.lat - from.lat);
  const lngDelta = radians(to.lng - from.lng);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(lngDelta / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function ArrivingSignal({ color, reduceMotion = false }: { color: string; reduceMotion?: boolean }) {
  const opacity = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0.35, duration: 650, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [opacity, reduceMotion]);
  return (
    <Animated.View style={{ opacity, marginRight: 5 }}>
      <Feather name="wifi" size={15} color={color} />
    </Animated.View>
  );
}

function DisruptionNotices({
  notices,
  theme,
  styles,
}: {
  notices: ServiceDisruption[] | undefined;
  theme: any;
  styles: ReturnType<typeof createStyles>;
}) {
  if (!notices?.length) return null;
  const labels: Record<ServiceDisruption['type'], string> = {
    delay: 'Delay',
    detour: 'Detour',
    skipped_stop: 'Skipped stop',
    boarding_change: 'Boarding change',
    cancellation: 'Cancelled',
  };
  return (
    <View style={styles.disruptionList} accessibilityLabel="Current service notices">
      {notices.map(notice => (
        <View
          key={notice.id}
          style={[
            styles.disruptionNotice,
            { borderColor: notice.type === 'cancellation' ? theme.destructive : theme.arrival },
          ]}
          accessibilityRole="alert"
        >
          <Feather name={notice.type === 'cancellation' ? 'slash' : 'alert-triangle'} size={18} color={notice.type === 'cancellation' ? theme.destructive : theme.arrival} />
          <View style={styles.disruptionCopy}>
            <AppText style={styles.disruptionTitle}>
              {labels[notice.type]}
              {notice.delayMinutes ? ` · about ${notice.delayMinutes} minutes` : ''}
              {notice.stopName ? ` · ${notice.stopName}` : ''}
            </AppText>
            <AppText style={styles.disruptionMessage}>{notice.message}</AppText>
          </View>
        </View>
      ))}
    </View>
  );
}

function LocationConfidenceIndicator({
  trip,
  assigned,
  now,
  theme,
  styles,
}: {
  trip: Parameters<typeof passengerLocationConfidence>[0];
  assigned: boolean;
  now: number;
  theme: any;
  styles: ReturnType<typeof createStyles>;
}) {
  const confidence = passengerLocationConfidence(trip, assigned, now);
  const color = confidence.kind === 'live'
    ? theme.success
    : confidence.kind === 'schedule'
      ? theme.primary
      : theme.arrival;
  const icon = confidence.kind === 'live' ? 'radio' : confidence.kind === 'schedule' ? 'map-pin' : 'wifi-off';
  return (
    <View
      style={[styles.confidenceBadge, { borderColor: color }]}
      accessibilityLabel={[confidence.label, confidence.ageLabel].filter(Boolean).join('. ')}
      accessibilityLiveRegion="polite"
      testID={`location-confidence-${confidence.kind}`}
    >
      <Feather name={icon} size={14} color={color} />
      <AppText style={[styles.confidenceLabel, { color }]}>{confidence.label}</AppText>
      {confidence.ageLabel ? <AppText style={styles.confidenceAge}>• {confidence.ageLabel}</AppText> : null}
    </View>
  );
}

const LINES = [
  { id: 1, name: 'New York Line' },
  { id: 3, name: 'Lakewood Express' },
  { id: 2, name: 'KJ Express' },
];

const LOCATIONS = [
  { id: 2, name: 'Monsey', lines: [1, 2] },
  { id: 1, name: 'New Square', lines: [1, 2] },
  { id: 3, name: 'Boro Park', lines: [1, 3] },
  { id: 4, name: 'Williamsburg', lines: [1] },
  { id: 5, name: 'Manhattan', lines: [1] },
  { id: 6, name: 'Wall Street', lines: [1] },
  { id: 7, name: 'Lakewood (Westgate)', lines: [3] },
  { id: 8, name: 'Lakewood (Sq. Kennedy)', lines: [3] },
  { id: 9, name: 'Flatbush', lines: [3] },
  { id: 10, name: 'Kiryas Yoel', lines: [2] },
  { id: 11, name: 'B&H', lines: [1] },
  { id: 12, name: 'Crown Heights', lines: [1] },
];

const TISHREI_SCHEDULE_PATH = '/api/public/schedules/Monsey-Trails-New-York-Line-Tishrei-2026.pdf';

function destinationIds(line: number, origin: number) {
  if (line === 1) return [1, 2].includes(origin) ? [3, 4, 5, 6, 11, 12] : [1, 2];
  if (line === 2) return [1, 2].includes(origin) ? [10] : [1, 2];
  return [7, 8].includes(origin) ? [9, 3] : [7, 8];
}

function formatDate(iso: string) {
  try {
    const [y, m, d] = iso.split('-');
    const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function formatCalendarMonth(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

function shiftCalendarMonth(month: string, amount: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  const shifted = new Date(year, monthNumber - 1 + amount, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`;
}

function calendarDates(month: string) {
  const [year, monthNumber] = month.split('-').map(Number);
  const firstWeekday = new Date(year, monthNumber - 1, 1).getDay();
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  return [
    ...Array.from<null>({ length: firstWeekday }).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => addServiceDays(`${month}-01`, index)),
  ];
}

function formatTime(value: string | null) {
  if (!value) return 'TBD';
  const date = value.includes('T') ? new Date(value) : new Date(`2000-01-01T${value}`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

async function deletePassengerAlert(cancellation: PendingAlertCancellation) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    await leavePassengerAlert({ passengerCode: cancellation.passengerCode, deviceId: cancellation.deviceId }, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function putPassengerAlert(data: AlertUpsertData) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    return await upsertPassengerAlert(data, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export default function PassengerScreen() {
  const insets = useSafeAreaInsets();
  const theme = useColors();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [selection, setSelection] = useState<RunSelection | null>(null);
  const [tripView, setTripView] = useState<'details' | 'live'>('details');

  // Planner State
  const [line, setLine] = useState(1);
  const [origin, setOrigin] = useState(2);
  const [destination, setDestination] = useState(5);
  const [date, setDate] = useState(() => getNewYorkServiceDate());
  const [clock, setClock] = useState(() => new Date());
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [keysExpanded, setKeysExpanded] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => getNewYorkServiceDate().slice(0, 7));
  const [locModal, setLocModal] = useState<'origin' | 'destination' | null>(null);
  const [plannerMessage, setPlannerMessage] = useState('');
  const [scheduleDownloadBusy, setScheduleDownloadBusy] = useState(false);
  const [scheduleDownloadMessage, setScheduleDownloadMessage] = useState('');
  const [showAllDepartures, setShowAllDepartures] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [language, setLanguage] = useState<PassengerLanguage>('en');
  const [largeText, setLargeText] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [preferencesVisible, setPreferencesVisible] = useState(false);
  const [moreVisible, setMoreVisible] = useState(false);
  const [informationMode, setInformationMode] = useState<'service' | 'coach' | 'contact' | null>(null);
  const {
    favorites, setGuestFavorites, unimportedGuestCount, toggle: toggleSavedJourney,
    importGuestFavorites, accountSubject, busy: journeyBusy,
    unavailable: journeysUnavailable, error: journeySyncError,
    loading: journeysLoading, refresh: refreshJourneys,
  } = usePassengerJourneys();
  const [recents, setRecents] = useState<RouteChoice[]>([]);
  const [savedSchedules, setSavedSchedules] = useState<Record<string, SavedSchedule>>({});
  const [scheduleRefreshError, setScheduleRefreshError] = useState('');
  const [shareMessage, setShareMessage] = useState('');
  const [exactStops, setExactStops] = useState<{
    scope: string;
    pickup: StopChoice | null;
    dropoff: StopChoice | null;
  }>({ scope: '', pickup: null, dropoff: null });

  // Queries
  const scheduleParams = { line, origin, destination, date };
  const { data: liveSchedule, dataUpdatedAt: scheduleUpdatedAt, error: scheduleError, isFetching: fetchingSchedule, refetch: refreshSchedule } = useGetOfficialSchedule(
    scheduleParams,
    { query: { enabled: !selection, queryKey: getGetOfficialScheduleQueryKey(scheduleParams) } }
  );
  const currentScheduleKey = scheduleCacheKey(scheduleParams);
  const cachedSchedule = savedSchedules[currentScheduleKey];
  const lastKnownSchedule = cachedSchedule?.schedule ?? liveSchedule;
  const schedule: OfficialSchedule | undefined = scheduleError
    ? (lastKnownSchedule ? invalidateOfflineScheduleStatuses(lastKnownSchedule) : undefined)
    : liveSchedule ?? (cachedSchedule ? invalidateOfflineScheduleStatuses(cachedSchedule.schedule) : undefined);
  const showingSavedSchedule = Boolean(schedule && (scheduleError || !liveSchedule));
  const scheduleStatusStale = !showingSavedSchedule && Boolean(scheduleUpdatedAt)
    && clock.getTime() - scheduleUpdatedAt > 120_000;

  const runKey = selection ? `${selection.date}|${selection.line}|${selection.origin}|${selection.destination}|${selection.runId}` : '';
  const journeyRequest = useGetPassengerJourney();
  useEffect(() => {
    if (!selection || ![1, 2, 3].includes(selection.line)) return;
    journeyRequest.mutate({ data: {
      line: selection.line as 1 | 2 | 3,
      origin: selection.origin,
      destination: selection.destination,
      date: selection.date,
      runId: selection.runId,
    } });
    // Fetch published geometry once per selected run, not on every live GPS poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);
  const publishedJourney = journeyRequest.data?.runKey === runKey ? journeyRequest.data : null;
  const tripPickupStops = uniqueStops((publishedJourney?.stops ?? []).filter(stop => stop.kind === 'pickup'));
  const selectedPickupIndex = selection?.pickup
    ? (publishedJourney?.stops.findIndex(stop =>
      stop.kind === 'pickup' && passengerStopIdentity(stop) === passengerStopIdentity(selection.pickup!)) ?? -1)
    : -1;
  const tripDropoffStops = uniqueStops((publishedJourney?.stops ?? []).filter((stop, index) =>
    stop.kind === 'dropoff' && (selectedPickupIndex < 0 || index > selectedPickupIndex)));
  const tripPickupStop = selectedPickupIndex >= 0 ? publishedJourney?.stops[selectedPickupIndex] : undefined;
  const tripDropoffStop = selection?.dropoff && publishedJourney?.stops.find((stop, index) =>
    stop.kind === 'dropoff' && selectedPickupIndex >= 0 && index > selectedPickupIndex
    && passengerStopIdentity(stop) === passengerStopIdentity(selection.dropoff!));
  const hasVerifiedTripStops = Boolean(tripPickupStop && tripDropoffStop);
  useEffect(() => {
    if (!selection || !publishedJourney) return;
    const pickup = selection.pickup ? tripPickupStop : null;
    const dropoff = selection.dropoff ? tripDropoffStop : null;
    if (selection.pickup?.id === pickup?.id && selection.dropoff?.id === dropoff?.id) return;
    const updated = { ...selection,
      pickup: pickup ? { id: pickup.id, label: pickup.label, kind: pickup.kind, lat: pickup.lat, lng: pickup.lng } : null,
      dropoff: dropoff ? { id: dropoff.id, label: dropoff.label, kind: dropoff.kind, lat: dropoff.lat, lng: dropoff.lng } : null,
    };
    setSelection(updated);
    void AsyncStorage.setItem(keys.runSelection, JSON.stringify(updated));
  }, [publishedJourney, selection, tripPickupStop, tripDropoffStop]);
  const transferSearch = useSearchPassengerTransfers();
  const { data: runResponse, error: runError, refetch: refreshRun } = useGetPublicRunPassengerTrip(
    runKey,
    {
      query: {
        refetchInterval: 3000,
        enabled: !!selection,
        queryKey: getGetPublicRunPassengerTripQueryKey(runKey),
      },
    }
  );

  const trip = protectPassengerTripLocation(runResponse?.trip, Boolean(runError));
  const locationVisibility = trip?.locationVisibility ?? 'unavailable';
  const mapData = passengerMapData(trip, Boolean(runResponse?.assigned), clock.getTime());
  const locationConfidence = passengerLocationConfidence(trip, Boolean(runResponse?.assigned), clock.getTime());
  const locationIsLive = locationConfidence.kind === 'live' && Boolean(mapData.liveCoach);
  useEffect(() => {
    if (!mapData.liveCoach || !trip?.locationUpdatedAt) return;
    const expiresAt = new Date(trip.locationUpdatedAt).getTime() + LIVE_GPS_MAX_AGE_MS;
    const timer = setTimeout(() => setClock(new Date()), Math.max(1, expiresAt - Date.now() + 1));
    return () => clearTimeout(timer);
  }, [trip?.locationUpdatedAt, Boolean(mapData.liveCoach)]);
  const publishedMapStops: MapStop[] = (publishedJourney?.stops ?? []).flatMap(stop => {
    const point = validMapPoint(stop);
    if (!point) return [];
    return [{
      ...point,
      id: stop.id,
      label: stop.mapLabel,
      status: trip?.journeyProgress?.find(item => item.id === stop.id)?.status ?? 'upcoming',
    }];
  });
  const mapStops = publishedMapStops.length ? publishedMapStops : mapData.stops;
  const publishedRoute = (publishedJourney?.routeGeometry ?? []).flatMap(point => {
    const valid = validMapPoint(point);
    return valid ? [valid] : [];
  });
  const mapRoute = mapData.route.length > 1 ? mapData.route : publishedRoute;
  const [selectedMapStopId, setSelectedMapStopId] = useState<string | null>(null);
  const mapSelectedStopId = mapStops.some(stop => stop.id === selectedMapStopId) ? selectedMapStopId : null;
  const mapStatus = runError ? 'Offline — live location hidden'
    : mapData.liveCoach ? 'Live coach location'
      : locationVisibility === 'before_departure'
        ? `Live location starts at ${formatTime(trip?.scheduledDepartureAt ?? selection?.scheduledDepartureAt ?? null)}`
        : locationVisibility === 'ended' ? 'Trip complete — no live location'
          : locationVisibility === 'live' && trip?.currentLocation
            ? 'Coach location out of date — live position hidden'
            : 'Live location unavailable';
  const [manualRunRefresh, setManualRunRefresh] = useState(false);
  const refreshSelectedRun = useCallback(async () => {
    if (manualRunRefresh) return;
    setManualRunRefresh(true);
    try {
      const result = await refreshRun();
      if (result.error) {
        setMessage('Refresh failed. Previously loaded trip details are retained; live location is hidden until reconnection. Try again or return to schedules for alternatives.');
      }
    } finally {
      setManualRunRefresh(false);
    }
  }, [manualRunRefresh, refreshRun]);

  // Alert State
  const [deviceId, setDeviceId] = useState('');
  const [alertData, setAlertData] = useState<PassengerAlertResponseAlert | null>(null);
  const [storedSelection, setStoredSelection] = useState<AlertSelection | null>(null);
  const [selectedStop, setSelectedStop] = useState('');
  const [leadTime, setLeadTime] = useState<AlertLeadTime>('time-5m');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [notificationOn, setNotificationOn] = useState(false);
  const [pendingCancellation, setPendingCancellation] = useState<PendingAlertCancellation | null>(null);
  const [message, setMessage] = useState('');

  const registrationInFlight = useRef(false);
  const registrationQueued = useRef<AlertSelection | null>(null);
  const cancellationRequested = useRef(false);
  const lastRegistered = useRef<AlertSelection | null>(null);
  const lastRegisteredState = useRef<string | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setClock(new Date());
        if (!selection) void refreshSchedule();
      }
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [refreshSchedule, selection]);

  useEffect(() => {
    void AsyncStorage.multiGet([
      companionStorageKeys.language,
      companionStorageKeys.largeText,
      companionStorageKeys.reduceMotion,
      companionStorageKeys.favorites,
      companionStorageKeys.recents,
      companionStorageKeys.scheduleCache,
    ]).then(entries => {
      const values = Object.fromEntries(entries);
      const storedLanguage = values[companionStorageKeys.language];
      if (storedLanguage === 'en' || storedLanguage === 'yi' || storedLanguage === 'he') setLanguage(storedLanguage);
      setLargeText(values[companionStorageKeys.largeText] === 'true');
      setReduceMotion(values[companionStorageKeys.reduceMotion] === 'true');
      try { setGuestFavorites(JSON.parse(values[companionStorageKeys.favorites] ?? '[]')); } catch {}
      try { setRecents(JSON.parse(values[companionStorageKeys.recents] ?? '[]')); } catch {}
      try { setSavedSchedules(JSON.parse(values[companionStorageKeys.scheduleCache] ?? '{}')); } catch {}
    });
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!liveSchedule) return;
    setScheduleRefreshError('');
    setSavedSchedules(previous => {
      const next = {
        ...previous,
        [currentScheduleKey]: { key: currentScheduleKey, savedAt: new Date().toISOString(), schedule: liveSchedule },
      };
      void AsyncStorage.setItem(companionStorageKeys.scheduleCache, JSON.stringify(next));
      return next;
    });
  }, [currentScheduleKey, liveSchedule]);

  useEffect(() => {
    if (scheduleError && showingSavedSchedule) {
      setScheduleRefreshError('Refresh failed. The saved schedule is still shown.');
    } else if (scheduleError) {
      setScheduleRefreshError('Schedule refresh failed. Check your connection and try again.');
    }
  }, [scheduleError, showingSavedSchedule]);

  const restoreDeepLink = useCallback((url: string | null) => {
    if (!url) return;
    const restored = decodeRunLink(url);
    if (!restored) return;
    const originName = LOCATIONS.find(item => item.id === restored.origin)?.name ?? 'Origin';
    const destinationName = LOCATIONS.find(item => item.id === restored.destination)?.name ?? 'Destination';
    setLine(restored.line);
    setOrigin(restored.origin);
    setDestination(restored.destination);
    setDate(restored.date);
    setExactStops({
      scope: `${restored.date}|${restored.line}|${restored.origin}|${restored.destination}`,
      pickup: restored.pickup,
      dropoff: restored.dropoff,
    });
    const restoredSelection = { ...restored, summary: `${originName} to ${destinationName}` };
    setSelection(restoredSelection);
    setTripView('details');
    void AsyncStorage.setItem(keys.runSelection, JSON.stringify(restoredSelection));
  }, []);

  useEffect(() => {
    void Linking.getInitialURL().then(restoreDeepLink);
    const subscription = Linking.addEventListener('url', event => restoreDeepLink(event.url));
    return () => subscription.remove();
  }, [restoreDeepLink]);

  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.multiGet([keys.runSelection, keys.device, keys.alert, keys.cancellation]);
      const savedSelection = stored[0][1];
      const savedDevice = stored[1][1];
      const savedAlert = stored[2][1];
      const savedCancellation = stored[3][1];

      const id = savedDevice || `passenger-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setDeviceId(id);
      if (!savedDevice) await AsyncStorage.setItem(keys.device, id);

      const cancellation = parsePendingAlertCancellation(savedCancellation);
      if (savedCancellation && !cancellation) await AsyncStorage.removeItem(keys.cancellation);

      if (cancellation) {
        await AsyncStorage.removeItem(keys.alert);
        if (cancellation.leaveSession) await AsyncStorage.removeItem(keys.runSelection);
        cancellationRequested.current = true;
        setPendingCancellation(cancellation);
      }

      if (savedSelection && (!cancellation || !cancellation.leaveSession)) {
         try {
           const restored = JSON.parse(savedSelection) as RunSelection;
           setSelection(restored);
            setTripView('details');
           setExactStops({
             scope: `${restored.date}|${restored.line}|${restored.origin}|${restored.destination}`,
             pickup: restored.pickup ?? null,
             dropoff: restored.dropoff ?? null,
           });
         } catch {}
      }

      if (!cancellation && savedAlert) {
         try { setStoredSelection(JSON.parse(savedAlert)); }
         catch { await AsyncStorage.removeItem(keys.alert); }
      }
    })();
  }, []);

  useEffect(() => {
    if (runError) {
      setMessage('Connection lost. Live location hidden until reconnected.');
    } else {
      setMessage(m => m === 'Connection lost. Live location hidden until reconnected.' ? '' : m);
    }
  }, [runError]);

  useEffect(() => {
    if (!selection || !trip?.scheduledDepartureAt
        || selection.scheduledDepartureAt === trip.scheduledDepartureAt) return;
    const updatedSelection = {
      ...selection,
      scheduledDepartureAt: trip.scheduledDepartureAt,
    };
    setSelection(updatedSelection);
    void AsyncStorage.setItem(keys.runSelection, JSON.stringify(updatedSelection));
  }, [selection, trip?.scheduledDepartureAt]);

  useEffect(() => {
    if (!pendingCancellation) return;
    let cancelled = false;
    let inFlight = false;
    const retry = async () => {
      if (inFlight) return;
      inFlight = true;
      const succeeded = await retryPendingAlertCancellation(
        pendingCancellation,
        async () => {
          while (registrationInFlight.current) {
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
        },
        deletePassengerAlert,
        () => AsyncStorage.removeItem(keys.cancellation),
      );
      if (succeeded && !cancelled) {
        cancellationRequested.current = false;
        setPendingCancellation(null);
      }
      inFlight = false;
    };
    void retry();
    const timer = setInterval(() => { void retry(); }, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pendingCancellation]);

  const registerSelection = useCallback(async (selection: AlertSelection) => {
    if (cancellationRequested.current) return;
    registrationQueued.current = selection;
    if (registrationInFlight.current) return;
    registrationInFlight.current = true;
    try {
      while (registrationQueued.current && !cancellationRequested.current) {
        const next = registrationQueued.current;
        registrationQueued.current = null;
        const permission = await Notifications.getPermissionsAsync();
        if (!permission.granted) throw new Error('Notification permission was denied.');
        const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
        if (!projectId) throw new Error('No Expo project ID is configured.');
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        const result = await putPassengerAlert(alertPayload(next, deviceId, token));

        if (cancellationRequested.current) continue;
        lastRegistered.current = next;
        lastRegisteredState.current = result.alert.state;
        setAlertData(result.alert);

        if (result.alert.state === 'delivered' || result.alert.state === 'expired') {
          await AsyncStorage.removeItem(keys.alert);
          setStoredSelection(null);
          setAlertData(null);
        } else {
          await AsyncStorage.setItem(keys.alert, JSON.stringify(next));
        }
        setMessage(m => m === 'Connection lost. Live location hidden until reconnected.' ? m : '');
      }
    } catch (error) {
      registrationQueued.current = null;
      if (!cancellationRequested.current) {
        setNotificationOn(false); setAlertData(null);
        setMessage(error instanceof Error ? error.message : 'Could not register notifications.');
      }
    } finally { registrationInFlight.current = false; }
  }, [deviceId]);

  useEffect(() => {
    if (!trip || !deviceId || !storedSelection || notificationOn) return;
    if (!publishedJourney || !hasVerifiedTripStops) return;
    if (!isRestorableAlert(storedSelection, trip)) {
      void AsyncStorage.removeItem(keys.alert); setStoredSelection(null); return;
    }
    setSelectedStop(storedSelection.selectedStopId);
    setLeadTime(storedSelection.leadTime);
    setSoundEnabled(storedSelection.soundEnabled);
    void registerSelection(storedSelection).then(() => {
      if (lastRegistered.current === storedSelection
          && lastRegisteredState.current !== 'delivered' && lastRegisteredState.current !== 'expired') {
        setNotificationOn(true);
      }
    });
  }, [trip, deviceId, storedSelection, notificationOn, registerSelection, publishedJourney, hasVerifiedTripStops]);

  const changeAlertSelection = (
    nextStop: string,
    nextLead: AlertSelection['leadTime'],
    nextSoundEnabled = soundEnabled,
  ) => {
    setSelectedStop(nextStop); setLeadTime(nextLead);
    setSoundEnabled(nextSoundEnabled);
    if (notificationOn && trip) {
      void registerSelection(makeAlertSelection(trip, nextStop, nextLead, nextSoundEnabled));
    }
  };

  const requestAlert = async (enabled: boolean) => {
    if (!enabled) {
      if (trip?.passengerCode && deviceId) {
        cancellationRequested.current = true;
        registrationQueued.current = null;
        const cancellation = makePendingAlertCancellation(trip.passengerCode, deviceId, false);
        await AsyncStorage.setItem(keys.cancellation, JSON.stringify(cancellation));
        setPendingCancellation(cancellation);
        setNotificationOn(false); setAlertData(null); setStoredSelection(null);
        await AsyncStorage.removeItem(keys.alert);
        return;
      }
      setNotificationOn(false); setAlertData(null); setStoredSelection(null); await AsyncStorage.removeItem(keys.alert); return;
    }
    if (!hasVerifiedTripStops) {
      setMessage('Choose your exact pickup and drop-off before setting a stop alert.');
      setNotificationOn(false);
      return;
    }
    if (!trip?.passengerCode) {
      setMessage('Stop alerts are available once a coach is assigned to this run.');
      setNotificationOn(false);
      return;
    }
    if (pendingCancellation) { setMessage('Offline. Cannot register alert.'); setNotificationOn(false); return; }
    setNotificationOn(enabled);
    if (!selectedStop) { setMessage('Select a stop first'); setNotificationOn(false); return; }
    if (Platform.OS !== 'web' && !Device.isDevice) { setMessage('Notifications require a physical device.'); setNotificationOn(false); return; }
    const permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) { setMessage('Notification permission was denied.'); setNotificationOn(false); return; }
    await registerSelection(makeAlertSelection(trip!, selectedStop, leadTime, soundEnabled));
  };

  const leave = async () => {
    setTripView('details');
    if (trip?.passengerCode && deviceId) {
      cancellationRequested.current = true;
      registrationQueued.current = null;
      const cancellation = makePendingAlertCancellation(trip.passengerCode, deviceId, true);
      await AsyncStorage.setItem(keys.cancellation, JSON.stringify(cancellation));
      setPendingCancellation(cancellation);
    }
    await AsyncStorage.multiRemove([keys.runSelection, keys.alert]);
    setStoredSelection(null);
    setNotificationOn(false);
    setAlertData(null);
    setSelectedStop('');
    setSelectedMapStopId(null);
    setSelection(null);
  };

  const availableLocations = useMemo(
    () => locModal === 'origin'
      ? LOCATIONS.filter((location) => location.lines.includes(line))
      : LOCATIONS.filter((location) => destinationIds(line, origin).includes(location.id)),
    [line, locModal, origin],
  );

  const today = getNewYorkServiceDate(clock);
  const viewingAllDepartures = date < today || showAllDepartures;
  const visibleRuns: OfficialScheduleRun[] = useMemo(
    () => date < today || showAllDepartures
      ? (schedule?.runs ?? [])
      : getUpcomingScheduleRuns(schedule?.runs ?? [], date, clock),
    [clock, date, schedule?.runs, showAllDepartures, today],
  );
  const exactStopScope = `${date}|${line}|${origin}|${destination}`;
  const selectedPickup = exactStops.scope === exactStopScope ? exactStops.pickup : null;
  const selectedDropoff = exactStops.scope === exactStopScope ? exactStops.dropoff : null;
  const exactRunStops = useExactRunStops({
    runs: visibleRuns,
    date,
    line,
    origin,
    destination,
    pickup: selectedPickup,
    dropoff: selectedDropoff,
  });
  const filteredVisibleRuns = selectedPickup || selectedDropoff
    ? exactRunStops.filteredRuns
    : visibleRuns;
  const selectedRunDisruptions = selection
    ? schedule?.runs.find(run => run.id === selection.runId)?.disruptions
    : undefined;
  const calendarDays = useMemo(() => calendarDates(calendarMonth), [calendarMonth]);

  const chooseDate = (nextDate: string) => {
    setDate(nextDate);
    setPlannerMessage('');
    setCalendarVisible(false);
  };

  const openTishreiSchedule = async () => {
    if (scheduleDownloadBusy) return;
    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    if (!domain && Platform.OS !== 'web') {
      setScheduleDownloadMessage('The schedule download is unavailable because the app server is not configured.');
      return;
    }
    const scheduleUrl = domain
      ? `https://${domain}${TISHREI_SCHEDULE_PATH}`
      : `${globalThis.location?.origin ?? ''}${TISHREI_SCHEDULE_PATH}`;
    setScheduleDownloadBusy(true);
    setScheduleDownloadMessage('');
    try {
      await Linking.openURL(scheduleUrl);
    } catch {
      setScheduleDownloadMessage('Could not open the schedule PDF. Check your connection and try again.');
    } finally {
      setScheduleDownloadBusy(false);
    }
  };

  const handleSelectRun = (run: OfficialScheduleRun) => {
    const selectedAt = new Date();
    setClock(selectedAt);
    const originName = LOCATIONS.find(l => l.id === origin)?.name || 'Origin';
    const destName = LOCATIONS.find(l => l.id === destination)?.name || 'Destination';
    const summary = run.dropoffDescription.includes('Continues to')
      ? `${originName} to Manhattan → Boro Park`
      : `${originName} to ${destName}`;
    const scheduledDepartureAt = getScheduledDepartureInstant(date, run.scheduledTime)?.toISOString() ?? null;
    const newSelection = {
      date, line, origin, destination, runId: run.id, summary, scheduledDepartureAt, scheduledTime: run.scheduledTime,
      pickup: selectedPickup,
      dropoff: selectedDropoff,
    };
    setSelectedMapStopId(null);
    setSelection(newSelection);
    setTripView('details');
    void AsyncStorage.setItem(keys.runSelection, JSON.stringify(newSelection));
    const choice = {
      line, origin, destination, label: `${originName} → ${destName}`,
      pickup: selectedPickup,
      dropoff: selectedDropoff,
    };
    setRecents(previous => {
      const next = prependUniqueChoice(previous, choice);
      void AsyncStorage.setItem(companionStorageKeys.recents, JSON.stringify(next));
      return next;
    });
  };

  const updateTripStops = (pickup: StopChoice | null, dropoff: StopChoice | null) => {
    if (!selection || notificationOn) return;
    const updated = { ...selection, pickup, dropoff };
    setSelection(updated);
    setExactStops({ scope: `${selection.date}|${selection.line}|${selection.origin}|${selection.destination}`, pickup, dropoff });
    setSelectedStop('');
    setMessage('');
    void AsyncStorage.setItem(keys.runSelection, JSON.stringify(updated));
  };

  const applyRouteChoice = (choice: RouteChoice) => {
    setLine(choice.line);
    setOrigin(choice.origin);
    setDestination(choice.destination);
    setExactStops({
      scope: `${date}|${choice.line}|${choice.origin}|${choice.destination}`,
      pickup: choice.pickup ?? null,
      dropoff: choice.dropoff ?? null,
    });
    setPlannerMessage('');
  };

  const currentRouteChoice: RouteChoice = {
    line,
    origin,
    destination,
    label: `${LOCATIONS.find(item => item.id === origin)?.name ?? 'Origin'} → ${LOCATIONS.find(item => item.id === destination)?.name ?? 'Destination'}`,
    pickup: selectedPickup,
    dropoff: selectedDropoff,
  };
  const isFavorite = favorites.some(item => routeChoiceKey(item) === routeChoiceKey(currentRouteChoice));
  const rtl = isRtlLanguage(language);
  const nextLiveStop = trip?.journeyProgress?.find(stop => stop.status !== 'completed')
    ?? trip?.upcomingStops?.[0];
  const nextLiveStopLabel = nextLiveStop
    ? ('address' in nextLiveStop ? nextLiveStop.address : nextLiveStop.label)
    : null;

  const refreshScheduleHonestly = async () => {
    const result = await refreshSchedule();
    if (result.error) {
      setScheduleRefreshError(schedule ? 'Refresh failed. The schedule already on screen was retained.' : 'Schedule refresh failed. Check your connection and try again.');
    } else {
      setScheduleRefreshError('');
    }
  };

  const shareExactRun = async () => {
    if (!selection) return;
    const url = encodeRunLink(selection);
    try {
      await Share.share({
        title: selection.summary,
        message: `${selection.summary} · ${formatDate(selection.date)} · scheduled ${formatTime(selection.scheduledDepartureAt ?? null)}${selection.pickup && selection.dropoff ? `\n${selection.pickup.label} → ${selection.dropoff.label}` : ''}\n${url}`,
        url,
      });
      setShareMessage(selection.pickup && selection.dropoff ? 'Exact run link ready to share.' : 'Trip link ready to share. Boarding stops are not selected.');
    } catch {
      setShareMessage('Could not open sharing. You can try again.');
    }
  };

  const boardingPoint = hasVerifiedTripStops && tripPickupStop ? validMapPoint(tripPickupStop) : null;
  const boardingStop = hasVerifiedTripStops && tripPickupStop
    ? boardingPoint
      ? { label: tripPickupStop.label, lat: boardingPoint.latitude, lng: boardingPoint.longitude, verified: true }
      : { label: tripPickupStop.label, verified: false }
    : undefined;
  const openBoardingDirections = async () => {
    if (!boardingStop?.verified || boardingStop.lat === undefined || boardingStop.lng === undefined) {
      setShareMessage('Verified boarding coordinates are not available for this stop.');
      return;
    }
    const label = boardingStop.label;
    const coordinates = `${boardingStop.lat},${boardingStop.lng}`;
    const url = Platform.select({
      ios: `http://maps.apple.com/?daddr=${coordinates}&q=${encodeURIComponent(label)}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${coordinates}`,
    })!;
    try {
      await Linking.openURL(url);
    } catch {
      setShareMessage('Could not open maps. Check that a maps app is available.');
    }
  };

  const openFromMore = (target: 'service' | 'coach' | 'contact' | 'settings') => {
    setMoreVisible(false);
    // Native sheets need to finish dismissing before another sheet is presented.
    setTimeout(() => {
      if (target === 'settings') setPreferencesVisible(true);
      else setInformationMode(target);
    }, 350);
  };
  const moreMenu = moreVisible ? (
    <MoreMenu
      language={language}
      onClose={() => setMoreVisible(false)}
      onService={() => openFromMore('service')}
      onCoach={() => openFromMore('coach')}
      onContact={() => openFromMore('contact')}
      onSchedule={() => void openTishreiSchedule()}
      scheduleBusy={scheduleDownloadBusy}
      scheduleError={scheduleDownloadMessage}
      onSettings={() => openFromMore('settings')}
      guestSavedRouteCount={unimportedGuestCount}
      onImportGuestRoutes={() => void importGuestFavorites()}
      importBusy={journeysUnavailable}
      syncError={journeySyncError}
      onRefreshJourneys={() => void refreshJourneys()}
    />
  ) : null;
  const informationSheet = informationMode ? (
    <ServiceInformation
      key={informationMode}
      mode={informationMode}
      language={language}
      selectedRun={!!selection}
      announcements={runError ? undefined : trip?.announcements}
      announcementsUnavailable={Boolean(runError)}
      onClose={() => setInformationMode(null)}
    />
  ) : null;

  if (!selection) {
    return (
      <View style={styles.root}>
        <View style={[styles.plannerHeader, { paddingTop: Math.max(insets.top, Platform.OS === 'web' ? 67 : 20) + 12, backgroundColor: theme.secondary }]}>
          <View style={styles.plannerBrandRow}>
            <Image source={require('@/assets/images/monsey-trails-logo.png')} style={styles.plannerBrandLogo} tintColor={theme.secondaryForeground} resizeMode="contain" accessibilityLabel="Monsey Trails" />
            <Pressable onPress={() => setMoreVisible(true)} style={styles.headerIconButton}
              accessibilityRole="button" accessibilityLabel="More information" testID="open-more-menu">
              <Feather name="menu" size={22} color={theme.secondaryForeground} />
            </Pressable>
            <Pressable
              onPress={() => setPreferencesVisible(true)}
              style={styles.headerIconButton}
              accessibilityRole="button"
              accessibilityLabel={passengerCopy(language, 'settings')}
              testID="open-accessibility-settings"
            >
              <Feather name="settings" size={22} color={theme.secondaryForeground} />
            </Pressable>
          </View>
           <AppText style={[styles.plannerTitle, { fontSize: largeText ? 32 : 27, textAlign: rtl ? 'right' : 'left', color: theme.secondaryForeground }]}>{passengerCopy(language, 'where')}</AppText>
        </View>

        <Surface variant="card" style={styles.searchCard}>
           <Pressable style={styles.searchRow} onPress={() => { if (Platform.OS !== 'web') Haptics.selectionAsync(); setLocModal('origin'); }}>
              <View style={[styles.searchDot, { backgroundColor: theme.success }]} />
              <AppText style={styles.searchText}>{LOCATIONS.find(l => l.id === origin)?.name || 'Origin'}</AppText>
           </Pressable>
           <View style={styles.searchDivider} />
           <Pressable style={styles.searchRow} onPress={() => { if (Platform.OS !== 'web') Haptics.selectionAsync(); setLocModal('destination'); }}>
              <View style={[styles.searchDot, { backgroundColor: theme.arrival }]} />
              <AppText style={styles.searchText}>{LOCATIONS.find(l => l.id === destination)?.name || 'Destination'}</AppText>
           </Pressable>
           <Pressable style={[styles.swapButton, { backgroundColor: theme.primary }]} onPress={() => { if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); const temp = origin; setOrigin(destination); setDestination(temp); }}>
              <Feather name="repeat" size={18} color={theme.primaryForeground} />
           </Pressable>
        </Surface>

        <View style={styles.lineSelector} accessibilityLabel="Choose a bus line">
          {LINES.map((item) => (
            <Pressable
              key={item.id}
              style={[styles.lineChip, line === item.id && styles.lineChipSelected]}
              accessibilityRole="tab"
              accessibilityState={{ selected: line === item.id }}
              accessibilityLabel={item.name}
              testID={`line-${item.id}`}
              onPress={() => {
                const defaults = item.id === 3 ? [7, 9] : item.id === 2 ? [2, 10] : [2, 5];
                setLine(item.id);
                setOrigin(defaults[0]);
                setDestination(defaults[1]);
              }}
            >
              <AppText style={[styles.lineChipText, line === item.id && styles.lineChipTextSelected]}>{item.name}</AppText>
            </Pressable>
          ))}
        </View>

        <Pressable
          style={styles.dateSelector}
          onPress={() => {
            setCalendarMonth(date.slice(0, 7));
            setCalendarVisible(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Choose travel date, currently ${formatDate(date)}`}
          testID="open-calendar"
        >
           <Feather name="calendar" size={20} color={theme.primary}/>
           <AppText style={styles.dateText}>{formatDate(date)}</AppText>
           <Feather name="chevron-down" size={20} color={theme.primary}/>
        </Pressable>

        <ScrollView style={styles.runsList} contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 40) }}>
           {(favorites.length > 0 || recents.length > 0) ? (
             <View style={styles.savedRoutes}>
               {favorites.length > 0 ? <AppText style={styles.savedRoutesTitle}>{passengerCopy(language, 'favorites')}</AppText> : null}
               <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.savedRouteRow}>
                 {favorites.map(choice => (
                   <Pressable key={`favorite-${routeChoiceKey(choice)}`} onPress={() => applyRouteChoice(choice)} style={styles.savedRouteChip}>
                     <Feather name="star" size={14} color={theme.primary} />
                     <AppText style={styles.savedRouteText}>{choice.label}{choice.pickup && choice.dropoff ? ` · ${choice.pickup.label} → ${choice.dropoff.label}` : ''}</AppText>
                   </Pressable>
                 ))}
                 {recents.filter(choice => !favorites.some(favorite => routeChoiceKey(favorite) === routeChoiceKey(choice))).map(choice => (
                   <Pressable key={`recent-${routeChoiceKey(choice)}`} onPress={() => applyRouteChoice(choice)} style={styles.savedRouteChip}>
                     <Feather name="clock" size={14} color={theme.mutedForeground} />
                     <AppText style={styles.savedRouteText}>{choice.label}{choice.pickup && choice.dropoff ? ` · ${choice.pickup.label} → ${choice.dropoff.label}` : ''}</AppText>
                   </Pressable>
                 ))}
               </ScrollView>
             </View>
           ) : null}
           {showingSavedSchedule ? (
             <AppText style={styles.staleNotice}>
               {passengerCopy(language, 'stale')} · saved {cachedSchedule ? new Date(cachedSchedule.savedAt).toLocaleString() : ''}
             </AppText>
           ) : null}
           {scheduleRefreshError ? (
             <Surface variant="card" style={styles.refreshFailure} accessibilityRole="alert">
               <AppText style={styles.refreshFailureText}>{scheduleRefreshError}</AppText>
               <AppText style={styles.refreshAlternative}>{passengerCopy(language, 'alternatives')}</AppText>
               <Pressable onPress={refreshScheduleHonestly} style={styles.retryButton} disabled={fetchingSchedule}>
                 <Feather name="refresh-cw" size={16} color={theme.primaryForeground} />
                 <AppText style={styles.retryButtonText}>{passengerCopy(language, 'retry')}</AppText>
               </Pressable>
             </Surface>
           ) : null}
           {plannerMessage ? <AppText style={styles.plannerMessage} accessibilityRole="alert">{plannerMessage}</AppText> : null}
            <View style={styles.scheduleSourceRow}>
              <AppText style={styles.scheduleUpdatedText}>
                {showingSavedSchedule
                  ? `Saved schedule${cachedSchedule ? ` · ${new Date(cachedSchedule.savedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}`
                  : schedule?.fetchedAt
                    ? `Schedule updated ${new Date(schedule.fetchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
                    : 'Schedule status unavailable'}
              </AppText>
              <Pressable onPress={refreshScheduleHonestly} disabled={fetchingSchedule}
                style={styles.refreshAction} accessibilityRole="button"
                accessibilityLabel="Refresh schedule">
                <Feather name="refresh-cw" size={16} color={theme.secondary} />
                <AppText style={styles.refreshActionText}>{fetchingSchedule ? 'Refreshing…' : 'Refresh'}</AppText>
              </Pressable>
            </View>
           {visibleRuns.length ? (
             <Pressable onPress={() => setFiltersExpanded(value => !value)}
               style={styles.filterToggle} accessibilityRole="button"
               accessibilityState={{ expanded: filtersExpanded }}
               testID="toggle-exact-stop-filters">
               <Feather name="sliders" size={18} color={theme.secondary} />
               <AppText style={styles.filterToggleText}>
                 {selectedPickup || selectedDropoff ? 'Exact stop filters active' : 'Filter by exact stops'}
               </AppText>
               <Feather name={filtersExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.secondary} />
             </Pressable>
           ) : null}
           {visibleRuns.length && filtersExpanded ? (
             <ExactStopSelectors
               pickup={selectedPickup}
               dropoff={selectedDropoff}
                originName={LOCATIONS.find(location => location.id === origin)?.name}
                destinationName={LOCATIONS.find(location => location.id === destination)?.name}
               pickupStops={exactRunStops.pickupStops}
               dropoffStops={exactRunStops.dropoffStops}
               loading={exactRunStops.loading}
               error={exactRunStops.error}
               onPickup={(pickup) => {
                 setExactStops({ scope: exactStopScope, pickup, dropoff: null });
                 setPlannerMessage('');
               }}
               onDropoff={(dropoff) => {
                 setExactStops({ scope: exactStopScope, pickup: selectedPickup, dropoff });
                 setPlannerMessage('');
               }}
             />
           ) : null}
            {schedule?.runs.length ? (
              <Surface variant="glass" glassProps={{ glassEffectStyle: 'regular' }} style={styles.departureToggle}>
                <View style={styles.departureToggleRow} accessibilityLabel="Departure view">
                  {([false, true] as const).map(all => (
                    <Pressable key={String(all)} onPress={() => setShowAllDepartures(all)}
                      disabled={date < today && !all}
                      style={[styles.departureToggleButton, viewingAllDepartures === all && styles.departureToggleSelected]}
                      accessibilityRole="tab" accessibilityState={{ selected: viewingAllDepartures === all, disabled: date < today && !all }}
                      testID={all ? 'all-departures' : 'upcoming-departures'}>
                      <AppText style={[styles.departureToggleText, viewingAllDepartures === all && styles.departureToggleTextSelected]}>
                        {all ? 'All departures' : 'Upcoming'}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              </Surface>
            ) : null}
           {fetchingSchedule && !schedule ? (
              <View style={styles.emptyStateContainer}>
                <Feather name="loader" size={32} color={theme.mutedForeground} style={{ marginBottom: 12 }} />
                <AppText style={styles.emptyText}>Finding routes...</AppText>
              </View>
            ) : filteredVisibleRuns.length ? (
                filteredVisibleRuns.map((run, index) => (
                 <View key={run.id}>
                   <ScheduleRunCard
                     run={run}
                     verifiedJourney={exactRunStops.runStops.find(item => item.run.id === run.id)?.journey}
                      canSelect
                      offline={showingSavedSchedule}
                      stale={scheduleStatusStale}
                     serviceDate={date}
                     formatTime={formatTime}
                     language={language}
                     largeText={largeText}
                     legend={schedule?.keyLegend ?? []}
                     onSelect={() => handleSelectRun(run)}
                   />
                   <DisruptionNotices notices={run.disruptions} theme={theme} styles={styles} />
                    {index === 0 && line === 1 ? (
                      <Surface variant="card" style={styles.scheduleDownloadCard}>
                        <AppText style={styles.scheduleDownloadTitle}>Tishrei 2026 New York Line schedule</AppText>
                        <AppText style={styles.scheduleDownloadDate}>September 11–October 8, 2026</AppText>
                        <Pressable style={styles.scheduleDownloadButton} onPress={openTishreiSchedule}
                          disabled={scheduleDownloadBusy} accessibilityRole="button"
                          accessibilityLabel="Download Tishrei 2026 New York Line schedule PDF"
                          testID="download-tishrei-schedule">
                          <Feather name="download" size={18} color={theme.secondaryForeground} />
                          <AppText style={styles.scheduleDownloadButtonText}>
                            {scheduleDownloadBusy ? 'Opening PDF…' : 'Download schedule PDF'}
                          </AppText>
                        </Pressable>
                        {scheduleDownloadMessage ? <AppText style={styles.scheduleDownloadError} accessibilityRole="alert">{scheduleDownloadMessage}</AppText> : null}
                      </Surface>
                    ) : null}
                 </View>
               ))
             ) : (selectedPickup || selectedDropoff) && !exactRunStops.loading ? (
                <View style={styles.emptyStateContainer}>
                  <Feather name="map-pin" size={32} color={theme.mutedForeground} style={{ marginBottom: 12 }} />
                  <AppText style={styles.emptyText}>No published trip serves the selected stop combination. Choose a different stop.</AppText>
                </View>
            ) : schedule?.runs.length && date === today ? (
               <View style={styles.emptyStateContainer}>
                  <Feather name="clock" size={32} color={theme.mutedForeground} style={{ marginBottom: 12 }} />
                  <AppText style={styles.emptyText}>No departures remaining today.</AppText>
               </View>
           ) : date < today ? (
               <View style={styles.emptyStateContainer}>
                  <Feather name="calendar" size={32} color={theme.mutedForeground} style={{ marginBottom: 12 }} />
                  <AppText style={styles.emptyText}>This date has passed. Choose today or a future date.</AppText>
               </View>
           ) : (
               <View style={styles.emptyStateContainer}>
                  <Feather name="info" size={32} color={theme.mutedForeground} style={{ marginBottom: 12 }} />
                  <AppText style={styles.emptyText}>No service is scheduled for this date and location.</AppText>
               </View>
           )}
            {line === 1 && !filteredVisibleRuns.length ? (
              <Pressable style={styles.pdfLink} onPress={openTishreiSchedule} disabled={scheduleDownloadBusy}
                accessibilityRole="button" accessibilityLabel="Download Tishrei 2026 New York Line schedule PDF"
                testID="download-tishrei-schedule">
                <Feather name="download" size={16} color={theme.secondary} />
                <AppText style={styles.refreshActionText}>Download schedule PDF</AppText>
              </Pressable>
            ) : null}
            {schedule?.runs.length ? (
              <Surface variant="card" style={styles.keysCard}>
                <Pressable style={styles.keysHeader} onPress={() => setKeysExpanded(value => !value)}
                  accessibilityRole="button" accessibilityLabel="Schedule key meanings"
                  accessibilityState={{ expanded: keysExpanded }}>
                  <AppText style={styles.keysTitle}>Schedule key meanings</AppText>
                  <Feather name={keysExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.primary} />
                </Pressable>
                {keysExpanded ? schedule.keyLegend?.map(({ key, meaning }) => (
                  <View key={key} style={styles.keyLegendRow}>
                    <View style={styles.keyBadge}><AppText style={styles.keyBadgeText}>{key}</AppText></View>
                    <AppText style={styles.keyMeaning}>{meaning}</AppText>
                  </View>
                )) : null}
              </Surface>
            ) : null}
            <Pressable
              onPress={() => {
                if (!selectedPickup || !selectedDropoff) {
                  setFiltersExpanded(true);
                  setPlannerMessage('Choose exact pickup and drop-off stops before saving a boarding route.');
                  return;
                }
                void toggleSavedJourney(currentRouteChoice);
              }}
              disabled={journeysUnavailable}
              style={[styles.saveRouteAction, journeysUnavailable && { opacity: 0.5 }]} accessibilityRole="button"
              accessibilityState={{ selected: isFavorite, disabled: journeysUnavailable }}
              accessibilityLabel={passengerCopy(language, 'favorite')}>
              <Feather name="star" size={17} color={isFavorite ? theme.arrival : theme.secondary} />
              <AppText style={styles.refreshActionText}>{journeysLoading ? 'Loading saved journeys…' : isFavorite ? (accountSubject ? 'Saved across devices' : 'Saved on this phone') : 'Save boarding route'}</AppText>
            </Pressable>
            {journeySyncError && accountSubject ? (
              <Pressable onPress={() => void refreshJourneys()} accessibilityRole="button" accessibilityLabel="Retry saved journeys sync">
                <AppText style={styles.statusSub}>{journeySyncError} Tap to retry.</AppText>
              </Pressable>
            ) : null}
        </ScrollView>

        {moreMenu}
        {informationSheet}
        <Modal
          visible={calendarVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setCalendarVisible(false)}
        >
          <Surface variant="glass" glassProps={{ glassEffectStyle: 'regular' }} style={styles.calendarOverlay}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setCalendarVisible(false)}
              accessibilityRole="button"
              accessibilityLabel="Close calendar"
            />
            <Surface
              variant="card"
              style={styles.calendarCard}
              accessibilityViewIsModal
              accessibilityLabel="Travel date calendar"
            >
              <View style={styles.calendarTopRow}>
                <Pressable
                  style={styles.calendarIconButton}
                  onPress={() => setCalendarMonth(shiftCalendarMonth(calendarMonth, -1))}
                  accessibilityRole="button"
                  accessibilityLabel="Previous month"
                >
                   <Feather name="chevron-left" size={24} color={theme.primary} />
                </Pressable>
                <AppText style={styles.calendarTitle} accessibilityRole="header">{formatCalendarMonth(calendarMonth)}</AppText>
                <Pressable
                  style={styles.calendarIconButton}
                  onPress={() => setCalendarMonth(shiftCalendarMonth(calendarMonth, 1))}
                  accessibilityRole="button"
                  accessibilityLabel="Next month"
                >
                  <Feather name="chevron-right" size={24} color={theme.primary} />
                </Pressable>
              </View>
              <View style={styles.weekRow}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, index) => (
                  <AppText key={`${label}-${index}`} style={styles.weekday}>{label}</AppText>
                ))}
              </View>
              <View style={styles.calendarGrid}>
                {calendarDays.map((calendarDate, index) => {
                  if (!calendarDate) return <View key={`blank-${index}`} style={styles.calendarDay} />;
                   const disabled = false;
                  const selected = calendarDate === date;
                  const isToday = calendarDate === today;
                  return (
                    <Pressable
                      key={calendarDate}
                      style={[
                        styles.calendarDay,
                        selected && styles.calendarDaySelected,
                        isToday && !selected && styles.calendarDayToday,
                      ]}
                      onPress={() => chooseDate(calendarDate)}
                      disabled={disabled}
                      accessibilityRole="button"
                      accessibilityLabel={new Date(`${calendarDate}T12:00:00`).toLocaleDateString('en-US', {
                        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
                      })}
                      accessibilityState={{ disabled, selected }}
                      testID={`calendar-day-${calendarDate}`}
                    >
                      <AppText style={[
                        styles.calendarDayText,
                        disabled && styles.calendarDayTextDisabled,
                        selected && styles.calendarDayTextSelected,
                      ]}>
                        {Number(calendarDate.slice(-2))}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.calendarActions}>
                <Pressable
                  onPress={() => {
                    setCalendarMonth(getNewYorkServiceDate().slice(0, 7));
                    chooseDate(getNewYorkServiceDate());
                  }}
                  style={styles.todayButton}
                  accessibilityRole="button"
                  accessibilityLabel="Choose today"
                  testID="calendar-today"
                >
                  <Feather name="crosshair" size={16} color={theme.primary} />
                  <AppText style={styles.todayButtonText}>Today</AppText>
                </Pressable>
                <Pressable
                  onPress={() => setCalendarVisible(false)}
                  style={styles.calendarCloseButton}
                  accessibilityRole="button"
                  accessibilityLabel="Close calendar"
                >
                  <AppText style={styles.calendarCloseText}>Close</AppText>
                </Pressable>
              </View>
            </Surface>
          </Surface>
        </Modal>

        <Modal visible={!!locModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setLocModal(null)}>
           <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
              <View style={[styles.modalHeader, { backgroundColor: theme.card, borderColor: theme.border }]}>
                 <AppText style={[styles.modalTitle, { color: theme.foreground }]}>Select {locModal === 'origin' ? 'Origin' : 'Destination'}</AppText>
                 <Pressable onPress={() => { if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setLocModal(null); }} style={({ pressed }) => [styles.modalCloseBtn, pressed && { opacity: 0.5 }]}>
                    <AppText style={[styles.modalClose, { color: theme.primary }]}>Done</AppText>
                 </Pressable>
              </View>
              <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
                  {availableLocations.map(loc => (
                    <Pressable key={loc.id} style={({ pressed }) => [{ minHeight: 60, paddingHorizontal: 20, borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, pressed && { backgroundColor: theme.muted }]} onPress={() => {
                        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        if (locModal === 'origin') {
                          setOrigin(loc.id);
                          const validDestinations = destinationIds(line, loc.id);
                          if (!validDestinations.includes(destination)) setDestination(validDestinations[0]);
                        }
                       else setDestination(loc.id);
                       setLocModal(null);
                    }}>
                       <AppText style={{ fontSize: 16, fontWeight: '600', color: theme.foreground }}>{loc.name}</AppText>
                       {((locModal === 'origin' ? origin : destination) === loc.id) && <Feather name="check" size={20} color={theme.primary} />}
                    </Pressable>
                 ))}
              </ScrollView>
           </SafeAreaView>
        </Modal>
        <Modal visible={preferencesVisible} animationType={reduceMotion ? 'none' : 'slide'} presentationStyle="formSheet" onRequestClose={() => setPreferencesVisible(false)}>
          <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
            <View style={[styles.modalHeader, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <AppText style={[styles.modalTitle, { color: theme.foreground }]}>{passengerCopy(language, 'settings')}</AppText>
              <Pressable onPress={() => { if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setPreferencesVisible(false); }} style={({ pressed }) => [styles.modalCloseBtn, pressed && { opacity: 0.5 }]} accessibilityLabel="Close settings">
                <AppText style={[styles.modalClose, { color: theme.primary }]}>Done</AppText>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.preferencesBody}>
              <AppText style={styles.preferenceLabel}>{passengerCopy(language, 'language')}</AppText>
              <View style={[styles.languageRow, rtl && { flexDirection: 'row-reverse' }]}>
                {([['en', 'English'], ['yi', 'ייִדיש'], ['he', 'עברית']] as const).map(([value, label]) => (
                  <Pressable
                    key={value}
                    onPress={() => {
                      setLanguage(value);
                      void AsyncStorage.setItem(companionStorageKeys.language, value);
                    }}
                    style={[styles.languageChoice, language === value && styles.languageChoiceSelected]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: language === value }}
                  >
                    <AppText style={[styles.languageChoiceText, language === value && styles.languageChoiceTextSelected]}>{label}</AppText>
                  </Pressable>
                ))}
              </View>
              <Surface variant="grouped" style={{ marginBottom: 24 }}>
              <View style={[styles.preferenceSwitchRow, { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.border, paddingHorizontal: 16 }]}>
                <AppText style={[styles.preferenceSwitchLabel, largeText && { fontSize: 20 }]}>{passengerCopy(language, 'largeText')}</AppText>
                <Switch value={largeText} onValueChange={value => {
                  setLargeText(value);
                  void AsyncStorage.setItem(companionStorageKeys.largeText, String(value));
                }} accessibilityLabel={passengerCopy(language, 'largeText')} />
              </View>
              <View style={[styles.preferenceSwitchRow, { borderBottomWidth: 0, paddingHorizontal: 16 }]}>
                <AppText style={styles.preferenceSwitchLabel}>{passengerCopy(language, 'reduceMotion')}</AppText>
                <Switch value={reduceMotion} onValueChange={value => {
                  setReduceMotion(value);
                  void AsyncStorage.setItem(companionStorageKeys.reduceMotion, String(value));
                }} accessibilityLabel={passengerCopy(language, 'reduceMotion')} />
              </View>
              </Surface>
              <AppText style={styles.preferenceHelp}>
                Screen readers receive expanded run details, live status, and refresh errors. Place and stop names remain exactly as published.
              </AppText>
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.trackerHeader, { paddingTop: Math.max(insets.top, Platform.OS === 'web' ? 67 : 0) + 12, backgroundColor: theme.secondary }]}>
        <View style={[styles.trackerBrandRow, rtl && styles.reverseRow]}>
          <Image source={require('@/assets/images/monsey-trails-logo.png')} style={styles.trackerBrandLogo} tintColor={theme.secondaryForeground} resizeMode="contain" accessibilityLabel="Monsey Trails" />
          <View style={[styles.trackerHeaderActions, rtl && styles.reverseRow]}>
            <Pressable onPress={() => setPreferencesVisible(true)} style={styles.backButton} accessibilityRole="button" accessibilityLabel={passengerCopy(language, 'settings')} testID="trip-settings">
              <Feather name="settings" size={21} color={theme.secondaryForeground} />
            </Pressable>
            <Pressable onPress={shareExactRun} style={styles.backButton} accessibilityRole="button" accessibilityLabel={passengerCopy(language, 'share')} testID="share-exact-run">
              <Feather name="share-2" size={21} color={theme.secondaryForeground} />
            </Pressable>
            <Pressable onPress={() => setMoreVisible(true)} style={styles.backButton} accessibilityRole="button" accessibilityLabel="More information" testID="open-more-menu">
              <Feather name="menu" size={21} color={theme.secondaryForeground} />
            </Pressable>
          </View>
        </View>
        <AppText style={[styles.trackerEyebrow, { textAlign: rtl ? 'right' : 'left' }]}>{passengerCopy(language, tripView === 'live' ? 'liveTracking' : 'tripDetails')}</AppText>
        <AppText style={[styles.trackerRoute, { textAlign: rtl ? 'right' : 'left' }]} accessibilityRole="header">{selection.summary}</AppText>
        <AppText style={[styles.trackerMeta, { textAlign: rtl ? 'right' : 'left' }]}>
          {formatDate(selection.date)} · {formatTime(trip?.scheduledDepartureAt ?? selection.scheduledDepartureAt ?? null)} · {runResponse?.coachNumber ? `Coach ${runResponse.coachNumber}` : 'Coach TBD'}
        </AppText>
        <Pressable onPress={tripView === 'live' ? () => setTripView('details') : leave}
          style={[styles.headerReturn, rtl && styles.reverseRow]} accessibilityRole="button"
          accessibilityLabel={passengerCopy(language, tripView === 'live' ? 'backToTrip' : 'otherDepartures')}
          testID={tripView === 'live' ? 'back-to-trip-details' : 'other-departures'}>
          <Feather name={rtl ? 'arrow-right' : 'arrow-left'} size={16} color={theme.secondaryForeground} />
          <AppText style={styles.headerReturnText}>{passengerCopy(language, tripView === 'live' ? 'backToTrip' : 'otherDepartures')}</AppText>
        </Pressable>
      </View>

       {moreMenu}
       {informationSheet}
      {tripView === 'live' ? (
        <ScrollView style={styles.trackerContent}
          contentContainerStyle={{ padding: 20, paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 24) + 24 }}
          refreshControl={<RefreshControl refreshing={manualRunRefresh} onRefresh={refreshSelectedRun} />}
          testID="live-tracking-view">
          <DisruptionNotices notices={trip?.disruptions ?? selectedRunDisruptions} theme={theme} styles={styles} />
          <Surface variant="card" style={styles.liveFocusCard}>
            <LocationConfidenceIndicator trip={trip} assigned={Boolean(runResponse?.assigned)} now={clock.getTime()} theme={theme} styles={styles} />
            <AppText style={styles.liveFocusTitle} accessibilityRole="header">
              {locationIsLive ? passengerCopy(language, 'liveTracking') : locationConfidence.label}
            </AppText>
            {!locationIsLive ? <AppText style={styles.statusSub} accessibilityLiveRegion="polite">
              {locationVisibility === 'ended' ? 'Trip complete. Live location is no longer available.'
                : locationVisibility === 'before_departure' ? `Live location starts at ${formatTime(trip?.scheduledDepartureAt ?? selection.scheduledDepartureAt ?? null)}.`
                  : 'The coach position is not currently available. Refresh to check again.'}
            </AppText> : null}
          </Surface>
          <Surface variant="card" style={styles.liveMapCard}>
            <PassengerJourneyMap key={`${runKey}:live`} route={mapRoute} stops={mapStops}
              liveCoach={locationIsLive ? mapData.liveCoach : null}
              selectedStopId={null} onSelectStop={() => undefined} status={mapStatus} />
          </Surface>
          <AppText style={styles.liveMapNote}>{passengerCopy(language, 'routeMapNote')}</AppText>
          <Surface variant="card" style={styles.liveFocusCard}>
            <AppText style={styles.liveStopCaption}>{passengerCopy(language, 'nextStop')}</AppText>
            <AppText style={styles.liveStopName}>{nextLiveStopLabel ?? passengerCopy(language, 'noNextStop')}</AppText>
            {nextLiveStop?.eta ? <AppText style={styles.statusSub}>{passengerCopy(language, 'estimated')} {formatTime(nextLiveStop.eta)}</AppText> : null}
            {locationConfidence.ageLabel ? <AppText style={styles.statusSub}>{locationConfidence.ageLabel}</AppText> : null}
          </Surface>
          {message ? <AppText style={styles.errorMessage} accessibilityRole="alert">{message}</AppText> : null}
        </ScrollView>
      ) : (
      <ScrollView
        style={styles.trackerContent}
        contentContainerStyle={{ padding: 20, paddingBottom: Math.max(insets.bottom, Platform.OS === 'web' ? 34 : 24) + 24 }}
        refreshControl={<RefreshControl refreshing={manualRunRefresh} onRefresh={refreshSelectedRun} />}
        testID="trip-details-view"
      >
         <DisruptionNotices notices={trip?.disruptions ?? selectedRunDisruptions} theme={theme} styles={styles} />
          <ExactStopSelectors
            mode="trip"
            pickup={selection.pickup ?? null}
            dropoff={selection.dropoff ?? null}
            pickupStops={tripPickupStops}
            dropoffStops={tripDropoffStops}
            originName={LOCATIONS.find(location => location.id === selection.origin)?.name}
            destinationName={LOCATIONS.find(location => location.id === selection.destination)?.name}
            loading={journeyRequest.isPending && !publishedJourney}
            error={journeyRequest.isError ? 'Verified stops are unavailable. Refresh the trip to try again.' : ''}
            disabled={notificationOn}
            onPickup={pickup => updateTripStops(pickup, null)}
            onDropoff={dropoff => updateTripStops(selection.pickup ?? null, dropoff)}
          />
          {locationIsLive ? <Pressable style={[styles.liveEntry, rtl && styles.reverseRow]}
            onPress={() => setTripView('live')} accessibilityRole="button"
            accessibilityLabel={passengerCopy(language, 'viewLiveTracking')} testID="view-live-tracking">
            <Feather name="navigation" size={20} color={theme.primaryForeground} />
            <AppText style={styles.liveEntryText}>{passengerCopy(language, 'viewLiveTracking')}</AppText>
            <Feather name={rtl ? 'chevron-left' : 'chevron-right'} size={20} color={theme.primaryForeground} />
          </Pressable> : null}
          {!runError && !!trip?.announcements?.length && (
            <Surface variant="card" style={{ padding: 16, marginBottom: 12, gap: 8 }}>
              <AppText style={{ fontSize: 18, fontWeight: '700', color: theme.foreground, textAlign: rtl ? 'right' : 'left' }}>
                {passengerCopy(language, 'announcements')}
              </AppText>
              {trip.announcements.map(item => (
                <View key={item.id} style={{ gap: 4 }}>
                  <AppText style={{ color: theme.foreground, fontWeight: '700', textAlign: rtl ? 'right' : 'left' }}>{item.title}</AppText>
                  <AppText style={{ color: theme.mutedForeground, textAlign: rtl ? 'right' : 'left' }}>{item.message}</AppText>
                </View>
              ))}
            </Surface>
          )}
          {!!runError && <AppText style={{ color: theme.mutedForeground, marginBottom: 12, textAlign: rtl ? 'right' : 'left' }}>
            {passengerCopy(language, 'noticesUnavailable')}
          </AppText>}
         <DepartureReminderCard
           deviceId={deviceId}
            canSave={hasVerifiedTripStops}
           selectedTrip={{
             serviceDate: selection.date,
             line: selection.line,
             origin: selection.origin,
             destination: selection.destination,
             runId: selection.runId,
           }}
         />
          <Surface variant="card" style={styles.mapCard}>
            <PassengerJourneyMap
              key={runKey}
              route={mapRoute}
              stops={mapStops}
              liveCoach={mapData.liveCoach}
              selectedStopId={mapSelectedStopId}
              onSelectStop={setSelectedMapStopId}
              status={mapStatus}
            />
          </Surface>

         <Surface variant="card" style={styles.statusCard}>
            <View style={styles.statusHeader}>
                {runResponse?.assigned && locationIsLive ? (
                  <View style={styles.liveBadge}><View style={styles.liveDot}/><AppText style={styles.liveText}>LIVE</AppText></View>
               ) : (
                   <View style={[styles.liveBadge, { backgroundColor: theme.muted }]}><AppText style={[styles.liveText, { color: theme.mutedForeground }]}>
                     {runError ? 'OFFLINE' : locationConfidence.kind === 'schedule' ? 'SCHEDULED' : 'TRACKING UNAVAILABLE'}
                   </AppText></View>
               )}
               <AppText style={styles.statusDate}>{formatDate(selection.date)}</AppText>
            </View>
             <LocationConfidenceIndicator
               trip={trip}
               assigned={Boolean(runResponse?.assigned)}
               now={clock.getTime()}
               theme={theme}
               styles={styles}
             />
            <AppText style={styles.statusMain}>
               {!runResponse ? 'Loading details...' :
                !runResponse.assigned ? 'Coach TBD' :
                runResponse.coachNumber ? `Coach ${runResponse.coachNumber}` : 'Assigned'}
            </AppText>
             {selection.pickup && selection.dropoff ? (
                <View style={styles.exactTripStops} accessibilityLabel={`Selected pickup ${selection.pickup.label}. Selected drop-off ${selection.dropoff.label}.`} testID="selected-exact-stops">
                 <AppText style={styles.exactTripStopLabel}>YOUR EXACT STOPS</AppText>
                 <AppText style={styles.exactTripStopValue}>{selection.pickup.label}</AppText>
                 <Feather name="arrow-down" size={14} color={theme.mutedForeground} />
                 <AppText style={styles.exactTripStopValue}>{selection.dropoff.label}</AppText>
               </View>
             ) : null}
             <View style={styles.timingEvidence}>
               <View style={styles.timingEvidenceRow}>
                 <AppText style={styles.timingEvidenceLabel}>{passengerCopy(language, 'scheduled')}</AppText>
                 <AppText style={styles.timingEvidenceValue}>
                   {formatTime(trip?.scheduledDepartureAt ?? selection.scheduledDepartureAt ?? null)}
                 </AppText>
               </View>
                {locationIsLive && trip?.eta ? (
                 <View style={styles.timingEvidenceRow}>
                    <AppText style={styles.timingEvidenceLabel}>Live ETA</AppText>
                   <AppText style={styles.timingEvidenceValue}>{formatTime(trip.eta)}</AppText>
                 </View>
               ) : null}
             </View>
            {!runResponse?.assigned && <AppText style={styles.statusSub}>Waiting for an operator to assign a coach to this run.</AppText>}
             {runResponse?.assigned && locationVisibility === 'before_departure' && (
               <AppText style={styles.statusSub}>
                 Live location starts at {formatTime(trip?.scheduledDepartureAt ?? selection.scheduledDepartureAt ?? null)}.
               </AppText>
             )}
             {runResponse?.assigned && !trip && <AppText style={styles.statusSub}>Coach assigned. Waiting for trip details...</AppText>}
              {locationIsLive && trip?.locationUpdatedAt && (
                <AppText style={styles.statusSub}>
                  Coach position updated {new Date(trip.locationUpdatedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.
                </AppText>
              )}
             {locationVisibility === 'ended' && <AppText style={styles.statusSub}>Trip complete. Live location is no longer available.</AppText>}
             {trip && locationVisibility === 'unavailable' && <AppText style={styles.statusSub}>Live location is currently unavailable.</AppText>}
         </Surface>

          <Surface variant="card" style={styles.transferCard}>
            <View style={styles.transferHeader}>
              <View style={styles.transferTitleRow}>
                <Feather name="repeat" size={18} color={theme.primary} />
                <AppText style={styles.transferTitle}>Need another bus?</AppText>
              </View>
              <Pressable
                onPress={() => transferSearch.mutate({ data: { runKey, minimumBufferMinutes: 15 } })}
                disabled={transferSearch.isPending}
                style={styles.transferButton}
                accessibilityRole="button"
                accessibilityLabel="Check possible published transfers"
              >
                <AppText style={styles.transferButtonText}>{transferSearch.isPending ? 'Checking…' : 'Check transfers'}</AppText>
              </Pressable>
            </View>
            <AppText style={styles.transferHelp}>Checks exact published runs with at least 15 minutes at the same verified stop.</AppText>
            {transferSearch.isError && <AppText style={styles.transferError}>Transfer search is temporarily unavailable.</AppText>}
            {transferSearch.data && (
              <View style={styles.transferResults}>
                <AppText style={styles.transferMessage}>{transferSearch.data.message}</AppText>
                {transferSearch.data.options.map(option => (
                  <View key={option.runKey} style={[
                    styles.transferOption,
                    option.connectionStatus === 'at_risk' && styles.transferOptionRisk,
                    option.connectionStatus === 'tight' && styles.transferOptionTight,
                  ]}>
                    <AppText style={styles.transferRoute}>{option.origin.name} → {option.destination.name}</AppText>
                    <AppText style={styles.transferTime}>Published departure {formatTime(option.departureAt)} · {option.bufferMinutes} min</AppText>
                    <AppText style={styles.transferStop}>Same published stop: {option.sharedStop.label}</AppText>
                    <AppText style={styles.transferWarning}>{option.warning}</AppText>
                  </View>
                ))}
              </View>
            )}
          </Surface>

          {trip?.status === 'running' && trip.passengerCode && (
            <RealtimeAlertsCard
              key={`${runKey}:${trip.passengerCode}`}
              passengerCode={trip.passengerCode}
              deviceId={deviceId}
              runKey={runKey}
              pickupStopId={tripPickupStop?.id}
              transferOptions={(transferSearch.data?.options ?? []).map(option => ({
                ...option,
                onwardRunKey: option.runKey,
                incomingSharedStopId: option.sharedStop.id,
                areaId: option.sharedStop.areaId,
                minimumBufferMinutes: transferSearch.data?.minimumBufferMinutes ?? 15,
              }))}
              language={language}
            />
          )}
          {selection && hasVerifiedTripStops && tripPickupStop && tripDropoffStop && (
            <LiveActivityTrackingCard
              key={`${runKey}:${trip?.passengerCode ?? 'unassigned'}:${tripPickupStop.id}:${tripDropoffStop.id}`}
              runKey={runKey}
              lineName={`${publishedJourney?.originName ?? selection.summary} → ${publishedJourney?.destinationName ?? ''}`.trim()}
              coachNumber={runResponse?.coachNumber ?? ''}
              passengerCode={trip?.passengerCode}
              pickupStopId={tripPickupStop.id}
              pickupLabel={tripPickupStop.label}
              dropoffStopId={tripDropoffStop.id}
              dropoffLabel={tripDropoffStop.label}
              tripStatus={trip?.status}
              tripAssigned={Boolean(runResponse?.assigned && trip?.passengerCode)}
              tripSnapshotCurrent={Boolean(runResponse && !runError)}
              publishedRunVerified={Boolean(
                publishedJourney?.runKey === runKey
                && selection.pickup?.id === tripPickupStop.id
                && selection.dropoff?.id === tripDropoffStop.id
                && tripPickupStop.kind === 'pickup'
                && tripDropoffStop.kind === 'dropoff',
              )}
              locationIsLive={locationIsLive}
              locationUpdatedAt={trip?.locationUpdatedAt}
              progress={trip?.journeyProgress}
              definitiveTripEnd={Boolean(
                runResponse && !runError && (
                  !runResponse.assigned
                  || runResponse.trip?.status === 'stopped'
                  || runResponse.trip?.status === 'ended'
                  || runResponse.trip?.status === 'completed'
                  || runResponse.trip?.journeyProgress.some(
                    progress => progress.id === tripDropoffStop.id && progress.status === 'completed',
                  )
                ),
              )}
            />
          )}

          <Surface variant="card" style={styles.boardingCard}>
            <View style={styles.boardingTitleRow}>
              <Feather name="map-pin" size={18} color={theme.success} />
              <AppText style={styles.boardingTitle}>{passengerCopy(language, 'boarding')}</AppText>
            </View>
            {!hasVerifiedTripStops ? (
              <AppText style={styles.boardingVerification}>Choose your exact pickup and drop-off above before using boarding directions or saving a boarding route.</AppText>
            ) : boardingStop ? (
              <>
                <AppText style={styles.boardingStopName}>
                  {boardingStop.label}
                </AppText>
                <AppText style={styles.boardingVerification}>
                  {boardingStop.verified
                    ? 'Map directions use the verified stop coordinates supplied for this exact run. No stop photo is shown unless verified by the operator.'
                    : 'This published stop does not yet include verified coordinates, so map directions and a stop photo are not shown.'}
                </AppText>
                {boardingStop.verified ? (
                  <Pressable style={styles.directionsButton} onPress={openBoardingDirections} accessibilityRole="link" testID="boarding-directions">
                    <Feather name="navigation" size={16} color={theme.primaryForeground} />
                    <AppText style={styles.directionsButtonText}>{passengerCopy(language, 'directions')}</AppText>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <AppText style={styles.boardingVerification}>Boarding details will appear when verified stop data is available. Check the published pickup description for this run.</AppText>
            )}
          </Surface>
          {trip?.status === 'running' && <RideMotionHintCard />}
          <TripInformation
            language={language}
            selectedTrip={{
              runId: selection.runId,
              origin: String(selection.origin),
              destination: String(selection.destination),
              serviceDate: selection.date,
            }}
          />

          {message ? <AppText style={styles.errorMessage}>{message}</AppText> : null}
          {shareMessage ? <AppText style={styles.plannerMessage} accessibilityLiveRegion="polite">{shareMessage}</AppText> : null}

         {trip && (
           <Surface variant="card" style={styles.timelineCard}>
               <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 }}><Feather name="navigation" size={20} color={theme.primary} /><AppText style={[styles.timelineTitle, { marginBottom: 0 }]}>{trip.journeyProgress?.length ? 'Journey Progress' : 'Upcoming Stops'}</AppText></View>
               {(trip.journeyProgress?.length ? trip.journeyProgress : trip.upcomingStops).length === 0 && (
                 <View style={styles.emptyStateContainer}>
                   <Feather name="map" size={24} color={theme.mutedForeground} style={{ marginBottom: 8 }} />
                   <AppText style={styles.emptyText}>No upcoming stops.</AppText>
                 </View>
               )}
               {(trip.journeyProgress?.length ? trip.journeyProgress : trip.upcomingStops).map((stop, index) => {
                  const progressStop = 'status' in stop ? stop : null;
                 const isSelected = selectedStop === stop.id;
                 const isAlertActive = notificationOn && isSelected;
                  const isFirst = progressStop ? progressStop.status === 'current' : index === 0;
                  const isCompleted = progressStop?.status === 'completed';
                   const stopKind = (progressStop as { kind?: 'pickup' | 'dropoff' | 'destination' } | null)?.kind;
                   const statusColor = stopKind === 'pickup' ? theme.success : theme.arrival;
                   const milesAway = progressStop && locationIsLive
                     ? milesBetween(trip.currentLocation, progressStop)
                     : null;
                   const isApproaching = progressStop?.status === 'current'
                     && milesAway !== null
                     && milesAway <= 2;
                   const arrivingMinutes = isApproaching && stop.eta
                     ? Math.max(1, Math.ceil((new Date(stop.eta).getTime() - Date.now()) / 60_000))
                     : null;
                 return (
                     <Pressable
                       key={stop.id}
                       style={styles.timelineRow}
                       onPress={() => {
                         setSelectedMapStopId(stop.id);
                          if (!isCompleted && hasVerifiedTripStops) changeAlertSelection(stop.id, leadTime);
                       }}
                       accessibilityRole="button"
                        accessibilityLabel={`Show ${'address' in stop ? stop.address : stop.label} on map${isCompleted || !hasVerifiedTripStops ? '' : ' and select for stop alert'}`}
                       testID={`timeline-stop-${stop.id}`}
                     >
                      <View style={styles.timelineGraphics}>
                          <View style={[styles.timelineDot, isFirst && styles.timelineDotActive, isCompleted && { backgroundColor: statusColor }]} />
                          {index < (trip.journeyProgress?.length || trip.upcomingStops.length) - 1 && <View style={styles.timelineLine} />}
                      </View>
                       <View style={[styles.timelineContent, (isSelected || mapSelectedStopId === stop.id) && styles.timelineContentSelected]}>
                         <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                           <View style={{ flex: 1, paddingRight: 12 }}>
                              <AppText style={[styles.timelineStopName, isFirst && styles.timelineStopNameActive]} numberOfLines={1}>{'address' in stop ? stop.address : stop.label}</AppText>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                   {isApproaching && <ArrivingSignal color={statusColor} reduceMotion={reduceMotion} />}
                                  <AppText style={[styles.timelineStopEta, (isCompleted || isApproaching) && { color: statusColor }]}>
                                    {isCompleted
                                      ? journeyCompletionLabel(progressStop?.status ?? '', stopKind)
                                      : isApproaching
                                        ? arrivingMinutes === null ? 'Arriving soon' : `Arriving in ${arrivingMinutes} min`
                                      : locationIsLive && stop.eta ? `Live estimate ${formatTime(stop.eta)}` : 'No live ETA'}
                                  </AppText>
                                </View>
                           </View>
                            <Feather name={isCompleted ? "check-circle" : "bell"} size={20} color={isCompleted ? statusColor : (isAlertActive ? theme.accent : (isSelected ? theme.primary : theme.mutedForeground))} style={{ opacity: isCompleted || isAlertActive || isSelected ? 1 : 0.3 }} />
                         </View>
                      </View>
                   </Pressable>
                 )
              })}
           </Surface>
         )}

         <Surface variant="card" style={styles.alertCard}>
              <View style={styles.alertHeaderRow}>
                 <AppText style={styles.alertTitle}>Stop alert</AppText>
                   <Switch value={notificationOn} onValueChange={requestAlert} disabled={!hasVerifiedTripStops || !trip?.passengerCode}
                     trackColor={{ false: theme.border, true: theme.primary }} accessibilityLabel="Stop alert" testID="stop-alert-switch" />
              </View>
                <AppText style={styles.alertSubtitle} testID="stop-alert-status">
                  {alertData ? 'Alert active' : !hasVerifiedTripStops
                    ? 'Choose your exact pickup and drop-off above to enable stop alerts.'
                    : !trip?.passengerCode
                      ? 'Stop alerts become available when a coach is assigned to this run.'
                      : 'Get notified before your stop'}
                </AppText>
              {trip ? (
                <>
              <View style={styles.alertOptions}>
                  {ALERT_LEAD_OPTIONS.map((option) => (
                    <Pressable
                      key={option.value}
                      onPress={() => changeAlertSelection(selectedStop, option.value)}
                      style={[styles.alertOption, leadTime === option.value && styles.alertOptionSelected]}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: leadTime === option.value }}
                      accessibilityLabel={`${option.label}${option.detail ? `, ${option.detail}` : ''} before stop`}
                    >
                      <AppText style={[styles.alertOptionText, leadTime === option.value && styles.alertOptionTextSelected]}>{option.label}</AppText>
                      {option.detail ? (
                        <AppText style={[styles.alertOptionDetail, leadTime === option.value && styles.alertOptionTextSelected]}>{option.detail}</AppText>
                      ) : null}
                    </Pressable>
                  ))}
              </View>
               <View style={styles.soundPreferenceRow}>
                 <View style={styles.soundPreferenceCopy}>
                   <AppText style={styles.soundPreferenceTitle}>Play sound</AppText>
                   <AppText style={styles.soundPreferenceDetail}>Turn off for a quiet push alert.</AppText>
                 </View>
                 <Switch
                   value={soundEnabled}
                   onValueChange={(enabled) => changeAlertSelection(selectedStop, leadTime, enabled)}
                   trackColor={{ false: theme.border, true: theme.primary }}
                   accessibilityLabel="Play a sound for this stop alert"
                 />
               </View>
                </>
              ) : null}
           </Surface>
      </ScrollView>
      )}
      <Modal visible={preferencesVisible} animationType={reduceMotion ? 'none' : 'slide'} presentationStyle="formSheet" onRequestClose={() => setPreferencesVisible(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
          <View style={[styles.modalHeader, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <AppText style={styles.modalTitle}>{passengerCopy(language, 'settings')}</AppText>
            <Pressable onPress={() => setPreferencesVisible(false)} style={styles.modalCloseBtn} accessibilityRole="button" accessibilityLabel="Close settings">
              <AppText style={styles.modalClose}>Done</AppText>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.preferencesBody}>
            <AppText style={styles.preferenceLabel}>{passengerCopy(language, 'language')}</AppText>
            <View style={[styles.languageRow, rtl && styles.reverseRow]}>
              {([['en', 'English'], ['yi', 'ייִדיש'], ['he', 'עברית']] as const).map(([value, label]) => (
                <Pressable key={value} onPress={() => { setLanguage(value); void AsyncStorage.setItem(companionStorageKeys.language, value); }}
                  style={[styles.languageChoice, language === value && styles.languageChoiceSelected]}
                  accessibilityRole="radio" accessibilityState={{ checked: language === value }}>
                  <AppText style={[styles.languageChoiceText, language === value && styles.languageChoiceTextSelected]}>{label}</AppText>
                </Pressable>
              ))}
            </View>
            <Surface variant="grouped" style={{ marginBottom: 24 }}>
              <View style={styles.preferenceSwitchRow}>
                <AppText style={styles.preferenceSwitchLabel}>{passengerCopy(language, 'largeText')}</AppText>
                <Switch value={largeText} onValueChange={value => { setLargeText(value); void AsyncStorage.setItem(companionStorageKeys.largeText, String(value)); }} accessibilityLabel={passengerCopy(language, 'largeText')} />
              </View>
              <View style={styles.preferenceSwitchRow}>
                <AppText style={styles.preferenceSwitchLabel}>{passengerCopy(language, 'reduceMotion')}</AppText>
                <Switch value={reduceMotion} onValueChange={value => { setReduceMotion(value); void AsyncStorage.setItem(companionStorageKeys.reduceMotion, String(value)); }} accessibilityLabel={passengerCopy(language, 'reduceMotion')} />
              </View>
            </Surface>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const createStyles = (theme: any) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },

  plannerHeader: {
    paddingHorizontal: 24,
    paddingBottom: 26,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  plannerBrandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 8 },
  plannerBrandLogo: { width: 180, height: 29 },
  headerIconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  plannerTitle: { color: theme.primaryForeground, fontSize: 32, fontWeight: '800' },

  searchCard: {
    marginHorizontal: 20,
    marginTop: -14,
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'column',
    position: 'relative',
  },
  lineSelector: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 20, paddingVertical: 12, gap: 8, alignItems: 'center' },
  lineChip: { backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1, borderRadius: 999, minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center' },
  lineChipSelected: { backgroundColor: theme.primary, borderColor: theme.primary },
  lineChipText: { color: theme.mutedForeground, fontSize: 13, fontWeight: '700' },
  lineChipTextSelected: { color: theme.primaryForeground },
  searchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
  searchDot: { width: 12, height: 12, borderRadius: 6, marginRight: 16 },
  searchText: { fontSize: 18, color: theme.foreground, fontWeight: '600' },
  searchDivider: { height: 1, backgroundColor: theme.border, marginLeft: 28 },
  swapButton: {
    position: 'absolute',
    right: 20,
    top: '50%',
    marginTop: -20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  dateSelector: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, minHeight: 50, gap: 12 },
  dateText: { fontSize: 18, fontWeight: '700', color: theme.foreground, minWidth: 120, textAlign: 'center' },
  plannerMessage: { color: theme.foreground, backgroundColor: theme.muted, padding: 12, borderRadius: 12, marginBottom: 12, textAlign: 'center', fontWeight: '600' },
  savedRoutes: { marginBottom: 12 },
  savedRoutesTitle: { color: theme.foreground, fontSize: 13, fontWeight: '800', marginBottom: 8 },
  savedRouteRow: { gap: 8, paddingRight: 12 },
  savedRouteChip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card },
  savedRouteText: { color: theme.foreground, fontSize: 12, fontWeight: '700' },
  scheduleSourceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8 },
  filterToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, marginBottom: 10, borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card },
  filterToggleText: { flex: 1, color: theme.secondary, fontSize: 13, fontWeight: '800' },
  pdfLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: 8, marginBottom: 12, paddingHorizontal: 12 },
  scheduleUpdatedText: { color: theme.mutedForeground, fontSize: 12, fontWeight: '700', flexShrink: 1 },
  refreshAction: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 8 },
  refreshActionText: { color: theme.secondary, fontSize: 13, fontWeight: '700' },
  saveRouteAction: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 6, minHeight: 40, marginBottom: 8, paddingHorizontal: 8 },
  sourceBadge: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10 },
  sourceBadgeText: { fontSize: 12, fontWeight: '800' },
  favoriteButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8 },
  favoriteButtonText: { color: theme.foreground, fontSize: 12, fontWeight: '700' },
  staleNotice: { color: theme.foreground, backgroundColor: theme.muted, borderLeftWidth: 4, borderColor: theme.arrival, padding: 12, borderRadius: 8, fontSize: 12, lineHeight: 18, marginBottom: 10 },
  refreshFailure: { borderColor: theme.destructive, padding: 14, marginBottom: 12 },
  refreshFailureText: { color: theme.destructive, fontSize: 14, fontWeight: '800' },
  refreshAlternative: { color: theme.mutedForeground, fontSize: 12, lineHeight: 18, marginTop: 4 },
  retryButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: theme.primary, borderRadius: 999, minHeight: 40, paddingHorizontal: 14, marginTop: 10 },
  retryButtonText: { color: theme.primaryForeground, fontWeight: '800', fontSize: 13 },
  departureToggle: { marginBottom: 14, borderRadius: 999 },
  departureToggleRow: { flexDirection: 'row', padding: 4 },
  departureToggleButton: { minHeight: 44, flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  departureToggleSelected: { backgroundColor: theme.secondary },
  departureToggleText: { color: theme.mutedForeground, fontSize: 13, fontWeight: '800', textAlign: 'center' },
  departureToggleTextSelected: { color: theme.secondaryForeground },
  scheduleDownloadCard: { padding: 16, marginBottom: 14 },
  scheduleDownloadTitle: { color: theme.foreground, fontSize: 15, fontWeight: '800' },
  scheduleDownloadDate: { color: theme.mutedForeground, fontSize: 12, fontWeight: '600', marginTop: 4 },
  scheduleDownloadButton: { minHeight: 44, marginTop: 14, borderRadius: 999, backgroundColor: theme.secondary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  scheduleDownloadButtonPressed: { opacity: 0.65 },
  scheduleDownloadButtonText: { color: theme.secondaryForeground, fontSize: 14, fontWeight: '800' },
  scheduleDownloadHelp: { color: theme.mutedForeground, fontSize: 12, lineHeight: 18, marginTop: 10, textAlign: 'center' },
  scheduleDownloadError: { color: theme.destructive, fontSize: 12, lineHeight: 18, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  transferCard: { padding: 16, marginBottom: 14 },
  transferHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  transferTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  transferTitle: { color: theme.foreground, fontSize: 16, fontWeight: '800' },
  transferButton: { backgroundColor: theme.primary, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 9 },
  transferButtonText: { color: theme.primaryForeground, fontSize: 12, fontWeight: '800' },
  transferHelp: { color: theme.mutedForeground, fontSize: 12, lineHeight: 17, marginTop: 9 },
  transferError: { color: theme.destructive, fontSize: 12, fontWeight: '700', marginTop: 10 },
  transferResults: { gap: 9, marginTop: 12 },
  transferMessage: { color: theme.mutedForeground, fontSize: 12, lineHeight: 17 },
  transferOption: { borderColor: theme.success, borderWidth: 1, borderRadius: 12, padding: 12 },
  transferOptionRisk: { borderColor: theme.destructive },
  transferOptionTight: { borderColor: theme.warning },
  transferRoute: { color: theme.foreground, fontSize: 14, fontWeight: '800' },
  transferTime: { color: theme.mutedForeground, fontSize: 12, fontWeight: '700', marginTop: 4 },
  transferStop: { color: theme.foreground, fontSize: 12, fontWeight: '700', marginTop: 7 },
  transferWarning: { color: theme.mutedForeground, fontSize: 11, lineHeight: 16, marginTop: 5 },
  keysCard: { padding: 16, marginBottom: 14 },
  keysHeader: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  keysTitle: { color: theme.foreground, fontSize: 14, fontWeight: '800' },
  keyLegendRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginTop: 9 },
  keyMeaning: { flex: 1, color: theme.mutedForeground, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  keyBadge: { minWidth: 24, height: 24, borderRadius: 6, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.primary },
  keyBadgeText: { color: theme.primaryForeground, fontSize: 12, fontWeight: '800' },

  calendarOverlay: { flex: 1, justifyContent: 'center', padding: 20, borderWidth: 0, borderRadius: 0 },
  calendarCard: { padding: 18 },
  calendarTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  calendarIconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  calendarTitle: { color: theme.foreground, fontSize: 20, fontWeight: '800' },
  weekRow: { flexDirection: 'row', marginBottom: 6 },
  weekday: { width: '14.285%', textAlign: 'center', color: theme.mutedForeground, fontSize: 12, fontWeight: '700' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarDay: { width: '14.285%', aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 999 },
  calendarDaySelected: { backgroundColor: theme.primary },
  calendarDayToday: { borderWidth: 1, borderColor: theme.primary },
  calendarDayText: { color: theme.foreground, fontSize: 15, fontWeight: '600' },
  calendarDayTextDisabled: { color: theme.mutedForeground, opacity: 0.35 },
  calendarDayTextSelected: { color: theme.primaryForeground, fontWeight: '800' },
  calendarActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderColor: theme.border },
  todayButton: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10, paddingHorizontal: 6 },
  todayButtonText: { color: theme.foreground, fontSize: 16, fontWeight: '800' },
  calendarCloseButton: { paddingVertical: 10, paddingHorizontal: 6 },
  calendarCloseText: { color: theme.foreground, fontSize: 16, fontWeight: '700' },

  runsList: { paddingHorizontal: 20 },
  runCard: {
    backgroundColor: theme.card,
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1, borderColor: theme.border,
  },
  runHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  runTime: { fontSize: 22, fontWeight: '800', color: theme.foreground },
  runKeys: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  runDurationBadge: { backgroundColor: theme.muted, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  runDurationText: { fontSize: 13, fontWeight: '600', color: theme.mutedForeground },
  runDesc: { paddingLeft: 10, borderLeftWidth: 2, borderColor: theme.border },
  runDescText: { fontSize: 15, color: theme.mutedForeground, fontWeight: '500' },

  trackerHeader: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  reverseRow: { flexDirection: 'row-reverse' },
  trackerBrandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  trackerHeaderActions: { flexDirection: 'row', alignItems: 'center' },
  trackerBrandLogo: { width: 146, height: 26 },
  trackerEyebrow: { color: theme.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 4 },
  trackerRoute: { color: theme.secondaryForeground, fontSize: 20, fontWeight: '800' },
  trackerMeta: { color: theme.secondaryForeground, opacity: 0.8, fontSize: 12, fontWeight: '600', marginTop: 5 },
  headerReturn: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, marginTop: 12, borderWidth: 1, borderColor: theme.secondaryForeground, borderRadius: 999 },
  headerReturnText: { color: theme.secondaryForeground, fontSize: 13, fontWeight: '700' },

  trackerContent: { flex: 1 },
  liveEntry: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, paddingHorizontal: 16, marginBottom: 16, backgroundColor: theme.primary },
  liveEntryText: { flex: 1, color: theme.primaryForeground, fontSize: 15, fontWeight: '800' },
  liveFocusCard: { padding: 18, marginBottom: 14 },
  liveFocusTitle: { color: theme.foreground, fontSize: 22, fontWeight: '800', marginBottom: 6 },
  liveMapCard: { height: 340, borderRadius: 16, overflow: 'hidden', backgroundColor: theme.muted, marginBottom: 10 },
  liveMapNote: { color: theme.mutedForeground, fontSize: 12, lineHeight: 18, marginBottom: 18 },
  liveStopCaption: { color: theme.mutedForeground, fontSize: 12, fontWeight: '800', marginBottom: 6 },
  liveStopName: { color: theme.foreground, fontSize: 18, fontWeight: '800', marginBottom: 8 },

  mapCard: { height: 280, borderRadius: 24, overflow: 'hidden', marginBottom: 20, backgroundColor: theme.muted, borderWidth: 1, borderColor: theme.border },

  statusCard: {
    padding: 24,
    marginBottom: 16,
  },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEE2E2', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.destructive },
  liveText: { fontSize: 12, fontWeight: '800', color: theme.destructive },
  statusDate: { fontSize: 14, fontWeight: '600', color: theme.mutedForeground },
  confidenceBadge: { alignSelf: 'flex-start', minHeight: 32, maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 12, backgroundColor: theme.background },
  confidenceLabel: { fontSize: 12, fontWeight: '800' },
  confidenceAge: { color: theme.mutedForeground, fontSize: 12, fontWeight: '600' },
  statusMain: { fontSize: 28, fontWeight: '800', color: theme.foreground, marginBottom: 6 },
  statusSub: { fontSize: 15, color: theme.mutedForeground, lineHeight: 22 },
  exactTripStops: { backgroundColor: theme.muted, borderRadius: 12, padding: 12, gap: 5, marginTop: 10 },
  exactTripStopLabel: { color: theme.mutedForeground, fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  exactTripStopValue: { color: theme.foreground, fontSize: 14, fontWeight: '700' },
  timingEvidence: { borderTopWidth: 1, borderColor: theme.border, marginTop: 14, paddingTop: 10, gap: 7 },
  timingEvidenceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  timingEvidenceLabel: { color: theme.mutedForeground, fontSize: 12, fontWeight: '700' },
  timingEvidenceValue: { color: theme.foreground, fontSize: 14, fontWeight: '800' },
  boardingCard: { padding: 16, marginBottom: 16 },
  boardingTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  boardingTitle: { color: theme.foreground, fontSize: 17, fontWeight: '800' },
  boardingStopName: { color: theme.foreground, fontSize: 17, fontWeight: '700', marginTop: 12 },
  boardingNote: { color: theme.foreground, fontSize: 14, lineHeight: 20, marginTop: 6 },
  boardingVerification: { color: theme.mutedForeground, fontSize: 12, lineHeight: 18, marginTop: 8 },
  directionsButton: { alignSelf: 'flex-start', minHeight: 44, borderRadius: 999, backgroundColor: theme.primary, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 15, marginTop: 14 },
  directionsButtonText: { color: theme.primaryForeground, fontSize: 14, fontWeight: '800' },

  timelineCard: {
    padding: 24,
    marginBottom: 16,
  },
  timelineTitle: { fontSize: 18, fontWeight: '800', color: theme.foreground, marginBottom: 20 },
  timelineRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 24 },
  timelineGraphics: { width: 32, alignItems: 'center', marginRight: 12, marginTop: 4 },
  timelineDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: theme.card, borderWidth: 4, borderColor: theme.border, zIndex: 1 },
  timelineDotActive: { borderColor: theme.primary, backgroundColor: theme.primary },
  timelineLine: { position: 'absolute', top: 16, bottom: -40, width: 3, backgroundColor: theme.border, borderRadius: 2 },
  timelineContent: { flex: 1, padding: 14, borderRadius: 16, marginTop: -10, backgroundColor: theme.background, borderWidth: 1, borderColor: 'transparent' },
  timelineContentSelected: { backgroundColor: theme.card, borderColor: theme.primary, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  timelineStopName: { fontSize: 16, fontWeight: '600', color: theme.foreground, marginBottom: 4 },
  timelineStopNameActive: { fontWeight: '800', color: theme.foreground },
  timelineStopEta: { fontSize: 14, color: theme.foreground, fontWeight: '700' },

  alertCard: {
    padding: 24,
    marginBottom: 16,
    borderWidth: 2, borderColor: theme.primary,
  },
  alertHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  alertTitle: { fontSize: 18, fontWeight: '800', color: theme.foreground },
  alertSubtitle: { fontSize: 14, color: theme.mutedForeground, marginBottom: 20 },
  alertOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  alertOption: { minWidth: '30%', flexGrow: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 10, alignItems: 'center' },
  alertOptionSelected: { backgroundColor: theme.primary, borderColor: theme.primary },
  alertOptionText: { fontSize: 14, fontWeight: '600', color: theme.foreground },
  alertOptionDetail: { fontSize: 11, fontWeight: '500', color: theme.mutedForeground, marginTop: 2 },
  alertOptionTextSelected: { color: theme.primaryForeground },
  soundPreferenceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderColor: theme.border },
  soundPreferenceCopy: { flex: 1, paddingRight: 12 },
  soundPreferenceTitle: { fontSize: 15, fontWeight: '700', color: theme.foreground },
  soundPreferenceDetail: { fontSize: 12, color: theme.mutedForeground, marginTop: 2 },

  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderColor: theme.border },
  modalTitle: { fontSize: 20, fontWeight: '800', color: theme.foreground },
  modalCloseBtn: { padding: 4 },
  modalClose: { fontSize: 16, fontWeight: '700', color: theme.foreground },
  modalRow: { padding: 20, borderBottomWidth: 1, borderColor: theme.border },
  modalRowText: { fontSize: 18, color: theme.foreground, fontWeight: '500' },
  preferencesBody: { padding: 20 },
  preferenceLabel: { color: theme.foreground, fontSize: 16, fontWeight: '800', marginBottom: 10 },
  languageRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  languageChoice: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.border, borderRadius: 12, backgroundColor: theme.card },
  languageChoiceSelected: { backgroundColor: theme.primary, borderColor: theme.primary },
  languageChoiceText: { color: theme.foreground, fontSize: 15, fontWeight: '700' },
  languageChoiceTextSelected: { color: theme.primaryForeground },
  preferenceSwitchRow: { minHeight: 60, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderColor: theme.border },
  preferenceSwitchLabel: { color: theme.foreground, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  preferenceHelp: { color: theme.mutedForeground, fontSize: 13, lineHeight: 20, marginTop: 20 },

  emptyText: { textAlign: 'center', color: theme.mutedForeground, fontSize: 16, fontWeight: '500' },
  emptyStateContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 40, paddingHorizontal: 20 },
  errorMessage: { color: theme.destructiveForeground, backgroundColor: theme.destructive, padding: 12, borderRadius: 12, marginBottom: 16, textAlign: 'center', fontWeight: '600' },
  disruptionList: { gap: 8, marginBottom: 14 },
  disruptionNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderRadius: 14, backgroundColor: theme.card, padding: 12 },
  disruptionCopy: { flex: 1 },
  disruptionTitle: { color: theme.foreground, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  disruptionMessage: { color: theme.foreground, fontSize: 14, fontWeight: '600', lineHeight: 20, marginTop: 2 },
});
