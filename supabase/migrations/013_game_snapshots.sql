-- Issue #163: per-game daily instance counts, backing the Gaming section's comparison arrows.
--
-- repo_snapshots cannot serve this. It is keyed by Docker image, and the games that most need
-- tracking have enterprise-encrypted specs with no image at all -- FiveM and the bulk of
-- Valheim never appear there. This is keyed by canonical game name instead, which is what
-- both identification paths (image and app name) resolve to.
CREATE TABLE IF NOT EXISTS game_snapshots (
    id BIGSERIAL PRIMARY KEY,
    snapshot_date DATE NOT NULL,
    game_name TEXT NOT NULL,
    instance_count INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    UNIQUE(snapshot_date, game_name)
);

CREATE INDEX IF NOT EXISTS idx_game_snapshot_date ON game_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_game_snapshot_name ON game_snapshots(game_name, snapshot_date);
