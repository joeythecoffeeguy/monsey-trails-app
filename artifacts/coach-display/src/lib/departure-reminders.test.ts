import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  departureReminderPermissionState,
  prepareWebDepartureReminderDelivery,
  webDepartureRemindersSupported,
} from './departure-reminders';

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('web departure reminder permission handling', () => {
  it('reports unsupported without service worker push capabilities', () => {
    expect(webDepartureRemindersSupported()).toBe(false);
    expect(departureReminderPermissionState()).toBe('unsupported');
  });

  it('surfaces a blocked notification permission instead of creating a timer', async () => {
    Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
    vi.stubGlobal('PushManager', class PushManager {});
    vi.stubGlobal('Notification', {
      permission: 'denied',
      requestPermission: vi.fn().mockResolvedValue('denied'),
    });

    expect(webDepartureRemindersSupported()).toBe(true);
    await expect(prepareWebDepartureReminderDelivery()).rejects.toThrow(/blocked/i);
    expect(Notification.requestPermission).toHaveBeenCalledOnce();
  });
});