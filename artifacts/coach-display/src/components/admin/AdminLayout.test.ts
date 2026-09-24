import { describe, expect, it } from 'vitest';
import { APP_ROUTES } from '@/lib/app-routes';
import { adminNavDestinations, adminRoleFromAccess } from './AdminLayout';

describe('admin shell permissions', () => {
  it.each(['admin', 'dispatcher', 'content'] as const)('uses the live access response role %s', role => {
    expect(adminRoleFromAccess({ authorized: true, role })).toBe(role);
  });

  it('fails closed when the access response has no recognized role', () => {
    expect(adminRoleFromAccess({ authorized: true })).toBeNull();
    expect(adminRoleFromAccess({ authorized: true, role: 'driver' })).toBeNull();
    expect(adminRoleFromAccess(null)).toBeNull();
  });

  it('keeps each role on destinations backed by its API capabilities', () => {
    expect(adminNavDestinations('dispatcher')).toContain(APP_ROUTES.adminCommunications);
    expect(adminNavDestinations('dispatcher')).not.toContain(APP_ROUTES.adminHistory);
    expect(adminNavDestinations('content')).toEqual(expect.arrayContaining([
      APP_ROUTES.adminOverview,
      APP_ROUTES.adminCommunications,
      APP_ROUTES.adminDisplay,
      APP_ROUTES.adminStops,
    ]));
    expect(adminNavDestinations('content')).not.toContain(APP_ROUTES.adminNotifications);
  });
});