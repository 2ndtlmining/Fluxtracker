-- ============================================
-- Fluxtracker: SQLite → PostgreSQL migration
-- ============================================

-- 1. daily_snapshots
CREATE TABLE IF NOT EXISTS daily_snapshots (
    id BIGSERIAL PRIMARY KEY,
    snapshot_date DATE NOT NULL UNIQUE,
    timestamp BIGINT NOT NULL,

    -- Revenue Metrics
    daily_revenue DOUBLE PRECISION NOT NULL DEFAULT 0,
    flux_price_usd DOUBLE PRECISION,

    -- Cloud Utilization - Totals
    total_cpu_cores INTEGER DEFAULT 0,
    used_cpu_cores INTEGER DEFAULT 0,
    cpu_utilization_percent DOUBLE PRECISION DEFAULT 0,

    total_ram_gb DOUBLE PRECISION DEFAULT 0,
    used_ram_gb DOUBLE PRECISION DEFAULT 0,
    ram_utilization_percent DOUBLE PRECISION DEFAULT 0,

    total_storage_gb DOUBLE PRECISION DEFAULT 0,
    used_storage_gb DOUBLE PRECISION DEFAULT 0,
    storage_utilization_percent DOUBLE PRECISION DEFAULT 0,

    -- App Counts
    total_apps INTEGER DEFAULT 0,
    watchtower_count INTEGER DEFAULT 0,
    gitapps_count INTEGER DEFAULT 0,
    dockerapps_count INTEGER DEFAULT 0,
    gitapps_percent DOUBLE PRECISION DEFAULT 0,
    dockerapps_percent DOUBLE PRECISION DEFAULT 0,

    -- Gaming
    gaming_apps_total INTEGER DEFAULT 0,
    gaming_palworld INTEGER DEFAULT 0,
    gaming_enshrouded INTEGER DEFAULT 0,
    gaming_minecraft INTEGER DEFAULT 0,
    gaming_valheim INTEGER DEFAULT 0,
    gaming_satisfactory INTEGER DEFAULT 0,

    -- Crypto Nodes
    crypto_presearch INTEGER DEFAULT 0,
    crypto_streamr INTEGER DEFAULT 0,
    crypto_ravencoin INTEGER DEFAULT 0,
    crypto_kadena INTEGER DEFAULT 0,
    crypto_alephium INTEGER DEFAULT 0,
    crypto_bittensor INTEGER DEFAULT 0,
    crypto_timpi_collector INTEGER DEFAULT 0,
    crypto_timpi_geocore INTEGER DEFAULT 0,
    crypto_kaspa INTEGER DEFAULT 0,
    crypto_nodes_total INTEGER DEFAULT 0,

    -- WordPress
    wordpress_count INTEGER DEFAULT 0,

    -- Node Distribution
    node_cumulus INTEGER DEFAULT 0,
    node_nimbus INTEGER DEFAULT 0,
    node_stratus INTEGER DEFAULT 0,
    node_total INTEGER DEFAULT 0,

    -- Metadata
    sync_status TEXT DEFAULT 'completed',
    created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshot_date ON daily_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_ds_timestamp ON daily_snapshots(timestamp);

-- 2. revenue_transactions
CREATE TABLE IF NOT EXISTS revenue_transactions (
    id BIGSERIAL PRIMARY KEY,
    txid TEXT NOT NULL UNIQUE,
    address TEXT NOT NULL,
    from_address TEXT DEFAULT 'Unknown',
    amount DOUBLE PRECISION NOT NULL,
    amount_usd DOUBLE PRECISION,
    block_height INTEGER NOT NULL,
    timestamp BIGINT NOT NULL,
    date DATE NOT NULL,
    app_name TEXT DEFAULT NULL,
    app_type TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_rt_address ON revenue_transactions(address);
CREATE INDEX IF NOT EXISTS idx_rt_from_address ON revenue_transactions(from_address);
CREATE INDEX IF NOT EXISTS idx_rt_block_height ON revenue_transactions(block_height);
CREATE INDEX IF NOT EXISTS idx_rt_date ON revenue_transactions(date);
CREATE INDEX IF NOT EXISTS idx_rt_timestamp ON revenue_transactions(timestamp);

-- 3. failed_txids
CREATE TABLE IF NOT EXISTS failed_txids (
    txid TEXT NOT NULL UNIQUE,
    address TEXT NOT NULL,
    failure_reason TEXT NOT NULL DEFAULT 'fetch_failed',
    attempt_count INTEGER NOT NULL DEFAULT 1,
    first_seen BIGINT NOT NULL,
    last_attempt BIGINT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_failed_txids_resolved ON failed_txids(resolved);

-- 4. current_metrics (singleton row)
CREATE TABLE IF NOT EXISTS current_metrics (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_update BIGINT NOT NULL,

    -- Revenue
    current_revenue DOUBLE PRECISION DEFAULT 0,
    flux_price_usd DOUBLE PRECISION,

    -- Cloud Utilization
    total_cpu_cores INTEGER DEFAULT 0,
    used_cpu_cores INTEGER DEFAULT 0,
    cpu_utilization_percent DOUBLE PRECISION DEFAULT 0,

    total_ram_gb DOUBLE PRECISION DEFAULT 0,
    used_ram_gb DOUBLE PRECISION DEFAULT 0,
    ram_utilization_percent DOUBLE PRECISION DEFAULT 0,

    total_storage_gb DOUBLE PRECISION DEFAULT 0,
    used_storage_gb DOUBLE PRECISION DEFAULT 0,
    storage_utilization_percent DOUBLE PRECISION DEFAULT 0,

    -- App Counts
    total_apps INTEGER DEFAULT 0,
    watchtower_count INTEGER DEFAULT 0,
    gitapps_count INTEGER DEFAULT 0,
    dockerapps_count INTEGER DEFAULT 0,
    gitapps_percent DOUBLE PRECISION DEFAULT 0,
    dockerapps_percent DOUBLE PRECISION DEFAULT 0,

    -- Gaming
    gaming_apps_total INTEGER DEFAULT 0,
    gaming_palworld INTEGER DEFAULT 0,
    gaming_enshrouded INTEGER DEFAULT 0,
    gaming_minecraft INTEGER DEFAULT 0,
    gaming_valheim INTEGER DEFAULT 0,
    gaming_satisfactory INTEGER DEFAULT 0,

    -- Crypto Nodes
    crypto_presearch INTEGER DEFAULT 0,
    crypto_streamr INTEGER DEFAULT 0,
    crypto_ravencoin INTEGER DEFAULT 0,
    crypto_kadena INTEGER DEFAULT 0,
    crypto_alephium INTEGER DEFAULT 0,
    crypto_bittensor INTEGER DEFAULT 0,
    crypto_timpi_collector INTEGER DEFAULT 0,
    crypto_timpi_geocore INTEGER DEFAULT 0,
    crypto_kaspa INTEGER DEFAULT 0,
    crypto_nodes_total INTEGER DEFAULT 0,

    -- WordPress
    wordpress_count INTEGER DEFAULT 0,

    -- Node Distribution
    node_cumulus INTEGER DEFAULT 0,
    node_nimbus INTEGER DEFAULT 0,
    node_stratus INTEGER DEFAULT 0,
    node_total INTEGER DEFAULT 0
);

-- Seed default singleton row
INSERT INTO current_metrics (id, last_update) VALUES (1, 0) ON CONFLICT DO NOTHING;

-- 5. flux_price_history
CREATE TABLE IF NOT EXISTS flux_price_history (
    date DATE NOT NULL PRIMARY KEY,
    price_usd DOUBLE PRECISION NOT NULL,
    source TEXT DEFAULT 'cryptocompare',
    created_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::BIGINT)
);

-- 6. sync_status
CREATE TABLE IF NOT EXISTS sync_status (
    id BIGSERIAL PRIMARY KEY,
    sync_type TEXT NOT NULL UNIQUE,
    last_sync BIGINT NOT NULL,
    last_sync_block INTEGER,
    next_sync BIGINT,
    status TEXT DEFAULT 'pending',
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_type ON sync_status(sync_type);

-- Seed sync status rows
INSERT INTO sync_status (sync_type, last_sync, status) VALUES
    ('revenue', 0, 'pending'),
    ('cloud', 0, 'pending'),
    ('gaming', 0, 'pending'),
    ('wordpress', 0, 'pending'),
    ('nodes', 0, 'pending'),
    ('crypto', 0, 'pending'),
    ('daily_snapshot', 0, 'pending')
ON CONFLICT (sync_type) DO NOTHING;

-- 7. repo_snapshots
CREATE TABLE IF NOT EXISTS repo_snapshots (
    id BIGSERIAL PRIMARY KEY,
    snapshot_date DATE NOT NULL,
    image_name TEXT NOT NULL,
    instance_count INTEGER NOT NULL DEFAULT 0,
    category TEXT DEFAULT NULL,
    created_at BIGINT NOT NULL,
    UNIQUE(snapshot_date, image_name)
);

CREATE INDEX IF NOT EXISTS idx_repo_snapshot_date ON repo_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_repo_image_name ON repo_snapshots(image_name);
CREATE INDEX IF NOT EXISTS idx_repo_composite ON repo_snapshots(image_name, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_repo_category ON repo_snapshots(category);
