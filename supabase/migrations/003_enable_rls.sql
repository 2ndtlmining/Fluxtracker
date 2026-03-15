-- ============================================
-- Enable Row Level Security on all tables
-- ============================================
-- Our backend uses the service_role key which bypasses RLS entirely,
-- so these policies won't affect normal operation. This is a safety net
-- to block any accidental access via the anon key.

-- Enable RLS on all tables
ALTER TABLE daily_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE failed_txids ENABLE ROW LEVEL SECURITY;
ALTER TABLE current_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE flux_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE repo_snapshots ENABLE ROW LEVEL SECURITY;

-- No policies = anon key gets zero access (deny all by default)
-- The service_role key bypasses RLS, so our backend is unaffected.
