import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StopNote, visibleStopNote } from './StopNote';

afterEach(cleanup);

describe('StopNote', () => {
  it('does not render an absent or duplicate note', () => {
    const { rerender } = render(<StopNote label="Viola Road & Route 306" />);
    expect(document.querySelector('p')).toBeNull();

    rerender(<StopNote label="Viola Road & Route 306" note="  viola road & route 306  " />);
    expect(document.querySelector('p')).toBeNull();
  });

  it('renders a long note as bounded wrapping secondary text', () => {
    const note = 'Across from the landmark, beside the passenger entrance with the covered waiting area';
    render(
      <StopNote
        label="Viola Road & Route 306"
        note={note}
        className="line-clamp-3 text-sm"
      />,
    );

    const rendered = screen.getByText(note);
    expect(rendered.className).toContain('break-words');
    expect(rendered.className).toContain('line-clamp-3');
    expect(visibleStopNote(note, 'Viola Road & Route 306')).toBe(note);
  });
});