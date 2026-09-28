import { describe, it, expect } from 'vitest';
import { demandLevel } from './demandLevel.js';

// Owner decision on #445: Low <25, Moderate 25-50, High 50-75, Very high 75+.
describe('demandLevel', () => {
  it('uses the #445 names and boundaries', () => {
    expect(demandLevel(21.6).label).toBe('Low demand');
    expect(demandLevel(25).label).toBe('Moderate demand');
    expect(demandLevel(44).label).toBe('Moderate demand');
    expect(demandLevel(50).label).toBe('High demand');
    expect(demandLevel(74.9).key).toBe('high');
    expect(demandLevel(75).key).toBe('very-high');
    expect(demandLevel(100).key).toBe('very-high');
  });

  it('is null with no reading, rather than calling it low', () => {
    expect(demandLevel(null)).toBeNull();
    expect(demandLevel(undefined)).toBeNull();
    expect(demandLevel(NaN)).toBeNull();
  });
});
