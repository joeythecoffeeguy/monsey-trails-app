const CAPABILITY_KEY = 'admin-notification-browser-capability';

function decodeVapidKey(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(bytes, character => character.charCodeAt(0));
}

function browserCapability() {
  let value = sessionStorage.getItem(CAPABILITY_KEY);
  if (!value) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    value = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    sessionStorage.setItem(CAPABILITY_KEY, value);
  }
  return value;
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { accept: 'application/json', ...init?.headers },
  });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body as T;
}

export function adminNotificationSupport() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { state: 'unsupported' as const, detail: 'This browser does not support background web notifications.' };
  }
  if (Notification.permission === 'denied') {
    return { state: 'denied' as const, detail: 'Notifications are blocked in this browser’s site settings.' };
  }
  return { state: Notification.permission as 'default' | 'granted', detail: null };
}

/** Must only be called directly from the administrator's button gesture. */
export async function registerCurrentAdminBrowser() {
  if (adminNotificationSupport().state === 'unsupported') throw new Error('Background notifications are not supported in this browser.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');
  const [{ publicKey }, registration] = await Promise.all([
    jsonRequest<{ publicKey: string }>('/api/passenger/departure-reminders/push-public-key'),
    navigator.serviceWorker.ready,
  ]);
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(publicKey),
    });
  }
  await jsonRequest('/api/admin/notifications/device', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ capability: browserCapability(), subscription: subscription.toJSON() }),
  });
}

export async function sendCurrentAdminBrowserTest() {
  const capability = sessionStorage.getItem(CAPABILITY_KEY);
  if (!capability) throw new Error('Register this browser before sending a test.');
  return jsonRequest<{ state: 'accepted'; message: string }>('/api/admin/notifications/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ capability }),
  });
}

export async function getAdminNotificationHealth() {
  return jsonRequest<AdminNotificationHealth>('/api/admin/notifications/health');
}

type Aggregate = {
  total: number;
  failures: number;
  lastAttemptAt: string | null;
};

export type AdminNotificationHealth = {
  passengerAlerts: Aggregate & { pending: number; accepted: number };
  departureReminders: Aggregate & { active: number; accepted: number; invalidDevices: number };
  webStopSubscriptions: number;
  adminTestDevices: { registered: number; invalid: number; failures: number; lastAttemptAt: string | null };
  background: { ready: boolean; detail: string };
  semantics: string;
};