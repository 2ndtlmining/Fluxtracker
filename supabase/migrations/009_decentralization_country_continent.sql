-- Issue #138: country/continent breakdown for the decentralization metric, mirroring the
-- existing per-org decentralization_snapshots table (008). Both providers already used by
-- decentralizationService.js's classification chain (ipwho.is, ip-api.com) return country
-- and continent in their normal free response -- this was simply never captured before.

-- New columns on the existing per-IP classification cache. Safe against existing rows
-- (NULL until re-classified, same self-healing pattern as every other schema addition in
-- this project -- see CLAUDE.md's Database section).
ALTER TABLE node_ip_classification ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE node_ip_classification ADD COLUMN IF NOT EXISTS country_code TEXT;
ALTER TABLE node_ip_classification ADD COLUMN IF NOT EXISTS continent TEXT;
ALTER TABLE node_ip_classification ADD COLUMN IF NOT EXISTS continent_code TEXT;

-- Per-country decentralization breakdown, one row per (date, country).
CREATE TABLE IF NOT EXISTS decentralization_country_snapshots (
    id BIGSERIAL PRIMARY KEY,
    snapshot_date TEXT NOT NULL,
    country TEXT NOT NULL,
    country_code TEXT,
    node_count INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    UNIQUE(snapshot_date, country)
);

CREATE INDEX IF NOT EXISTS idx_decentralization_country_snapshot_date ON decentralization_country_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_decentralization_country ON decentralization_country_snapshots(country);

ALTER TABLE decentralization_country_snapshots ENABLE ROW LEVEL SECURITY;

-- Per-continent decentralization breakdown, one row per (date, continent).
CREATE TABLE IF NOT EXISTS decentralization_continent_snapshots (
    id BIGSERIAL PRIMARY KEY,
    snapshot_date TEXT NOT NULL,
    continent TEXT NOT NULL,
    continent_code TEXT,
    node_count INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    UNIQUE(snapshot_date, continent)
);

CREATE INDEX IF NOT EXISTS idx_decentralization_continent_snapshot_date ON decentralization_continent_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_decentralization_continent ON decentralization_continent_snapshots(continent);

ALTER TABLE decentralization_continent_snapshots ENABLE ROW LEVEL SECURITY;
