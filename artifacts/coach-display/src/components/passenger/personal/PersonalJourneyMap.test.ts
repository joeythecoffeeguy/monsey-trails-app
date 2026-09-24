import { describe, expect, it } from 'vitest';
import { journeyViewportKey } from './PersonalJourneyMap';

const stops = [{
  id: 'stop-1',
  label: 'Main Street',
  mapLabel: 'Main',
  lat: 41.1111111,
  lng: -74.0666666,
  kind: 'pickup' as const,
  scheduledAt: null,
  estimatedArrivalAt: null,
}];

describe('journeyViewportKey', () => {
  it('treats equivalent polled route coordinates as the same viewport', () => {
    const first = journeyViewportKey([{ lat: 41.1, lng: -74.06 }], stops, null);
    const equivalentPoll = journeyViewportKey(
      [{ lat: 41.10000001, lng: -74.06000001 }],
      [{ ...stops[0], lat: 41.11111109, lng: -74.06666659 }],
      null,
    );

    expect(equivalentPoll).toBe(first);
  });

  it('changes only when the selected viewport target materially changes', () => {
    const selected = journeyViewportKey([], stops, 'stop-1');
    const sameSelectedPoll = journeyViewportKey([], [{ ...stops[0] }], 'stop-1');
    const movedSelectedPoll = journeyViewportKey(
      [],
      [{ ...stops[0], lat: stops[0].lat + 0.001 }],
      'stop-1',
    );

    expect(sameSelectedPoll).toBe(selected);
    expect(movedSelectedPoll).not.toBe(selected);
  });
});