import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import {
  endPassengerLiveActivity,
  getGetPassengerLiveActivityAvailabilityQueryKey,
  registerPassengerLiveActivity,
  updatePassengerLiveActivityToken,
  useGetPassengerLiveActivityAvailability,
  type PassengerJourneyProgress,
} from '@workspace/api-client-react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/AppText';
import { Surface } from '@/components/Surface';
import { useColors } from '@/hooks/useColors';
import { passengerTripActivityProps } from '@/lib/live-activity-presentation';
import { canOptInToPassengerLiveActivity } from '@/lib/passenger-live-activity-eligibility';
import {
  PASSENGER_LIVE_ACTIVITY_STORAGE_KEY,
  parsePassengerLiveActivityRecords,
  passengerLiveActivityMatchesIdentity,
  removePassengerLiveActivityRecord,
  upsertPassengerLiveActivityRecord,
  type PassengerLiveActivityIdentity,
  type PassengerLiveActivityRecord,
} from '@/lib/passenger-live-activity-storage';
import { passengerRealtimeCapability } from '@/lib/realtime-alerts';
import {
  addPassengerTripPushTokenListener,
  endPassengerTripActivity,
  isPassengerTripLiveActivityAvailable,
  recoverPassengerTripActivities,
  startPassengerTripActivity,
  updatePassengerTripActivity,
  type PassengerTripActivityProps,
  type PassengerTripPushTokenSubscription,
} from './lib/passenger-trip-activity';

export type LiveActivityTrackingCardProps = {
  runKey: string;
  lineName: string;
  coachNumber: string;
  passengerCode?: string | null;
  pickupStopId?: string;
  pickupLabel: string;
  dropoffStopId?: string;
  dropoffLabel: string;
  tripStatus?: string | null;
  tripAssigned: boolean;
  tripSnapshotCurrent: boolean;
  publishedRunVerified: boolean;
  locationIsLive: boolean;
  locationUpdatedAt?: string | null;
  progress?: PassengerJourneyProgress[] | null;
  definitiveTripEnd: boolean;
};

type Props = LiveActivityTrackingCardProps;

async function ownerRequestOptions() {
  return {
    headers: {
      'x-passenger-realtime-capability': await passengerRealtimeCapability(),
    },
  };
}

function isAlreadyEndedError(error: unknown) {
  const value = error as { status?: number; response?: { status?: number }; message?: string };
  return value?.status === 404
    || value?.response?.status === 404
    || /(^|\D)404(\D|$)|not found/i.test(value?.message ?? '');
}

function registrationBody(
  identity: PassengerLiveActivityIdentity,
  clientActivityId: string,
  pushToken?: string,
) {
  return {
    ...identity,
    clientActivityId,
    ...(pushToken ? { pushToken } : {}),
  };
}

export function LiveActivityTrackingCard(props: Props) {
  const theme = useColors();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const nativeAvailable = isPassengerTripLiveActivityAvailable();
  const availabilityQuery = useGetPassengerLiveActivityAvailability({
    query: {
      enabled: Platform.OS === 'ios',
      queryKey: getGetPassengerLiveActivityAvailabilityQueryKey(),
      staleTime: 30_000,
      retry: 1,
    },
  });
  const identity = useMemo<PassengerLiveActivityIdentity | null>(() => {
    if (!props.passengerCode || !props.pickupStopId || !props.dropoffStopId) return null;
    return {
      runKey: props.runKey,
      passengerCode: props.passengerCode,
      pickupStopId: props.pickupStopId,
      dropoffStopId: props.dropoffStopId,
    };
  }, [props.dropoffStopId, props.passengerCode, props.pickupStopId, props.runKey]);
  const identityKey = identity
    ? `${identity.runKey}\u001f${identity.passengerCode}\u001f${identity.pickupStopId}\u001f${identity.dropoffStopId}`
    : '';
  const eligible = canOptInToPassengerLiveActivity({
    tripStatus: props.tripStatus,
    tripAssigned: props.tripAssigned,
    tripSnapshotCurrent: props.tripSnapshotCurrent,
    publishedRunVerified: props.publishedRunVerified,
    passengerCode: identity?.passengerCode,
    pickupStopId: identity?.pickupStopId,
    dropoffStopId: identity?.dropoffStopId,
  });
  const activityProps = useMemo<PassengerTripActivityProps | null>(() => {
    if (!identity || !props.tripStatus || !props.publishedRunVerified) return null;
    return passengerTripActivityProps({
      lineName: props.lineName,
      coachNumber: props.coachNumber,
      pickupStopId: identity.pickupStopId,
      pickupLabel: props.pickupLabel,
      dropoffStopId: identity.dropoffStopId,
      dropoffLabel: props.dropoffLabel,
      tripStatus: props.tripStatus,
      locationIsLive: props.locationIsLive,
      locationUpdatedAt: props.locationUpdatedAt,
      progress: props.progress,
    });
  }, [
    identity,
    props.coachNumber,
    props.dropoffLabel,
    props.lineName,
    props.locationIsLive,
    props.locationUpdatedAt,
    props.pickupLabel,
    props.progress,
    props.publishedRunVerified,
    props.tripStatus,
  ]);
  const [record, setRecord] = useState<PassengerLiveActivityRecord | null>(null);
  const recordRef = useRef<PassengerLiveActivityRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [unknownNativeActivity, setUnknownNativeActivity] = useState(false);
  const [lockUpdatesConnected, setLockUpdatesConnected] = useState(false);
  const [recoveryCompleteIdentity, setRecoveryCompleteIdentity] = useState('');
  const listenerRef = useRef<PassengerTripPushTokenSubscription | null>(null);
  const activityTokenCacheRef = useRef(new Map<string, string>());
  const pendingTokenRef = useRef<string | null>(null);
  const submittedTokenRef = useRef<string | null>(null);
  const tokenPatchPromiseRef = useRef<Promise<void> | null>(null);
  const lastUpdatedPropsRef = useRef<string | null>(null);
  const recoveringIdentityRef = useRef('');
  const autoEndedIdentityRef = useRef('');

  const publishRecord = useCallback((next: PassengerLiveActivityRecord | null) => {
    recordRef.current = next;
    setRecord(next);
  }, []);

  const persistUpsert = useCallback(async (next: PassengerLiveActivityRecord) => {
    const records = parsePassengerLiveActivityRecords(
      await AsyncStorage.getItem(PASSENGER_LIVE_ACTIVITY_STORAGE_KEY),
    );
    await AsyncStorage.setItem(
      PASSENGER_LIVE_ACTIVITY_STORAGE_KEY,
      JSON.stringify(upsertPassengerLiveActivityRecord(records, next)),
    );
    if (identity && passengerLiveActivityMatchesIdentity(next, identity)) publishRecord(next);
  }, [identity, publishRecord]);

  const persistRemoval = useCallback(async (clientActivityId: string) => {
    const records = parsePassengerLiveActivityRecords(
      await AsyncStorage.getItem(PASSENGER_LIVE_ACTIVITY_STORAGE_KEY),
    );
    await AsyncStorage.setItem(
      PASSENGER_LIVE_ACTIVITY_STORAGE_KEY,
      JSON.stringify(removePassengerLiveActivityRecord(records, clientActivityId)),
    );
    if (recordRef.current?.clientActivityId === clientActivityId) publishRecord(null);
  }, [publishRecord]);

  const patchPushToken = useCallback(async (
    current: PassengerLiveActivityRecord,
    pushToken: string,
  ) => {
    pendingTokenRef.current = pushToken;
    if (!current.serverId) {
      return;
    }
    if (tokenPatchPromiseRef.current) return tokenPatchPromiseRef.current;

    let failed = false;
    const updateTokens = async () => {
      while (pendingTokenRef.current) {
        const token = pendingTokenRef.current;
        pendingTokenRef.current = null;
        if (submittedTokenRef.current === token) continue;
        try {
          await updatePassengerLiveActivityToken(
            current.serverId!,
            { pushToken: token },
            await ownerRequestOptions(),
          );
          submittedTokenRef.current = token;
          setLockUpdatesConnected(true);
          setMessage('Live Activity is on. Its APNs token is registered so the service can send Lock Screen updates; old coach locations are still marked out of date.');
          setIsError(false);
        } catch {
          // Keep a newer token if ActivityKit rotated it during the request.
          pendingTokenRef.current ??= token;
          failed = true;
          setLockUpdatesConnected(false);
          setMessage('The activity is visible, but APNs could not connect Lock Screen updates. Check your connection and retry.');
          setIsError(true);
          return;
        }
      }
    };

    const updatePromise = updateTokens();
    tokenPatchPromiseRef.current = updatePromise;
    try {
      await updatePromise;
    } finally {
      if (tokenPatchPromiseRef.current === updatePromise) tokenPatchPromiseRef.current = null;
      const pending = pendingTokenRef.current;
      if (!failed && pending && pending !== submittedTokenRef.current) {
        void patchPushToken(current, pending);
      }
    }
  }, []);

  const stopTracking = useCallback(async (target = recordRef.current, finalProps?: PassengerTripActivityProps) => {
    if (!target || busy) return;
    setBusy(true);
    setMessage('');
    setIsError(false);
    try {
      if (target.serverId) {
        try {
          await endPassengerLiveActivity(target.serverId, await ownerRequestOptions());
        } catch (error) {
          if (!isAlreadyEndedError(error)) {
            setMessage('Could not stop server-side Lock Screen updates. Check your connection and try again.');
            setIsError(true);
            return;
          }
        }
      }

      const ended = await endPassengerTripActivity(target.clientActivityId, finalProps);
      if (!ended.supported) {
        setMessage('The server tracking was stopped, but this app could not close the iPhone activity. Open the app in its installed iOS build and try again.');
        setIsError(true);
        return;
      }
      await persistRemoval(target.clientActivityId);
      pendingTokenRef.current = null;
      submittedTokenRef.current = null;
      lastUpdatedPropsRef.current = null;
      setLockUpdatesConnected(false);
      setMessage('Live Activity stopped.');
    } catch {
      setMessage('Could not clear the saved Live Activity. Check device storage and try again.');
      setIsError(true);
    } finally {
      setBusy(false);
    }
  }, [busy, persistRemoval]);

  useEffect(() => {
    if (!identity || !identityKey || recoveringIdentityRef.current === identityKey) return;
    recoveringIdentityRef.current = identityKey;
    let cancelled = false;
    let recoveryChecked = false;

    void (async () => {
      setBusy(true);
      setMessage('');
      try {
        const records = parsePassengerLiveActivityRecords(
          await AsyncStorage.getItem(PASSENGER_LIVE_ACTIVITY_STORAGE_KEY),
        );
        const recovered = recoverPassengerTripActivities();
        if (cancelled) return;
        if (!recovered.supported) {
          setMessage('This app cannot recover iPhone Live Activities here. Use the installed iOS app, not Expo Go or web preview.');
          return;
        }
        recoveryChecked = true;

        const matching = records.find(item => passengerLiveActivityMatchesIdentity(item, identity));
        const activeIds = new Set(recovered.activityIds);
        setUnknownNativeActivity(recovered.activityIds.some(id =>
          !records.some(item => item.clientActivityId === id),
        ));

        if (!matching) return;
        if (!activeIds.has(matching.clientActivityId)) {
          if (matching.serverId) {
            try {
              await endPassengerLiveActivity(matching.serverId, await ownerRequestOptions());
            } catch (error) {
              if (!isAlreadyEndedError(error)) {
                if (!cancelled) {
                  publishRecord(matching);
                  setMessage('A saved activity needs cleanup, but the server could not be reached. Retry Stop before starting another.');
                  setIsError(true);
                }
                return;
              }
            }
          }
          await persistRemoval(matching.clientActivityId);
          if (!cancelled) setMessage('The previous Live Activity is no longer active.');
          return;
        }

        if (cancelled) return;
        publishRecord(matching);
        try {
          const initialToken = activityTokenCacheRef.current.get(matching.clientActivityId) ?? undefined;
          pendingTokenRef.current = initialToken ?? null;
          const registration = await registerPassengerLiveActivity(
            registrationBody(identity, matching.clientActivityId, initialToken),
            await ownerRequestOptions(),
          );
          const updated = { ...matching, serverId: registration.id };
          await persistUpsert(updated);
          if (initialToken) submittedTokenRef.current = initialToken;
          const latestToken = pendingTokenRef.current;
          if (latestToken && latestToken !== submittedTokenRef.current) {
            await patchPushToken(updated, latestToken);
          } else if (initialToken) {
            setLockUpdatesConnected(true);
          }
          if (!cancelled) {
            setMessage(submittedTokenRef.current
              ? 'Live Activity recovered. Its APNs token is registered so the service can send Lock Screen updates.'
              : 'Live Activity recovered. Lock Screen updates connect after ActivityKit issues its APNs token.');
            setIsError(false);
          }
        } catch {
          if (!cancelled) {
            setMessage('The iPhone activity was recovered, but server registration failed. Check your connection before relying on Lock Screen updates.');
            setIsError(true);
          }
        }
      } catch {
        if (!cancelled) {
          setMessage('Saved Live Activity recovery failed. Check device storage and reopen this run.');
          setIsError(true);
        }
      } finally {
        if (!cancelled) {
          if (recoveryChecked) setRecoveryCompleteIdentity(identityKey);
          setBusy(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [identity, identityKey, patchPushToken, persistRemoval, persistUpsert, publishRecord]);

  useEffect(() => {
    if (!nativeAvailable || !identity) return;
    const subscription = addPassengerTripPushTokenListener(event => {
      activityTokenCacheRef.current.set(event.activityId, event.pushToken);
      const current = recordRef.current;
      if (
        !current
        || current.clientActivityId !== event.activityId
        || !passengerLiveActivityMatchesIdentity(current, identity)
      ) return;
      pendingTokenRef.current = event.pushToken;
      if (current.serverId) void patchPushToken(current, event.pushToken);
    });
    listenerRef.current = subscription;
    return () => {
      subscription.remove();
      if (listenerRef.current === subscription) listenerRef.current = null;
    };
  }, [identity, nativeAvailable, patchPushToken]);

  useEffect(() => {
    const current = record;
    if (!current || !identity || !activityProps
        || !passengerLiveActivityMatchesIdentity(current, identity)) return;
    const serialized = JSON.stringify(activityProps);
    if (lastUpdatedPropsRef.current === serialized) return;
    lastUpdatedPropsRef.current = serialized;
    void updatePassengerTripActivity(activityProps, current.clientActivityId).then(result => {
      if (!result.supported) {
        setMessage('Could not update the on-device activity. Keep this app open and check the iPhone build.');
        setIsError(true);
      }
    }).catch(() => {
      setMessage('Could not update the on-device activity. Check the iPhone app before relying on its status.');
      setIsError(true);
    });
  }, [activityProps, identity, record]);

  useEffect(() => {
    if (!props.definitiveTripEnd || !record || busy
        || autoEndedIdentityRef.current === `${identityKey}:${record.clientActivityId}`) return;
    autoEndedIdentityRef.current = `${identityKey}:${record.clientActivityId}`;
    void stopTracking(record, activityProps ?? undefined);
  }, [activityProps, busy, identityKey, props.definitiveTripEnd, record, stopTracking]);

  const startTracking = useCallback(async () => {
    if (!identity || !eligible || !activityProps || busy) return;
    setBusy(true);
    setMessage('');
    setIsError(false);
    setLockUpdatesConnected(false);
    let previousRecords: PassengerLiveActivityRecord[] = [];
    let nativeActivityId: string | null = null;
    let serverActivityId: string | null = null;

    try {
      previousRecords = parsePassengerLiveActivityRecords(
        await AsyncStorage.getItem(PASSENGER_LIVE_ACTIVITY_STORAGE_KEY),
      );
      const started = await startPassengerTripActivity(activityProps);
      if (!started.supported) {
        setMessage(started.reason === 'expo-go'
          ? 'Expo Go cannot start Live Activities. Install a native iOS build to opt in.'
          : 'Live Activities are not supported in this app environment. Use the installed iOS app.');
        setIsError(true);
        return;
      }
      nativeActivityId = started.activityId;
      const next: PassengerLiveActivityRecord = {
        ...identity,
        clientActivityId: started.activityId,
        serverId: null,
      };
      // Persist before server registration so process death cannot create an untracked duplicate.
      await AsyncStorage.setItem(
        PASSENGER_LIVE_ACTIVITY_STORAGE_KEY,
        JSON.stringify(upsertPassengerLiveActivityRecord(previousRecords, next)),
      );
      publishRecord(next);
      lastUpdatedPropsRef.current = JSON.stringify(activityProps);
      pendingTokenRef.current = activityTokenCacheRef.current.get(started.activityId) ?? null;

      const initialToken = pendingTokenRef.current ?? undefined;
      const registered = await registerPassengerLiveActivity(
        registrationBody(identity, started.activityId, initialToken),
        await ownerRequestOptions(),
      );
      serverActivityId = registered.id;
      const registeredRecord = { ...next, serverId: registered.id };
      await persistUpsert(registeredRecord);
      if (initialToken) submittedTokenRef.current = initialToken;

      const latestToken = pendingTokenRef.current;
      if (latestToken && latestToken !== submittedTokenRef.current) {
        await patchPushToken(registeredRecord, latestToken);
      } else if (initialToken) {
        setLockUpdatesConnected(true);
        setMessage('Live Activity started. Its APNs token is registered so the service can send Lock Screen updates; old coach locations are still marked out of date.');
      } else {
        setMessage('Live Activity started on this iPhone. Lock Screen updates are waiting for ActivityKit to issue an APNs token.');
      }
    } catch {
      if (serverActivityId) {
        try {
          await endPassengerLiveActivity(serverActivityId, await ownerRequestOptions());
        } catch {
          // Attempt local dismissal even if the server record cannot be reached.
        }
      }
      if (nativeActivityId) {
        const ended = await endPassengerTripActivity(nativeActivityId);
        if (ended.supported) {
          await AsyncStorage.setItem(
            PASSENGER_LIVE_ACTIVITY_STORAGE_KEY,
            JSON.stringify(removePassengerLiveActivityRecord(previousRecords, nativeActivityId)),
          );
          publishRecord(null);
          pendingTokenRef.current = null;
          submittedTokenRef.current = null;
        }
      }
      setMessage('Could not register this exact trip with the Live Activity service. Check the selected run and connection, then try again.');
      setIsError(true);
    } finally {
      setBusy(false);
    }
  }, [
    activityProps,
    busy,
    eligible,
    identity,
    patchPushToken,
    persistUpsert,
    publishRecord,
  ]);

  const retryTokenRegistration = useCallback(async () => {
    const current = recordRef.current;
    const token = pendingTokenRef.current;
    if (!current || !token) return;
    setBusy(true);
    await patchPushToken(current, token);
    setBusy(false);
  }, [patchPushToken]);

  const availabilityMessage = useMemo(() => {
    if (!nativeAvailable) {
      if (Platform.OS === 'web') return 'Live Activities are available only in a supported installed iOS app, not web preview.';
      if (Platform.OS !== 'ios') return 'Live Activities are available only on iPhone.';
      return 'Expo Go does not include Live Activity support. Install the native iOS app to opt in.';
    }
    if (availabilityQuery.isError) return 'Could not verify APNs availability. Check your connection and try again.';
    if (availabilityQuery.data?.available === false) return 'Lock Screen updates are unavailable because APNs is not configured on the service.';
    if (!availabilityQuery.data && availabilityQuery.isFetching) return 'Checking whether the service is configured for APNs Lock Screen delivery…';
    if (!identity) return 'Choose your exact pickup and drop-off before starting a Live Activity.';
    if (!eligible) return 'Live Activities can start only for this exact published run after a coach is assigned and the trip is running.';
    if (unknownNativeActivity) return 'An unrecognized activity is already active. Stop it from the iPhone Live Activity before starting another.';
    return 'Shows your selected stops and honest coach status. Lock Screen updates require the service APNs connection.';
  }, [
    availabilityQuery.data?.available,
    availabilityQuery.isError,
    eligible,
    identity,
    nativeAvailable,
    unknownNativeActivity,
  ]);
  const canStart = eligible
    && nativeAvailable
    && availabilityQuery.data?.available === true
    && !availabilityQuery.isError
    && !availabilityQuery.isFetching
    && recoveryCompleteIdentity === identityKey
    && !unknownNativeActivity
    && !record
    && !busy;

  return (
    <Surface variant="card" style={styles.card} testID="live-activity-tracking-card">
      <View style={styles.header}>
        <View style={styles.titleLine}>
          <Feather name="smartphone" size={18} color={theme.primary} />
          <AppText style={styles.title}>Live Activity tracking</AppText>
        </View>
        {availabilityQuery.isFetching && !availabilityQuery.data
          ? <ActivityIndicator size="small" color={theme.primary} />
          : null}
      </View>
      <AppText style={styles.description}>
        {record
          ? lockUpdatesConnected
            ? 'This trip is being tracked. Its APNs token is registered for server updates; stale coach data will not keep showing a live ETA.'
            : 'This trip is visible in a Live Activity. Background Lock Screen updates are not confirmed until its APNs token is registered.'
          : availabilityMessage}
      </AppText>
      {message ? (
        <AppText style={[styles.message, isError ? styles.error : null]} accessibilityLiveRegion="polite">
          {message}
        </AppText>
      ) : null}
      {!availabilityQuery.data && availabilityQuery.isError ? (
        <Pressable
          accessibilityRole="button"
          disabled={availabilityQuery.isFetching}
          onPress={() => void availabilityQuery.refetch()}
          style={styles.retry}
        >
          <AppText style={styles.retryText}>Retry APNs availability check</AppText>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: record ? busy : !canStart }}
        accessibilityLabel={record ? 'Stop Live Activity tracking' : 'Start Live Activity tracking'}
        disabled={record ? busy : !canStart}
        onPress={() => record ? void stopTracking() : void startTracking()}
        style={[
          styles.action,
          (record ? busy : !canStart) && styles.disabled,
          record && styles.stopAction,
        ]}
        testID="toggle-live-activity-tracking"
      >
        {busy
          ? <ActivityIndicator size="small" color={record ? theme.destructive : theme.primaryForeground} />
          : <Feather name={record ? 'square' : 'play-circle'} size={17} color={record ? theme.destructive : theme.primaryForeground} />}
        <AppText style={[styles.actionText, record && styles.stopActionText]}>
          {busy ? 'Working…' : record ? 'Stop tracking' : 'Start Live Activity'}
        </AppText>
      </Pressable>
      {record && pendingTokenRef.current ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void retryTokenRegistration()}
          style={styles.retry}
        >
          <AppText style={styles.retryText}>Retry Lock Screen connection</AppText>
        </Pressable>
      ) : null}
    </Surface>
  );
}

function createStyles(theme: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: { padding: 16, marginBottom: 14, borderColor: theme.border },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    titleLine: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
    title: { color: theme.foreground, fontSize: 16, fontWeight: '800', flexShrink: 1 },
    description: { color: theme.mutedForeground, fontSize: 12, lineHeight: 18, marginTop: 8 },
    message: { color: theme.foreground, fontSize: 12, lineHeight: 18, fontWeight: '600', marginTop: 8 },
    error: { color: theme.destructive },
    action: { minHeight: 44, borderRadius: 999, backgroundColor: theme.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, marginTop: 12 },
    disabled: { opacity: 0.48 },
    actionText: { color: theme.primaryForeground, fontSize: 13, fontWeight: '800' },
    stopAction: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.destructive },
    stopActionText: { color: theme.destructive },
    retry: { minHeight: 40, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
    retryText: { color: theme.secondary, fontSize: 12, fontWeight: '800' },
  });
}