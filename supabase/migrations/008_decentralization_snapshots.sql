-- Per-provider decentralization breakdown, one row per (date, org) -- issue #108 Phase 3.
-- The 3 headline daily_snapshots columns are added by schemaMigrator.js at boot (both
-- backends, self-healing), not by a migration file -- this migration is only the new table.

CREATE TABLE IF NOT EXISTS decentralization_snapshots (
    id BIGSERIAL PRIMARY KEY,
    snapshot_date TEXT NOT NULL,
    org TEXT NOT NULL,
    node_count INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    UNIQUE(snapshot_date, org)
);

CREATE INDEX IF NOT EXISTS idx_decentralization_snapshot_date ON decentralization_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_decentralization_org ON decentralization_snapshots(org);

ALTER TABLE decentralization_snapshots ENABLE ROW LEVEL SECURITY;
