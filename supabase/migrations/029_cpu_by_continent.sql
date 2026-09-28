-- CPU supply and demand by continent (issue #463).
--
-- Geolocation demand used to compare region-locked app COUNTS with node COUNTS, so a small
-- app on a big node weighed the same as a heavy one. Now, per continent: the CPU cores its
-- nodes benchmark (supply) and the cores apps have locked on them (demand), from each node's
-- own report in the node list -- every app counts, encrypted or not. "% in use" is derived
-- (locked / cores), so weekly and monthly views divide sums rather than average percentages.
--
-- No DEFAULT: a day predating this has no reading, and a 0 would read as "no capacity".
-- schemaMigrator also creates these at startup; this file is the record.
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS cpu_cores_eu DOUBLE PRECISION;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS cpu_locked_eu DOUBLE PRECISION;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS cpu_cores_na DOUBLE PRECISION;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS cpu_locked_na DOUBLE PRECISION;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS cpu_cores_as DOUBLE PRECISION;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS cpu_locked_as DOUBLE PRECISION;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS cpu_cores_oc DOUBLE PRECISION;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS cpu_locked_oc DOUBLE PRECISION;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS cpu_cores_sa DOUBLE PRECISION;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS cpu_locked_sa DOUBLE PRECISION;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS cpu_cores_af DOUBLE PRECISION;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS cpu_locked_af DOUBLE PRECISION;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS cpu_cores_eu DOUBLE PRECISION;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS cpu_locked_eu DOUBLE PRECISION;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS cpu_cores_na DOUBLE PRECISION;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS cpu_locked_na DOUBLE PRECISION;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS cpu_cores_as DOUBLE PRECISION;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS cpu_locked_as DOUBLE PRECISION;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS cpu_cores_oc DOUBLE PRECISION;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS cpu_locked_oc DOUBLE PRECISION;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS cpu_cores_sa DOUBLE PRECISION;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS cpu_locked_sa DOUBLE PRECISION;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS cpu_cores_af DOUBLE PRECISION;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS cpu_locked_af DOUBLE PRECISION;
