-- Expired running apps (spec 2026-10-06).
--
-- Apps still running on Flux nodes at least a day (2,880 blocks) after their subscription
-- ended: how many, and on how many nodes. Computed every services cycle into
-- current_metrics; the daily snapshot copies it. Forward-only: the running census is live,
-- there is nothing to backfill from.
--
-- No DEFAULT: a day predating this has no reading, and a 0 would read as "no expired apps
-- were running".
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS expired_running_apps INTEGER;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS expired_running_instances INTEGER;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS expired_running_apps INTEGER;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS expired_running_instances INTEGER;
