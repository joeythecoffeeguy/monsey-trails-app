import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import {
  cancelDepartureReminder,
  createDepartureReminder,
  listDepartureReminders,
  updateDepartureReminder,
  type DepartureReminderInput,
} from '@workspace/api-client-react';
import { deniedDeparturePermission } from './departure-reminder-permission';

export const DEFAULT_DEPARTURE_REMINDER_LEAD_MINUTES = 15;
export const DEPARTURE_REMINDER_LIMITATION =
  'Background reminders require always-on or externally scheduled server processing. This deployment may scale to zero while idle, so reminders can be delayed until processing resumes. Reminders are checked against the latest published schedule; delivery also depends on Apple/Google notification service and network availability.';
const CAPABILITY_KEY = 'departure-reminder-installation-capability-v1';
const CAPABILITY_HEADER = 'x-departure-reminder-capability';

let capabilityPromise: Promise<string> | null = null;
async function loadOrCreateInstallationCapability() {
  const existing = Platform.OS === 'web'
    ? globalThis.localStorage?.getItem(CAPABILITY_KEY) ?? null
    : await SecureStore.getItemAsync(CAPABILITY_KEY);
  if (existing) return existing;
  // Two platform CSPRNG UUIDs provide over 240 random bits after separators
  // are removed. This secret is separate from the shareable device ID.
  const created = `${Crypto.randomUUID()}${Crypto.randomUUID()}`.replaceAll('-', '');
  if (Platform.OS === 'web') globalThis.localStorage?.setItem(CAPABILITY_KEY, created);
  else await SecureStore.setItemAsync(CAPABILITY_KEY, created, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return created;
}

function installationCapability() {
  capabilityPromise ??= loadOrCreateInstallationCapability();
  return capabilityPromise;
}

async function ownerRequestOptions() {
  return { headers: { [CAPABILITY_HEADER]: await installationCapability() } };
}

export type DepartureNotificationPermission =
  | { status: 'granted'; delivery: Extract<DepartureReminderInput['delivery'], { type: 'expo' }> }
  | { status: 'denied'; canAskAgain: boolean; canOpenSettings: boolean; message: string }
  | { status: 'unsupported'; canAskAgain: false; canOpenSettings: false; message: string };

function projectId() {
  return Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId
    ?? process.env.EXPO_PUBLIC_PROJECT_ID;
}

/**
 * Call only from a user gesture. It requests the real OS permission and never
 * substitutes an in-app timer when background delivery is unavailable.
 */
export async function prepareDepartureNotificationPermission(): Promise<DepartureNotificationPermission> {
  if (Platform.OS === 'web') {
    return {
      status: 'unsupported',
      canAskAgain: false,
      canOpenSettings: false,
      message: 'Use the installed web app notification flow on web.',
    };
  }
  if (!Device.isDevice) {
    return {
      status: 'unsupported',
      canAskAgain: false,
      canOpenSettings: false,
      message: 'Departure reminders require a physical device.',
    };
  }
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) {
    return deniedDeparturePermission(permission)!;
  }
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
    await Notifications.setNotificationChannelAsync('departure-reminders', {
      name: 'Departure reminders',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  const expoPushToken = (await Notifications.getExpoPushTokenAsync({ projectId: expoProjectId })).data;
  return { status: 'granted', delivery: { type: 'expo', expoPushToken } };
}

export async function openDepartureNotificationSettings() {
  if (Platform.OS !== 'web') await Linking.openSettings();
}

export const departureReminderApi = {
  list: async (deviceId: string) => listDepartureReminders({ deviceId }, await ownerRequestOptions()),
  create: async (input: DepartureReminderInput) => createDepartureReminder(input, await ownerRequestOptions()),
  update: async (id: string, input: DepartureReminderInput) =>
    updateDepartureReminder(id, input, await ownerRequestOptions()),
  cancel: async (id: string) => cancelDepartureReminder(id, await ownerRequestOptions()),
};

/**
 * Integration contract for the trip-picker owner:
 * - Build line/origin/destination/runId/serviceDate from the selected published run.
 * - For one trip use kind "once" and omit weekdays.
 * - For recurring use kind "weekly" and ISO weekdays (Mon=1..Sun=7).
 * - Default leadMinutes to 15; UI may offer any integer from 5 through 120.
 * - Call prepareDepartureNotificationPermission from the enable button. On denied
 *   with canOpenSettings=true, show an explicit Open Settings action.
 * - Render response.policy and nextOccurrenceAt; edit by PUT and cancel by DELETE.
 */
export type DepartureReminderIntegrationProps = {
  deviceId: string;
  selectedTrip: {
    serviceDate: string;
    line: number;
    origin: number;
    destination: number;
    runId: string;
  };
};