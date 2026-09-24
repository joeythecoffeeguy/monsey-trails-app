import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PassengerPreferenceButton } from './PassengerWebControls';

describe('PassengerPreferenceButton', () => {
  beforeEach(() => localStorage.clear());

  it('portals its modal outside clipped trip and reminder stacking contexts', () => {
    const { container } = render(
      <div className="relative z-20 overflow-hidden" data-testid="selected-trip-shell">
        <div className="absolute inset-0 z-50" data-testid="departure-reminder-layer" />
        <PassengerPreferenceButton />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Accessibility & language' }));

    const dialog = screen.getByRole('dialog', { name: 'Accessibility & language' });
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);

    const largeText = screen.getByRole('checkbox', { name: 'Large text' });
    fireEvent.click(largeText);
    expect((largeText as HTMLInputElement).checked).toBe(true);
  });
});