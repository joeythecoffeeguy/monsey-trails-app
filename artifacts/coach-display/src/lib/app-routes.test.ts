import { describe, expect, it } from 'vitest';
import { getClientPath, needsDriverAuth } from './app-routes';

describe('separate driver and passenger addresses', () => {
  it.each(['/', '/passengers', '/passengers/', '/bus-display', '/bus-display/', '/mounted', '/coach-display/mounted'])(
    'never requires driver authentication for %s', (path) => {
      expect(needsDriverAuth(path)).toBe(false);
    },
  );
  it.each(['/drivers', '/operator', '/sign-in', '/sign-in/sso-callback', '/sign-up', '/admin', '/admin/drivers', '/admin/overview', '/admin/communications'])(
    'retains staff authentication for %s', (path) => {
      expect(needsDriverAuth(path)).toBe(true);
    },
  );
  it.each(['/bus-display', '/mounted', '/coach-display/bus-display'])(
    'uses public display pairing for %s', (path) => {
      expect(getClientPath(path)).toBe('mounted');
    },
  );
  it.each(['/drivers', '/operator', '/coach-display/drivers'])(
    'uses private operator polling for %s', (path) => {
      expect(getClientPath(path)).toBe('operator');
    },
  );
  it('uses exact-run passenger polling at the schedules address', () => {
    expect(getClientPath('/passengers')).toBe('personal');
  });
});