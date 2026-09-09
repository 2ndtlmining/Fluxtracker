import { describe, it, expect } from 'vitest';
import { computeUtilizationPercent } from './resourceBar.js';

describe('computeUtilizationPercent', () => {
  it('computes a plain percentage', () => {
    expect(computeUtilizationPercent(2, 8)).toBe(25);
  });

  it('clamps to 100 when used exceeds total (locked can briefly exceed benchmark)', () => {
    expect(computeUtilizationPercent(9, 8)).toBe(100);
  });

  it('returns 0 for a zero or missing total rather than dividing by zero', () => {
    expect(computeUtilizationPercent(5, 0)).toBe(0);
    expect(computeUtilizationPercent(5, undefined)).toBe(0);
    expect(computeUtilizationPercent(5, null)).toBe(0);
  });

  it('returns 0 for a negative used value', () => {
    expect(computeUtilizationPercent(-1, 8)).toBe(0);
  });

  it('is not rounded -- callers round as needed for display', () => {
    expect(computeUtilizationPercent(1, 3)).toBeCloseTo(33.333, 2);
  });
});
