import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import {
  createPassengerRealtimeSubscription,
  deletePassengerRealtimeSubscription,
  listPassengerRealtimeSubscriptions,
  updatePassengerRealtimeSubscription,
} from '@workspace/api-client-react';
import { deniedDeparturePermission } from './departure-reminder-permission';
import type { PassengerRealtimeSubscriptionInput } from '@workspace/api-client-react';
import type {
  RealtimeAlertIdentity,
  RealtimeTransferOption,
} from './realtime-alerts-contract';

export {
  buildRealtimeSubscriptionInput,
  canSubscribeToActivePairedRun,
  findRealtimeSubscription,
} from './realtime-alerts-contract';
export type {
  RealtimeAlertIdentity,
  RealtimeAlertsCardProps,
  RealtimeTransferOption,
} from './realtime-alerts-contract';

const CAPABILITY_KEY = 'passenger-realtime-installation-capability-v1';
const CAPABILITY_HEADER = 'x-passenger-realtime-capability';
let capabilityPromise: Promise<string> | null = null;

async function loadOrCreateInstallationCapability() {
  const stored = Platform.OS === 'web'
    ? globalThis.localStorage?.getItem(CAPABILITY_KEY) ?? null
    : await SecureStore.getItemAsync(CAPABILITY_KEY);
  if (stored) {
    if (stored.length < 43 || stored.length > 128) {
      throw new Error('This installation has an invalid realtime-alert capability. Clear app storage and pair again.');
    }
    return stored;
  }

  // Two CSPRNG UUIDs, with separators removed, provide 64 random hex characters.
  const created = `${Crypto.randomUUID()}${Crypto.randomUUID()}`.replaceAll('-', '');
  if (Platform.OS === 'web') {
    if (!globalThis.localStorage) throw new Error('Secure browser storage is unavailable for realtime alerts.');
    globalThis.localStorage.setItem(CAPABILITY_KEY, created);
  } else {
    await SecureStore.setItemAsync(CAPABILITY_KEY, created, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
  return created;
}

export function passengerRealtimeCapability() {
  capabilityPromise ??= loadOrCreateInstallationCapability().catch(error => {
    capabilityPromise = null;
    throw error;
  });
  return capabilityPromise;
}

async function ownerRequestOptions() {
  return { headers: { [CAPABILITY_HEADER]: await passengerRealtimeCapability() } };
}

export type RealtimeNotificationPermission =
  | { status: 'granted'; expoPushToken: string }
  | { status: 'denied'; canAskAgain: boolean; canOpenSettings: boolean; message: string }
  | { status: 'unsupported'; canAskAgain: false; canOpenSettings: false; message: string };

function projectId() {
  return Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId
    ?? process.env.EXPO_PUBLIC_PROJECT_ID;
}

/** Call from a user's explicit activation action only; web push is not implemented here. */
export async function prepareRealtimeNotificationPermission(): Promise<RealtimeNotificationPermission> {
  if (Platform.OS === 'web') {
    return {
      status: 'unsupported',
      canAskAgain: false,
      canOpenSettings: false,
      message: 'Realtime push alerts are not configured for web. Use the installed iOS or Android app.',
    };
  }
  if (!Device.isDevice) {
    return {
      status: 'unsupported',
      canAskAgain: false,
      canOpenSettings: false,
      message: 'Realtime push alerts require a physical iOS or Android device.',
    };
  }

  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) return deniedDeparturePermission(permission)!;

  const expoProjectId = projectId();
  if (!expoProjectId) {
    return {
      status: 'unsupported',
      canAskAgain: false,
      canOpenSettings: false,
      message: 'Push notifications are not configured for this build.',
    };
  }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('passenger-realtime-alerts', {
      name: 'Passenger trip alerts',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  const expoPushToken = (await Notifications.getExpoPushTokenAsync({ projectId: expoProjectId })).data;
  return { status: 'granted', expoPushToken };
}

export async function openRealtimeNotificationSettings() {
  if (Platform.OS !== 'web') await Linking.openSettings();
}

export const passengerRealtimeAlertApi = {
  list: async (deviceId: string) =>
    listPassengerRealtimeSubscriptions({ deviceId }, await ownerRequestOptions()),
  create: async (input: PassengerRealtimeSubscriptionInput) =>
    createPassengerRealtimeSubscription(input, await ownerRequestOptions()),
  update: async (id: string, input: PassengerRealtimeSubscriptionInput) =>
    updatePassengerRealtimeSubscription(id, input, await ownerRequestOptions()),
  cancel: async (id: string) =>
    deletePassengerRealtimeSubscription(id, await ownerRequestOptions()),
};
