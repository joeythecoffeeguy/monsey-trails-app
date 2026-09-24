import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OfficialSchedule } from '@/providers/official-schedules';
import { recordScheduleObservation, ScheduleSourceHealth } from './schedule-source-health';
import { OfficialSchedulePlanner } from './official-schedule-planner';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function fixture(date = '2026-09-20', verification: 'verified' | 'unverified' | 'unavailable' = 'unverified', fetchedAt = '2026-09-20T10:00:00Z'): OfficialSchedule {
  return {
    source: 'monseytrails.com', date, fetchedAt,
    origin: { id: 2, name: 'Monsey' }, destination: { id: 5, name: 'Manhattan' },
    keyLegend: [],
    runs: [{
      id: 'unchanged-run', routeCode: 'A', routeSymbol: '', secondarySymbol: '', direction: '',
      firstPickupTime: '08:00', scheduledTime: '08:00',
      arrivalTime: verification === 'verified' ? `${date}T09:00:00-04:00` : '2026-09-18T09:00:00-04:00',
      arrivalVerification: verification, durationMinutes: 60,
      pickupDescription: '', dropoffDescription: '', departureStatus: 'unavailable', delayMinutes: null, displayKeys: [],
    }],
  };
}

describe('operator source health', () => {
  it('retains findings after a failed load and updates them when an actual planner reload succeeds', async () => {
    const response = (schedule: OfficialSchedule) => new Response(JSON.stringify(schedule), { status: 200, headers: { 'Content-Type': 'application/json' } });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response(fixture()))
      .mockRejectedValueOnce(new Error('Official source unavailable'))
      .mockResolvedValueOnce(response(fixture(undefined, 'verified', '2026-09-20T10:02:00Z'))));
    render(<OfficialSchedulePlanner onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load Runs' }));
    expect(await screen.findByText('1 conflicting run listings across 1 service date(s).')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load Runs' }));
    expect(await screen.findByTestId('error-schedule')).toBeTruthy();
    expect(screen.getByText('1 conflicting run listings across 1 service date(s).')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load Runs' }));
    expect(await screen.findByText(/Corrected — arrivals now verified/)).toBeTruthy();
    expect(screen.getByTestId('arrival-time-unchanged-run').textContent).toBe('9:00 AM');
    expect(screen.queryByTestId('error-schedule')).toBeNull();
  });

  it('counts dates and listings, deduplicates cached snapshots, and retains exact evidence', () => {
    const raw = fixture();
    let observations = recordScheduleObservation([], 1, raw);
    observations = recordScheduleObservation(observations, 1, raw);
    expect(observations[0].consecutiveConflictingChecks).toBe(1);
    observations = recordScheduleObservation(observations, 1, fixture(undefined, 'unverified', '2026-09-20T10:01:00Z'));
    observations = recordScheduleObservation(observations, 1, fixture('2026-09-21'));
    render(<ScheduleSourceHealth observations={observations} />);
    expect(screen.getByText('2 conflicting run listings across 2 service date(s).')).toBeTruthy();
    expect(screen.getByText(/repeated across 2 source snapshots/)).toBeTruthy();
    expect(screen.getAllByText(/Raw arrival: 2026-09-18T09:00:00-04:00/)).toHaveLength(2);
    expect(screen.getByText(/not traffic-provider failures/)).toBeTruthy();
    expect(raw.runs[0].id).toBe('unchanged-run');
    expect(raw.runs[0].arrivalTime).toBe('2026-09-18T09:00:00-04:00');
  });

  it('recovers after corrected data without discarding the prior raw evidence', () => {
    let observations = recordScheduleObservation([], 1, fixture());
    observations = recordScheduleObservation(observations, 1, fixture(undefined, 'verified', '2026-09-20T10:02:00Z'));
    const { rerender } = render(<ScheduleSourceHealth observations={observations} />);
    expect(screen.getByText(/Corrected — arrivals now verified/)).toBeTruthy();
    expect(screen.getByText(/No remaining arrival-date conflicts/)).toBeTruthy();
    expect(screen.getByText(/Raw arrival: 2026-09-18/)).toBeTruthy();
    observations = recordScheduleObservation(observations, 1, fixture(undefined, 'unverified', '2026-09-20T10:03:00Z'));
    expect(observations[0].consecutiveConflictingChecks).toBe(1);
    rerender(<ScheduleSourceHealth observations={observations} />);
    expect(screen.getByText('1 conflicting run listings across 1 service date(s).')).toBeTruthy();
  });

  it('does not mistake missing or removed arrivals for verified corrections', () => {
    const initial = recordScheduleObservation([], 1, fixture());
    const missing = recordScheduleObservation(initial, 1, fixture(undefined, 'unavailable'));
    const { rerender } = render(<ScheduleSourceHealth observations={missing} />);
    expect(screen.queryByText(/Corrected —/)).toBeNull();
    rerender(<ScheduleSourceHealth observations={recordScheduleObservation(initial, 1, { ...fixture(), runs: [] })} />);
    expect(screen.getByText(/previous arrivals unavailable or runs removed/)).toBeTruthy();
  });

  it('does not flag traffic failures or missing arrival evidence as source conflicts', () => {
    const { container } = render(<ScheduleSourceHealth observations={recordScheduleObservation([], 1, fixture(undefined, 'unavailable'))} />);
    expect(container.textContent).toBe('');
  });
});