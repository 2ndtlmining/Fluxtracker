-- Deployment fill history (issue #421).
--
-- Of the deployments ordered by UNEXPIRED app specs, how many are running -- the Apps card's
-- figure, which the Missing Deployments carousel and the chart now share (owner decision
-- 2026-09-27: an expired app will never be filled, so it is not "ordered"). Computed every
-- services cycle into current_metrics; the daily snapshot copies it, so history starts the
-- day this ships -- the running census is live-only, there is nothing to backfill from.
--
-- The two counts are stored with the percentage so weekly and monthly views divide sums
-- instead of averaging percentages. No DEFAULT: a row predating this has no reading, and a
-- fabricated 0% would read as "nothing ordered was running".
--
-- Both tables in one migration: the snapshot writer names these columns only once
-- current_metrics holds a value, which can only happen after this runs.
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS deployments_ordered INTEGER;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS deployments_running INTEGER;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS deployment_fill_percent DOUBLE PRECISION;
ALTER TABLE current_metrics  ADD COLUMN IF NOT EXISTS deployments_ordered INTEGER;
ALTER TABLE current_metrics  ADD COLUMN IF NOT EXISTS deployments_running INTEGER;
ALTER TABLE current_metrics  ADD COLUMN IF NOT EXISTS deployment_fill_percent DOUBLE PRECISION;
