import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pollWhileVisible } from './pollWhileVisible.js';

/** Minimal stand-in for `document`'s visibility API. */
function fakeDoc() {
  const listeners = new Set();
  return {
    hidden: false,
    addEventListener: (_type, fn) => listeners.add(fn),
    removeEventListener: (_type, fn) => listeners.delete(fn),
    setHidden(value) {
      this.hidden = value;
      for (const fn of listeners) fn();
    },
    get listenerCount() {
      return listeners.size;
    }
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pollWhileVisible (issue #298)', () => {
  it('polls on the interval while visible', () => {
    const doc = fakeDoc();
    const fn = vi.fn();
    pollWhileVisible(fn, 1000, { doc });
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('makes no calls while the tab is hidden', () => {
    const doc = fakeDoc();
    const fn = vi.fn();
    pollWhileVisible(fn, 1000, { doc });
    doc.setHidden(true);
    vi.advanceTimersByTime(60_000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('refreshes once, immediately, when the tab comes back after missing ticks', () => {
    const doc = fakeDoc();
    const fn = vi.fn();
    pollWhileVisible(fn, 1000, { doc });
    doc.setHidden(true);
    vi.advanceTimersByTime(5000);
    doc.setHidden(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not refresh on becoming visible if nothing was missed', () => {
    const doc = fakeDoc();
    const fn = vi.fn();
    pollWhileVisible(fn, 10_000, { doc });
    doc.setHidden(true);
    doc.setHidden(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('stop() clears the timer and the listener', () => {
    const doc = fakeDoc();
    const fn = vi.fn();
    const stop = pollWhileVisible(fn, 1000, { doc });
    stop();
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
    expect(doc.listenerCount).toBe(0);
  });
});
