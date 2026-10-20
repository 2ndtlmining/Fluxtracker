-- Covering index for the per-day revenue sums.
--
-- get_daily_revenue(_in_range), get_daily_revenue_usd(_in_range) and
-- get_daily_revenue_sources filter on date and read only amount, amount_usd and
-- from_address. With those columns INCLUDEd, Postgres can answer them with an index-only
-- scan instead of fetching every matching row from the table -- the "All" timeframe reads
-- the whole table. The SQLite adapter creates the same index (sqliteAdapter.js).
--
-- Its key is date alone, so it serves every lookup idx_rt_date (001) did; that index is
-- dropped so inserts do not maintain two copies of the same key.
CREATE INDEX IF NOT EXISTS idx_rt_date_amounts
    ON revenue_transactions (date) INCLUDE (amount, amount_usd, from_address);

DROP INDEX IF EXISTS idx_rt_date;
