import { describe, expect, it } from 'vitest';
import { getDistanceMiles, getNextStopPhase, shouldAutomaticallyCompleteStop, shouldTriggerNextStop } from './next-stop-trigger';

describe('next-stop-trigger', () => {
  const coordA = { lat: 40.7128, lng: -74.0060 }; // NYC
  const coordB = { lat: 40.7129, lng: -74.0060 }; // Very close
  const coordFar = { lat: 42.3601, lng: -71.0589 }; // Boston
  
  it('calculates distance correctly', () => {
    const distance = getDistanceMiles(coordA, coordB);
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(0.1);
  });
  
  it('triggers when within 0.5 miles', () => {
    expect(shouldTriggerNextStop('running', coordA, coordB, null)).toBe(true);
  });
  
  it('does not trigger when far and no eta', () => {
    expect(shouldTriggerNextStop('running', coordA, coordFar, null)).toBe(false);
  });
  
  it('triggers when far but ETA is within 2 minutes', () => {
    const now = Date.now();
    const eta = new Date(now + 90 * 1000).toISOString(); // 1.5 mins
    expect(shouldTriggerNextStop('running', coordA, coordFar, eta, now)).toBe(true);
  });
  
  it('does not trigger if status is not running', () => {
    expect(shouldTriggerNextStop('idle', coordA, coordB, null)).toBe(false);
  });

  it('does not trigger from an expired ETA when the coach is still far away', () => {
    const now = Date.now();
    const expiredEta = new Date(now - 60_000).toISOString();
    expect(shouldTriggerNextStop('running', coordA, coordFar, expiredEta, now)).toBe(false);
  });
  
  it('getNextStopPhase returns arriving when within 0.1 miles', () => {
    expect(getNextStopPhase(coordA, coordB, null)).toBe('arriving');
  });
  
  it('getNextStopPhase returns arriving when ETA is within 30 seconds', () => {
    const now = Date.now();
    const eta = new Date(now + 20 * 1000).toISOString();
    expect(getNextStopPhase(coordA, coordFar, eta, now)).toBe('arriving');
  });
  
  it('getNextStopPhase returns approaching when between 0.1 and 0.5 miles with >30s ETA', () => {
    // 0.3 miles away
    const coordMid = { lat: 40.7128 + 0.004, lng: -74.0060 };
    const now = Date.now();
    const eta = new Date(now + 60 * 1000).toISOString(); // 1 min
    expect(getNextStopPhase(coordA, coordMid, eta, now)).toBe('approaching');
  });

  it('automatically completes a stop only when the running coach is nearby and moving slowly', () => {
    expect(shouldAutomaticallyCompleteStop('running', coordA, coordB, 4)).toBe(true);
    expect(shouldAutomaticallyCompleteStop('running', coordA, coordB, 18)).toBe(false);
    expect(shouldAutomaticallyCompleteStop('running', coordA, coordFar, 4)).toBe(false);
    expect(shouldAutomaticallyCompleteStop('stopped', coordA, coordB, 0)).toBe(false);
  });

  it('does not complete a stop while the coach is still roughly a block away', () => {
    const aboutOneBlockAway = { lat: 40.7140, lng: -74.0060 };
    expect(getDistanceMiles(coordA, aboutOneBlockAway)).toBeGreaterThan(0.05);
    expect(shouldAutomaticallyCompleteStop('running', coordA, aboutOneBlockAway, 4)).toBe(false);
  });
});
