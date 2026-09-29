-- Private (enterprise) apps (issue #424, owner decision 2026-09-27).
--
-- Of the apps with an unexpired registration, how many are private (enterprise, encrypted
-- specs) and their share. Computed hourly in the same pass as unique_app_owners, over the
-- same specs; the daily snapshot copies it. Forward-only: no backfill.
--
-- No DEFAULT: a day predating this has no reading, and a 0 would read as "no private apps".
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS enterprise_apps INTEGER;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS enterprise_apps_percent DOUBLE PRECISION;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS enterprise_apps INTEGER;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS enterprise_apps_percent DOUBLE PRECISION;
