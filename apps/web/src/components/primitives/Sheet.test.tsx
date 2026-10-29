import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Leaving, Sheet } from './Sheet';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Amount() {
  const [text, setText] = useState('36');
  return (
    <Sheet open title="Plan" onClose={() => {}} fullScreen>
      <input
        aria-label="Amount"
        data-sheet-focus
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </Sheet>
  );
}

describe('Sheet focus on open', () => {
  it('holds the keyboard on an on-screen stand-in until the sheet lands', () => {
    vi.useFakeTimers();
    render(<Amount />);
    const field = screen.getByLabelText('Amount');
    const stand = document.activeElement as HTMLInputElement;
    expect(stand).not.toBe(field);
    expect(stand.inputMode).toBe('decimal');

    fireEvent.animationEnd(screen.getByRole('dialog'));
    expect(document.activeElement).toBe(field);
    expect(stand.disabled).toBe(true);
  });

  it('carries over what was typed before it landed', () => {
    vi.useFakeTimers();
    render(<Amount />);
    (document.activeElement as HTMLInputElement).value = '50';
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const field = screen.getByLabelText('Amount');
    expect(document.activeElement).toBe(field);
    expect(field).toHaveProperty('value', '50');
  });
});

describe('Leaving', () => {
  function Host({ show }: { show: boolean }) {
    return (
      <Leaving>
        {show && (
          <Sheet open title="Edit" onClose={() => {}}>
            body
          </Sheet>
        )}
      </Leaving>
    );
  }
  it('keeps a dropped sheet on screen while it slides out, then removes it', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Host show />);
    rerender(<Host show={false} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('animate-sheet-out');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
