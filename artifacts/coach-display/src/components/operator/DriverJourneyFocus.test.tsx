import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DriverJourneyFocus } from './DriverJourneyFocus';

describe('DriverJourneyFocus', () => {
  it('shows only a supplied verified instruction and delegates optional speech', () => {
    const onSpeak = vi.fn();
    render(
      <DriverJourneyFocus
        stopName="18th Avenue & 49th Street"
        stopKind="pickup"
        verifiedInstruction="Board at the marked public stop."
        eta="2026-09-23T15:20:00.000Z"
        motionState="moving"
        stoppedControlsConfirmed={false}
        onSpeakInstruction={onSpeak}
      />,
    );

    expect(screen.getByText('Board at the marked public stop.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Speak stop instruction' }));
    expect(onSpeak).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Published pickup time/)).toBeNull();
  });

  it('does not infer safe stopped from unknown motion', () => {
    const onConfirm = vi.fn();
    render(
      <DriverJourneyFocus
        stopName="34th Street & 9th Avenue"
        stopKind="dropoff"
        motionState="unknown"
        stoppedControlsConfirmed={false}
        onConfirmStoppedControls={onConfirm}
      />,
    );

    expect(screen.getByText(/Motion status is unavailable/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /I am safely stopped/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('shows an authoritative time only when explicitly supplied for a pickup', () => {
    render(
      <DriverJourneyFocus
        stopName="New Square"
        stopKind="pickup"
        authoritativePickupTime="2026-09-23T12:15:00.000Z"
        motionState="moving"
        stoppedControlsConfirmed={false}
      />,
    );

    expect(screen.getByText(/Published pickup time/)).toBeDefined();
  });
});