-- Median time left on running apps (owner request, 2026-09-25/26).
--
-- For every running app, the days until its paid term ends (registration/update height +
-- expire blocks, 2,880 blocks a day); the median across all of them. Computed hourly from
-- the app registry alongside unique_app_owners and kept in current_metrics; the daily
-- snapshot copies it, so the history starts the day this ships -- no estimated backfill.
--
-- DOUBLE PRECISION (one decimal, e.g. 15.5 days) and no DEFAULT, for the same reason as
-- unique_app_owners in migration 015: a row written before this shipped has no reading, and
-- a fabricated 0 would read as "every app is about to expire".
--
-- Both tables in one migration on purpose: the snapshot writer only includes this column
-- once current_metrics has a value for it, which can only happen after this runs.
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS median_days_left DOUBLE PRECISION;
ALTER TABLE current_metrics  ADD COLUMN IF NOT EXISTS median_days_left DOUBLE PRECISION;
