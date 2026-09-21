-- Issue #210: FLUX locked as node collateral.
--
-- Running a Flux node requires locking collateral, fixed per tier by the protocol:
--   Cumulus  1,000 FLUX
--   Nimbus  12,500 FLUX
--   Stratus 40,000 FLUX
--
-- Network-wide locked supply is therefore the tier counts multiplied by their rates.
-- Measured 2026-09-21: 2,907 cumulus + 1,578 nimbus + 1,692 stratus = ~90.3M FLUX locked.
--
-- FOUR columns, not one. The total is what the Historical graph headlines, but the
-- per-tier values are stored alongside it so that if Flux ever changes a collateral rate,
-- history keeps the rate that was in force on each day rather than being silently
-- restated at the new one. That is the ONLY reason to store any of this rather than
-- multiply node_cumulus/nimbus/stratus at read time -- and it is a real one for a figure
-- about locked supply.
--
-- The total is always written as the sum of the three parts computed in one expression
-- (calculateLockedCollateral in config.js), never independently, so the headline figure
-- and the breakdown that explains it cannot disagree.
--
-- No DEFAULT, deliberately, for the same reason as unique_wallets in migration 014: a
-- fabricated 0 would read as "no collateral was locked that day" -- false, and
-- indistinguishable from a collection failure. Node collection is all-or-nothing, so a
-- partial reading leaves all four NULL rather than understating locked supply by a whole
-- tier (at 40,000 FLUX a missing stratus count is most of the total).
--
-- Unlike unique_wallets, a backfill of this is EXACT rather than best-effort: every
-- snapshot back to day one already stores the tier counts, and the rates have never
-- changed. POST /api/admin/backfill-collateral fills all of history from them.
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS locked_collateral_cumulus DOUBLE PRECISION;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS locked_collateral_nimbus  DOUBLE PRECISION;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS locked_collateral_stratus DOUBLE PRECISION;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS locked_collateral         DOUBLE PRECISION;

ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS locked_collateral_cumulus DOUBLE PRECISION;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS locked_collateral_nimbus  DOUBLE PRECISION;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS locked_collateral_stratus DOUBLE PRECISION;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS locked_collateral         DOUBLE PRECISION;
