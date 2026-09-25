-- Issue #267: the payer base -- is the paying customer base growing, and how dependent is
-- revenue on a handful of payers or apps? Aggregates only: no function here returns an
-- address. Both are read-only and safe to re-run.

-- Paying wallets per calendar month in [p_start, p_end], excluding p_exclude (the team and
-- fiat on-ramp addresses: the gateway pays on behalf of many anonymous buyers, so it is not
-- one customer). "New" means that wallet's FIRST payment ever falls in that month -- judged
-- over the whole table, not just the range, so a wallet that paid years ago is returning.
CREATE OR REPLACE FUNCTION get_monthly_payer_stats(p_start DATE, p_end DATE, p_exclude TEXT[])
RETURNS TABLE(month DATE, payers BIGINT, new_payers BIGINT) AS $$
BEGIN
    RETURN QUERY
    WITH firsts AS (
        SELECT rt.from_address, MIN(rt.date) AS first_date
        FROM revenue_transactions rt
        WHERE rt.from_address IS NOT NULL AND rt.from_address <> 'Unknown'
          AND NOT (rt.from_address = ANY(COALESCE(p_exclude, ARRAY[]::TEXT[])))
        GROUP BY rt.from_address
    ), monthly AS (
        SELECT DISTINCT date_trunc('month', rt.date)::DATE AS m, rt.from_address
        FROM revenue_transactions rt
        WHERE rt.date BETWEEN p_start AND p_end
          AND rt.from_address IS NOT NULL AND rt.from_address <> 'Unknown'
          AND NOT (rt.from_address = ANY(COALESCE(p_exclude, ARRAY[]::TEXT[])))
    )
    SELECT mo.m AS month,
           COUNT(*)::BIGINT AS payers,
           COUNT(*) FILTER (WHERE date_trunc('month', f.first_date)::DATE = mo.m)::BIGINT AS new_payers
    FROM monthly mo
    JOIN firsts f ON f.from_address = mo.from_address
    GROUP BY mo.m
    ORDER BY mo.m ASC;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- How concentrated all-time FLUX revenue is across apps: the total, the number of apps, the
-- top ten's revenue, and how few apps make up 80% of it. One row.
CREATE OR REPLACE FUNCTION get_app_revenue_concentration()
RETURNS TABLE(total_revenue DOUBLE PRECISION, app_count BIGINT, top10_revenue DOUBLE PRECISION, apps_for_80pct BIGINT) AS $$
BEGIN
    RETURN QUERY
    WITH per_app AS (
        SELECT rt.app_name, SUM(rt.amount) AS revenue
        FROM revenue_transactions rt
        WHERE rt.app_name IS NOT NULL
        GROUP BY rt.app_name
    ), ranked AS (
        SELECT revenue,
               ROW_NUMBER() OVER (ORDER BY revenue DESC, app_name) AS rank,
               SUM(revenue) OVER (ORDER BY revenue DESC, app_name ROWS UNBOUNDED PRECEDING) AS running,
               SUM(revenue) OVER () AS total
        FROM per_app
    )
    SELECT COALESCE(MAX(total), 0)::DOUBLE PRECISION,
           COUNT(*)::BIGINT,
           COALESCE(SUM(revenue) FILTER (WHERE rank <= 10), 0)::DOUBLE PRECISION,
           -- the first rank whose running total reaches 80%
           COALESCE(MIN(rank) FILTER (WHERE running >= 0.8 * total), 0)::BIGINT
    FROM ranked;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;
