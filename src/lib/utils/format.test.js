import { describe, it, expect } from 'vitest';
import { formatNumber, formatCompact, formatFlux, formatUsd, formatCount } from './format.js';

describe('formatNumber', () => {
  it('groups with commas and fixes the decimals', () => {
    expect(formatNumber(1234567.891, 2)).toBe('1,234,567.89');
    expect(formatNumber(1234.5)).toBe('1,235');
    expect(formatNumber(0.5, 2)).toBe('0.50');
  });

  it('formats missing and non-finite input as zero', () => {
    expect(formatNumber(null, 2)).toBe('0.00');
    expect(formatNumber(undefined)).toBe('0');
    expect(formatNumber(NaN)).toBe('0');
    expect(formatNumber('12')).toBe('12');
  });

  it('never prints a negative zero', () => {
    expect(formatNumber(-0.001, 2)).toBe('0.00');
    expect(formatNumber(-0)).toBe('0');
  });
});

describe('formatCompact', () => {
  it('stays exact below 10k and compacts with upper-case suffixes above', () => {
    expect(formatCompact(9999.994)).toBe('9,999.99');
    expect(formatCompact(12345)).toBe('12.35K');
    expect(formatCompact(1234567)).toBe('1.23M');
    expect(formatCompact(-12345)).toBe('-12.35K');
  });

  it('trims trailing zeros only when asked', () => {
    expect(formatCompact(12000, 2)).toBe('12.00K');
    expect(formatCompact(12000, 2, { trim: true })).toBe('12K');
    expect(formatCompact(1500000, 2, { trim: true })).toBe('1.5M');
    expect(formatCompact(100, 0, { trim: true })).toBe('100');
  });
});

describe('formatFlux / formatUsd use the same thresholds and decimals', () => {
  it('keeps two decimals between 1k and 10k for both units', () => {
    expect(formatFlux(1234.567)).toBe('1,234.57');
    expect(formatUsd(1234.567)).toBe('$1,234.57');
  });

  it('switches both to K above 10k', () => {
    expect(formatFlux(12345.6)).toBe('12.35K');
    expect(formatUsd(12345.6)).toBe('$12.35K');
  });

  it('can print the full figure (tooltips)', () => {
    expect(formatFlux(12345.6, { compact: false })).toBe('12,345.60');
    expect(formatUsd(12345.6, { compact: false })).toBe('$12,345.60');
  });

  it('puts the sign before the dollar', () => {
    expect(formatUsd(-5)).toBe('-$5.00');
    expect(formatUsd(-0.001)).toBe('$0.00');
    expect(formatUsd(null)).toBe('$0.00');
  });
});

describe('formatCount', () => {
  it('rounds to a whole number with commas', () => {
    expect(formatCount(1234.6)).toBe('1,235');
    expect(formatCount(0)).toBe('0');
    expect(formatCount(null)).toBe('0');
  });

  it('compacts with one trimmed decimal', () => {
    expect(formatCount(9999, { compact: true })).toBe('9,999');
    expect(formatCount(12345, { compact: true })).toBe('12.3K');
    expect(formatCount(12000, { compact: true })).toBe('12K');
    expect(formatCount(1234567, { compact: true })).toBe('1.23M');
  });
});
