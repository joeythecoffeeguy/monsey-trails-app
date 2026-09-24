import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { LiveActivity } from 'expo-widgets';
import type { PassengerTripActivityProps } from './passenger-trip-activity-types';

export type {
  PassengerTripActivityPhase,
  PassengerTripActivityProps,
} from './passenger-trip-activity-types';

export type PassengerTripActivityResult =
  | { supported: true; activityId: string }
  | { supported: false; reason: 'unsupported-platform' | 'expo-go' | 'native-module-unavailable' };

export type PassengerTripActivityRecovery =
  | { supported: true; activityIds: string[] }
  | {
      supported: false;
      reason: 'unsupported-platform' | 'expo-go' | 'native-module-unavailable';
    };

export type PassengerTripPushTokenEvent = {
  activityId: string;
  pushToken: string;
};

export type PassengerTripPushTokenSubscription = {
  remove(): void;
};

type ActivityFactory = {
  start(props: PassengerTripActivityProps, url?: string, staleDate?: Date): LiveActivity<PassengerTripActivityProps>;
  getInstances(): LiveActivity<PassengerTripActivityProps>[];
};

const LIVE_DATA_MAX_AGE_MS = 90_000;

let cachedFactory: ActivityFactory | null = null;
let factoryAttempted = false;
let factoryFailure: 'unsupported-platform' | 'expo-go' | 'native-module-unavailable' =
  'native-module-unavailable';

const pushTokenListeners = new Set<(event: PassengerTripPushTokenEvent) => void>();
const nativePushTokenSubscriptions = new Map<string, { remove(): void }>();

function activityFactory(): ActivityFactory | null {
  if (Platform.OS !== 'ios') {
    factoryFailure = 'unsupported-platform';
    return null;
  }
  if (Constants.executionEnvironment === 'storeClient' && Constants.appOwnership === 'expo') {
    factoryFailure = 'expo-go';
    return null;
  }
  if (factoryAttempted) return cachedFactory;
  factoryAttempted = true;

  try {
    // Load lazily so web and Expo Go never evaluate the native widget module.
    const module = require('./PassengerTripActivity') as { default: ActivityFactory };
    cachedFactory = module.default;
    return cachedFactory;
  } catch {
    factoryFailure = 'native-module-unavailable';
    return null;
  }
}

function staleDateFor(props: PassengerTripActivityProps): Date {
  const updatedAt = new Date(props.updatedAt);
  return new Date(
    (Number.isFinite(updatedAt.getTime()) ? updatedAt.getTime() : Date.now())
      + LIVE_DATA_MAX_AGE_MS,
  );
}

function notifyPushToken(event: PassengerTripPushTokenEvent) {
  pushTokenListeners.forEach((listener) => listener(event));
}

function watchPushToken(instance: LiveActivity<PassengerTripActivityProps>) {
  const activityId = instance.getId();
  if (!activityId || nativePushTokenSubscriptions.has(activityId) || pushTokenListeners.size === 0) {
    return;
  }

  const subscription = instance.addPushTokenListener(notifyPushToken);
  nativePushTokenSubscriptions.set(activityId, subscription);
  void instance.getPushToken().then((pushToken) => {
    if (pushToken) notifyPushToken({ activityId, pushToken });
  }).catch(() => {
    // A token can be unavailable until ActivityKit issues one; listener remains active.
  });
}

function stopWatchingPushTokens() {
  nativePushTokenSubscriptions.forEach((subscription) => subscription.remove());
  nativePushTokenSubscriptions.clear();
}

/**
 * Indicates whether this runtime can use native iOS Live Activities.
 * Web, Android, Expo Go, and builds missing the native module return false.
 */
export function isPassengerTripLiveActivityAvailable(): boolean {
  return activityFactory() !== null;
}

/**
 * Opt in to a new passenger trip Live Activity. Call only after the passenger
 * chooses to track a trip. `updatedAt` anchors stale-data handling; ETA does not
 * count down locally. An invalid timestamp is treated as stale immediately.
 */
export async function startPassengerTripActivity(
  props: PassengerTripActivityProps,
): Promise<PassengerTripActivityResult> {
  const factory = activityFactory();
  if (!factory) return { supported: false, reason: factoryFailure };

  try {
    const instance = factory.start(props, undefined, staleDateFor(props));
    watchPushToken(instance);
    return { supported: true, activityId: instance.getId() };
  } catch {
    return { supported: false, reason: 'native-module-unavailable' };
  }
}

/**
 * Recover active activities after app relaunch. ActivityKit exposes identifiers
 * through `getInstances`; pass a returned ID to update/end a specific instance.
 */
export function recoverPassengerTripActivities(): PassengerTripActivityRecovery {
  const factory = activityFactory();
  if (!factory) return { supported: false, reason: factoryFailure };

  try {
    const instances = factory.getInstances();
    instances.forEach(watchPushToken);
    return { supported: true, activityIds: instances.map((instance) => instance.getId()) };
  } catch {
    return { supported: false, reason: 'native-module-unavailable' };
  }
}

/**
 * Push updated server/app data to the selected activity. When `activityId` is
 * omitted, updates all recovered activities of this type. Never invents or
 * animates ETA data between actual updates.
 */
export async function updatePassengerTripActivity(
  props: PassengerTripActivityProps,
  activityId?: string,
): Promise<{ supported: boolean; updated: number; reason?: string }> {
  const factory = activityFactory();
  if (!factory) return { supported: false, updated: 0, reason: factoryFailure };

  try {
    const instances = factory.getInstances().filter(
      (instance) => !activityId || instance.getId() === activityId,
    );
    await Promise.all(instances.map(async (instance) => {
      watchPushToken(instance);
      if (props.phase === 'ended') {
        // A last GPS timestamp may precede an APNs push. End must be newer than
        // the latest content or ActivityKit can ignore the terminal update.
        await instance.end('immediate', props, new Date());
      } else {
        await instance.update(props, staleDateFor(props));
      }
    }));
    return { supported: true, updated: instances.length };
  } catch {
    return { supported: false, updated: 0, reason: 'native-module-unavailable' };
  }
}

/**
 * End one or all active passenger-trip activities. With final props, include the
 * `phase: 'ended'` state; without them ActivityKit simply dismisses the activity.
 */
export async function endPassengerTripActivity(
  activityId?: string,
  finalProps?: PassengerTripActivityProps,
): Promise<{ supported: boolean; ended: number; reason?: string }> {
  const factory = activityFactory();
  if (!factory) return { supported: false, ended: 0, reason: factoryFailure };

  try {
    const instances = factory.getInstances().filter(
      (instance) => !activityId || instance.getId() === activityId,
    );
    await Promise.all(instances.map((instance) => instance.end(
      'immediate',
      finalProps,
      new Date(),
    )));
    return { supported: true, ended: instances.length };
  } catch {
    return { supported: false, ended: 0, reason: 'native-module-unavailable' };
  } finally {
    try {
      if (factory.getInstances().length === 0) stopWatchingPushTokens();
    } catch {
      // A disappearing ActivityKit instance should not escape the controller.
    }
  }
}

/**
 * Listen for per-activity APNs token availability/changes. Existing active
 * instances are watched immediately; newly started or recovered ones are added
 * while this subscription is active. The caller owns token delivery/storage.
 */
export function addPassengerTripPushTokenListener(
  listener: (event: PassengerTripPushTokenEvent) => void,
): PassengerTripPushTokenSubscription {
  const factory = activityFactory();
  if (!factory) return { remove() {} };

  pushTokenListeners.add(listener);
  try {
    factory.getInstances().forEach(watchPushToken);
  } catch {
    // Preserve the subscription: future activities can still emit token changes.
  }

  return {
    remove() {
      pushTokenListeners.delete(listener);
      if (pushTokenListeners.size === 0) stopWatchingPushTokens();
    },
  };
}