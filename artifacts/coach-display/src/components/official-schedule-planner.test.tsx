import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfficialSchedulePlanner } from './official-schedule-planner';

const originalFetch = global.fetch;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  global.fetch = originalFetch;
});

describe('OfficialSchedulePlanner published arrivals', () => {
  it('only formats verified arrival evidence and explains other states', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      source: 'official',
      fetchedAt: '2024-11-20T00:00:00Z',
      date: '2024-11-20',
      origin: { id: 2, name: 'Monsey' },
      destination: { id: 5, name: 'Manhattan' },
      keyLegend: [
        { key: 'B', meaning: 'Goes to Boro Park.' },
        { key: 'R', meaning: 'Picks up and drops off at B&H Photo.' },
      ],
      runs: [
        {
          id: 'verified',
          routeCode: '1',
          routeSymbol: '1',
          secondarySymbol: '',
          direction: 'outbound',
          firstPickupTime: '07:30',
          scheduledTime: '08:00',
          arrivalTime: '09:00',
          arrivalVerification: 'verified',
          durationMinutes: 60,
          pickupDescription: 'Monsey',
          dropoffDescription: 'Manhattan',
          departureStatus: 'on_time',
          delayMinutes: null,
           displayKeys: ['B', 'R'],
        },
        {
          id: 'mismatch',
          routeCode: '2',
          routeSymbol: '2',
          secondarySymbol: '',
          direction: 'outbound',
          firstPickupTime: '08:30',
          scheduledTime: '09:00',
          arrivalTime: '10:00',
          arrivalVerification: 'unverified',
          durationMinutes: 60,
          pickupDescription: 'Monsey',
          dropoffDescription: 'Manhattan',
          departureStatus: 'on_time',
          delayMinutes: null,
        },
        {
          id: 'unavailable',
          routeCode: '3',
          routeSymbol: '3',
          secondarySymbol: '',
          direction: 'outbound',
          firstPickupTime: '09:30',
          scheduledTime: '10:00',
          arrivalTime: null,
          arrivalVerification: 'unavailable',
          durationMinutes: 60,
          pickupDescription: 'Monsey',
          dropoffDescription: 'Manhattan',
          departureStatus: 'on_time',
          delayMinutes: null,
        },
        {
          id: 'legacy',
          routeCode: '4',
          routeSymbol: '4',
          secondarySymbol: '',
          direction: 'outbound',
          firstPickupTime: '10:30',
          scheduledTime: '11:00',
          arrivalTime: '12:00',
          durationMinutes: 60,
          pickupDescription: 'Monsey',
          dropoffDescription: 'Manhattan',
          departureStatus: 'on_time',
          delayMinutes: null,
        },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    render(<OfficialSchedulePlanner onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Load Runs' }));

    expect((await screen.findByTestId('arrival-time-verified')).textContent).toBe('9:00 AM');
    expect(screen.getByLabelText('Schedule keys B, R')).toBeTruthy();
    expect(screen.getByText('Picks up and drops off at B&H Photo.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Download schedule PDF' }).getAttribute('href')).toBe(
      '/api/public/schedules/Monsey-Trails-New-York-Line-Tishrei-2026.pdf',
    );
    expect(screen.getByTestId('arrival-warning-mismatch').textContent).toBe('Arrival date mismatch');
    expect(screen.getByTestId('arrival-warning-unavailable').textContent).toBe('Published arrival unavailable');
    expect(screen.getByTestId('arrival-warning-legacy').textContent).toBe('Published arrival unverified');
    expect(screen.queryByTestId('arrival-time-mismatch')).toBeNull();
    expect(screen.queryByTestId('arrival-time-legacy')).toBeNull();
  });
});