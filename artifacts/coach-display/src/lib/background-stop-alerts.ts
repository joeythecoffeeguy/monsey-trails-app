import {
  deletePassengerPushSubscription,
  getPassengerPushPublicKey,
  savePassengerPushSubscription,
} from '@/providers/live-trip';

const DISPLAY_ID_KEY = 'coach-passenger-push-display-id';
const SELECTED_STOP_KEY = 'coach-passenger-alert-stop';

export interface SelectedStopAlert {
  key: string;
  label: string;
}

function getPushDisplayId() {
  const existing = localStorage.getItem(DISPLAY_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(DISPLAY_ID_KEY, id);
  return id;
}

function applicationServerKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export function getSelectedStopAlert(): SelectedStopAlert | null {
  try {
    const value = JSON.parse(localStorage.getItem(SELECTED_STOP_KEY) ?? 'null') as SelectedStopAlert | null;
    return value?.key && value.label ? value : null;
  } catch {
    return null;
  }
}

export function backgroundAlertsSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function enableBackgroundStopAlert(stop: SelectedStopAlert) {
  if (!backgroundAlertsSupported()) {
    throw new Error('On iPhone, add this app to your Home Screen, then open it there to enable alerts.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications are blocked. Allow them in your phone settings and try again.');
  }
  const registration = await navigator.serviceWorker.ready;
  const { publicKey } = await getPassengerPushPublicKey();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: applicationServerKey(publicKey),
    });
  }
  await savePassengerPushSubscription({
    displayId: getPushDisplayId(),
    stopKey: stop.key,
    stopLabel: stop.label,
    subscription: subscription.toJSON(),
  });
  localStorage.setItem(SELECTED_STOP_KEY, JSON.stringify(stop));
  return stop;
}

export async function disableBackgroundStopAlert() {
  const displayId = getPushDisplayId();
  await deletePassengerPushSubscription(displayId);
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  await subscription?.unsubscribe();
  localStorage.removeItem(SELECTED_STOP_KEY);
}