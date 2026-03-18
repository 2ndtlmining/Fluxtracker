-- Partial index to speed up the USD backfill query
-- (scans only rows where amount_usd has not been filled yet)
CREATE INDEX IF NOT EXISTS idx_rt_usd_null
ON revenue_transactions(txid) WHERE amount_usd IS NULL;
