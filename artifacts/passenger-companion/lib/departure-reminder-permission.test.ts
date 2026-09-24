import assert from 'node:assert/strict';
import test from 'node:test';
import { deniedDeparturePermission } from './departure-reminder-permission.ts';

test('permission denial offers retry while the OS still allows asking', () => {
  assert.deepEqual(deniedDeparturePermission({ granted: false, canAskAgain: true }), {
    status: 'denied',
    canAskAgain: true,
    canOpenSettings: false,
    message: 'Notification permission was denied. You can try again when you are ready.',
  });
});

test('permanent denial exposes the device settings recovery path', () => {
  const result = deniedDeparturePermission({ granted: false, canAskAgain: false });
  assert.equal(result?.canOpenSettings, true);
  assert.match(result?.message ?? '', /Open device settings/);
});

test('granted permission has no denial state', () => {
  assert.equal(deniedDeparturePermission({ granted: true, canAskAgain: false }), null);
});