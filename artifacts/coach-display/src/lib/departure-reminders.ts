import {
  cancelDepartureReminder,
  createDepartureReminder,
  getDepartureReminderPushPublicKey,
  listDepartureReminders,
  updateDepartureReminder,
  type DepartureReminderInput,
} from '@workspace/api-client-react';

const DEVICE_ID_KEY = 'passenger-departure-reminder-device-id';
const CAPABILITY_KEY = 'passenger-departure-reminder-installation-capability-v1';
const CAPABILITY_HEADER = 'x-departure-reminder-capability';
export const DEFAULT_DEPARTURE_REMINDER_LEAD_MINUTES = 15;

function deviceId() {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

function installationCapability() {
  const existing = localStorage.getItem(CAPABILITY_KEY);
  if (existing) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const capability = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  localStorage.setItem(CAPABILITY_KEY, capability);
  return capability;
}

function ownerRequestOptions() {
  return { headers: { [CAPABILITY_HEADER]: installationCapability() } };
}

function applicationServerKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}

export function webDepartureRemindersSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function departureReminderPermissionState() {
  if (!webDepartureRemindersSupported()) return 'unsupported' as const;
  return Notification.permission;
}

/**
 * Must be invoked by a user gesture. The returned subscription is persisted by
 * the server; no open-tab timer is used or advertised as background delivery.
 */
export async function prepareWebDepartureReminderDelivery(): Promise<
  Extract<DepartureReminderInput['delivery'], { type: 'web' }>
> {
  if (!webDepartureRemindersSupported()) {
    throw new Error('Background reminders require an installed browser with notification support.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications are blocked. Allow them in browser or phone settings and try again.');
  }
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const { publicKey } = await getDepartureReminderPushPublicKey();
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(publicKey),
    });
  }
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error('The browser did not provide a complete push subscription.');
  }
  return {
    type: 'web',
    subscription: {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    },
  };
}

export const webDepartureReminderApi = {
  deviceId,
  list: () => listDepartureReminders({ deviceId: deviceId() }, ownerRequestOptions()),
  create: (input: Omit<DepartureReminderInput, 'deviceId'>) =>
    createDepartureReminder({ ...input, deviceId: deviceId() }, ownerRequestOptions()),
  update: (id: string, input: Omit<DepartureReminderInput, 'deviceId'>) =>
    updateDepartureReminder(id, { ...input, deviceId: deviceId() }, ownerRequestOptions()),
  cancel: (id: string) => cancelDepartureReminder(id, ownerRequestOptions()),
};

/**
 * Trip-picker integration uses the exact published serviceDate, line, origin,
 * destination and runId. Weekly weekdays are ISO 1..7. Show response.policy:
 * recurrence is revalidated and silently skips weekdays with no actual bus.
 */
export type WebDepartureReminderIntegrationProps = {
  selectedTrip: Pick<DepartureReminderInput, 'serviceDate' | 'line' | 'origin' | 'destination' | 'runId'>;
};