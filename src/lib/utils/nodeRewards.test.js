import { describe, it, expect } from 'vitest';
import { rewardEra, rewardPerNodePerDay } from './nodeRewards.js';

// Issue #422: block rewards per node per day. Figures from the chain on 2026-09-29.
describe('rewardPerNodePerDay', () => {
  it('matches the on-chain arithmetic today (within 1%)', () => {
    // 1 / 3.5 / 9 FLUX a block, 2,876 blocks a day, today's tier counts
    expect(rewardPerNodePerDay('2026-09-28', 'cumulus', 3308)).toBeCloseTo(0.869, 2);
    expect(rewardPerNodePerDay('2026-09-28', 'nimbus', 1557)).toBeCloseTo(6.465, 2);
    expect(rewardPerNodePerDay('2026-09-28', 'stratus', 1702)).toBeCloseTo(15.208, 2);
  });

  it('uses the payouts and block rate of the era a day falls in', () => {
    expect(rewardEra('2025-10-24').perBlock.cumulus).toBe(2.8125);
    expect(rewardEra('2025-10-25').perBlock.cumulus).toBe(1);
    // Before block 2,020,000: 11.25 FLUX a block at ~713 blocks a day
    expect(rewardPerNodePerDay('2025-06-01', 'stratus', 1000)).toBeCloseTo(8.021, 2);
  });

  it('is null, never 0, without a node count', () => {
    expect(rewardPerNodePerDay('2026-09-28', 'cumulus', 0)).toBeNull();
    expect(rewardPerNodePerDay('2026-09-28', 'cumulus', null)).toBeNull();
    expect(rewardPerNodePerDay('2026-09-28', 'unknown-tier', 10)).toBeNull();
  });
});
