-- Tunnelled nodes (issue #532).
--
-- FluxOS 8.21 reports flux.uplink.tunnel (likely / none / unknown) on each node, read from
-- stats.runonflux.io/fluxinfo. The percent is likely / nodes reporting the field; nodes on an
-- older FluxOS are left out of the denominator. Computed hourly into current_metrics; the
-- daily snapshot copies it. Forward-only: the verdict is live, there is nothing to backfill.
--
-- No DEFAULT: a day predating this has no reading, and a 0 would read as "no node was
-- tunnelled".
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS node_tunnel_likely INTEGER;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS node_tunnel_none INTEGER;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS node_tunnel_unknown INTEGER;
ALTER TABLE daily_snapshots ADD COLUMN IF NOT EXISTS node_tunnel_percent DOUBLE PRECISION;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS node_tunnel_likely INTEGER;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS node_tunnel_none INTEGER;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS node_tunnel_unknown INTEGER;
ALTER TABLE current_metrics ADD COLUMN IF NOT EXISTS node_tunnel_percent DOUBLE PRECISION;
