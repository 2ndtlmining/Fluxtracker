import { describe, it, expect } from 'vitest';
import { computeUtilizationPercent, formatUtilizationBar } from './resourceBar.js';

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
});

describe('formatUtilizationBar', () => {
  it('fills the bar proportionally to the percentage, default width 10', () => {
    const { bar, percent } = formatUtilizationBar(4, 8);
    expect(percent).toBe(50);
    expect(bar).toBe('█████░░░░░');
    expect(bar.length).toBe(10);
  });

  it('rounds the percentage to a whole number', () => {
    const { percent } = formatUtilizationBar(1, 3);
    expect(percent).toBe(33);
  });

  it('respects a custom width', () => {
    const { bar } = formatUtilizationBar(3, 4, 4);
    expect(bar.length).toBe(4);
    expect(bar).toBe('███░');
  });

  it('is fully empty at 0% and fully filled at 100%', () => {
    expect(formatUtilizationBar(0, 8).bar).toBe('░░░░░░░░░░');
    expect(formatUtilizationBar(8, 8).bar).toBe('██████████');
  });

  it('never divides by zero for a missing total', () => {
    const { bar, percent } = formatUtilizationBar(5, 0);
    expect(percent).toBe(0);
    expect(bar).toBe('░░░░░░░░░░');
  });
});
