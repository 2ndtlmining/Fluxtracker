import { describe, it, expect } from 'vitest';
import { computeUtilizationPercent, formatAsciiBar } from './resourceBar.js';

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

describe('formatAsciiBar', () => {
  it('renders 0% as all-empty', () => {
    expect(formatAsciiBar(0, 10)).toBe('[----------]');
  });

  it('renders 100% as all-filled', () => {
    expect(formatAsciiBar(100, 10)).toBe('[==========]');
  });

  it('renders 50% as half-filled', () => {
    expect(formatAsciiBar(50, 10)).toBe('[=====-----]');
  });

  it('rounds to the nearest cell rather than truncating', () => {
    // 3/10 of 16 = 4.8 -> rounds to 5
    expect(formatAsciiBar(30, 16)).toBe('[=====-----------]');
  });

  it('clamps out-of-range percentages instead of over/under-filling', () => {
    expect(formatAsciiBar(150, 10)).toBe('[==========]');
    expect(formatAsciiBar(-20, 10)).toBe('[----------]');
  });

  it('treats a missing percent as 0 rather than throwing', () => {
    expect(formatAsciiBar(null, 10)).toBe('[----------]');
    expect(formatAsciiBar(undefined, 10)).toBe('[----------]');
  });

  it('defaults to a width of 16', () => {
    expect(formatAsciiBar(50).length).toBe(18); // 16 cells + 2 brackets
  });
});
