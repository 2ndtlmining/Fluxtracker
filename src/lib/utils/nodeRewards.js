// Block rewards per node per day, by tier (issue #422). Pure.
//
// A tier's total payout for a day is its per-block payout times the blocks that day; split
// across that tier's nodes it is what one node earns on average. Block rewards only -- not
// app income, and nothing about hardware cost or price moves. Owner decision 2026-09-27:
// FLUX and $ per node per day only, no yearly return or APY.

import { NODE_REWARD_SCHEDULE } from '../config.js';

/** The schedule era a YYYY-MM-DD date falls in. */
export function rewardEra(date) {
  let era = null;
  for (const entry of NODE_REWARD_SCHEDULE) if (String(date) >= entry.fromDate) era = entry;
  return era;
}

/**
 * FLUX one node of `tier` earns in block rewards per day, on `date`, with `nodeCount` nodes of
 * that tier. null when there is no count to divide by -- never a 0 that would read as "earns
 * nothing".
 */
export function rewardPerNodePerDay(date, tier, nodeCount) {
  const era = rewardEra(date);
  const perBlock = era?.perBlock?.[tier];
  if (!perBlock || !(Number(nodeCount) > 0)) return null;
  return (perBlock * era.blocksPerDay) / Number(nodeCount);
}
