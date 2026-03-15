-- ============================================
-- RPC functions for complex aggregation queries
-- ============================================

-- 1. Daily revenue (FLUX) for last N days
CREATE OR REPLACE FUNCTION get_daily_revenue(start_date DATE)
RETURNS TABLE(date DATE, daily_revenue DOUBLE PRECISION) AS $$
BEGIN
    RETURN QUERY
    SELECT rt.date, SUM(rt.amount) AS daily_revenue
    FROM revenue_transactions rt
    WHERE rt.date >= start_date
    GROUP BY rt.date
    ORDER BY rt.date ASC;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- 2. Daily revenue (FLUX) in a date range
CREATE OR REPLACE FUNCTION get_daily_revenue_in_range(p_start DATE, p_end DATE)
RETURNS TABLE(date DATE, daily_revenue DOUBLE PRECISION) AS $$
BEGIN
    RETURN QUERY
    SELECT rt.date, SUM(rt.amount) AS daily_revenue
    FROM revenue_transactions rt
    WHERE rt.date BETWEEN p_start AND p_end
    GROUP BY rt.date
    ORDER BY rt.date ASC;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- 3. Daily revenue (USD) for last N days
CREATE OR REPLACE FUNCTION get_daily_revenue_usd(start_date DATE)
RETURNS TABLE(date DATE, daily_revenue_usd DOUBLE PRECISION, usd_count BIGINT, total_count BIGINT) AS $$
BEGIN
    RETURN QUERY
    SELECT
        rt.date,
        SUM(COALESCE(rt.amount_usd, 0)) AS daily_revenue_usd,
        COUNT(CASE WHEN rt.amount_usd IS NOT NULL THEN 1 END) AS usd_count,
        COUNT(*) AS total_count
    FROM revenue_transactions rt
    WHERE rt.date >= start_date
    GROUP BY rt.date
    ORDER BY rt.date ASC;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- 4. Daily revenue (USD) in a date range
CREATE OR REPLACE FUNCTION get_daily_revenue_usd_in_range(p_start DATE, p_end DATE)
RETURNS TABLE(date DATE, daily_revenue_usd DOUBLE PRECISION, usd_count BIGINT, total_count BIGINT) AS $$
BEGIN
    RETURN QUERY
    SELECT
        rt.date,
        SUM(COALESCE(rt.amount_usd, 0)) AS daily_revenue_usd,
        COUNT(CASE WHEN rt.amount_usd IS NOT NULL THEN 1 END) AS usd_count,
        COUNT(*) AS total_count
    FROM revenue_transactions rt
    WHERE rt.date BETWEEN p_start AND p_end
    GROUP BY rt.date
    ORDER BY rt.date ASC;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- 5. App analytics (GROUP BY app_name)
CREATE OR REPLACE FUNCTION get_app_analytics(p_search TEXT, p_limit INTEGER, p_offset INTEGER)
RETURNS TABLE(
    app_name TEXT,
    transaction_count BIGINT,
    total_revenue DOUBLE PRECISION,
    avg_payment DOUBLE PRECISION,
    first_payment DATE,
    last_payment DATE,
    total_count BIGINT
) AS $$
DECLARE
    search_term TEXT;
BEGIN
    search_term := '%' || COALESCE(p_search, '') || '%';

    -- Get total count first
    RETURN QUERY
    WITH filtered AS (
        SELECT rt.app_name
        FROM revenue_transactions rt
        WHERE rt.app_name IS NOT NULL AND rt.app_name != ''
          AND (p_search IS NULL OR p_search = '' OR rt.app_name ILIKE search_term)
        GROUP BY rt.app_name
    ),
    total AS (
        SELECT COUNT(*) AS cnt FROM filtered
    )
    SELECT
        rt.app_name,
        COUNT(*)::BIGINT AS transaction_count,
        SUM(rt.amount) AS total_revenue,
        AVG(rt.amount) AS avg_payment,
        MIN(rt.date) AS first_payment,
        MAX(rt.date) AS last_payment,
        (SELECT cnt FROM total) AS total_count
    FROM revenue_transactions rt
    WHERE rt.app_name IS NOT NULL AND rt.app_name != ''
      AND (p_search IS NULL OR p_search = '' OR rt.app_name ILIKE search_term)
    GROUP BY rt.app_name
    ORDER BY SUM(rt.amount) DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- 6. Top repos by category (strips image tags)
CREATE OR REPLACE FUNCTION get_top_repos_by_category(cat TEXT, lim INTEGER)
RETURNS TABLE(image_name TEXT, instance_count BIGINT) AS $$
BEGIN
    RETURN QUERY
    WITH latest AS (
        SELECT MAX(rs.snapshot_date) AS d
        FROM repo_snapshots rs
        WHERE rs.category = cat
    )
    SELECT
        CASE WHEN POSITION(':' IN rs.image_name) > 0
             THEN SPLIT_PART(rs.image_name, ':', 1)
             ELSE rs.image_name
        END AS image_name,
        SUM(rs.instance_count)::BIGINT AS instance_count
    FROM repo_snapshots rs, latest
    WHERE rs.category = cat AND rs.snapshot_date = latest.d
    GROUP BY 1
    ORDER BY instance_count DESC
    LIMIT lim;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- 7. Category history (aggregated daily totals)
CREATE OR REPLACE FUNCTION get_category_history(cat TEXT, lim INTEGER)
RETURNS TABLE(snapshot_date DATE, total_count BIGINT) AS $$
BEGIN
    RETURN QUERY
    SELECT rs.snapshot_date, SUM(rs.instance_count)::BIGINT AS total_count
    FROM repo_snapshots rs
    WHERE rs.category = cat
    GROUP BY rs.snapshot_date
    ORDER BY rs.snapshot_date DESC
    LIMIT lim;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- 8. Repos by category (distinct base names)
CREATE OR REPLACE FUNCTION get_repos_by_category(cat TEXT)
RETURNS TABLE(image_name TEXT) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT
        CASE WHEN POSITION(':' IN rs.image_name) > 0
             THEN SPLIT_PART(rs.image_name, ':', 1)
             ELSE rs.image_name
        END AS image_name
    FROM repo_snapshots rs
    WHERE rs.category = cat
    ORDER BY image_name;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- 9. Repo history merged (merge tagged images, SUM counts)
CREATE OR REPLACE FUNCTION get_repo_history_merged(p_image TEXT, lim INTEGER)
RETURNS TABLE(snapshot_date DATE, instance_count BIGINT) AS $$
BEGIN
    RETURN QUERY
    SELECT rs.snapshot_date, SUM(rs.instance_count)::BIGINT AS instance_count
    FROM repo_snapshots rs
    WHERE rs.image_name LIKE p_image || ':%' OR rs.image_name = p_image
    GROUP BY rs.snapshot_date
    ORDER BY rs.snapshot_date DESC
    LIMIT lim;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- 10. Distinct repo image names (avoids PostgREST row limit)
CREATE OR REPLACE FUNCTION get_distinct_repos()
RETURNS TABLE(image_name TEXT) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT rs.image_name
    FROM repo_snapshots rs
    ORDER BY rs.image_name;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- 11. Count of distinct repo image names
CREATE OR REPLACE FUNCTION get_distinct_repo_count()
RETURNS BIGINT AS $$
BEGIN
    RETURN (SELECT COUNT(DISTINCT image_name) FROM repo_snapshots);
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

-- 12. Paginated transactions with search
CREATE OR REPLACE FUNCTION get_transactions_paginated(
    p_search TEXT,
    p_app TEXT,
    p_limit INTEGER,
    p_offset INTEGER
)
RETURNS TABLE(
    id BIGINT,
    txid TEXT,
    address TEXT,
    from_address TEXT,
    amount DOUBLE PRECISION,
    amount_usd DOUBLE PRECISION,
    block_height INTEGER,
    "timestamp" BIGINT,
    date DATE,
    app_name TEXT,
    app_type TEXT,
    total_count BIGINT
) AS $$
DECLARE
    search_term TEXT;
BEGIN
    search_term := '%' || COALESCE(p_search, '') || '%';

    RETURN QUERY
    WITH filtered AS (
        SELECT rt.*
        FROM revenue_transactions rt
        WHERE
            CASE
                WHEN p_app IS NOT NULL AND p_app != '' THEN rt.app_name = p_app
                WHEN p_search IS NOT NULL AND p_search != '' THEN
                    rt.txid ILIKE search_term OR
                    rt.address ILIKE search_term OR
                    rt.from_address ILIKE search_term OR
                    CAST(rt.amount AS TEXT) ILIKE search_term OR
                    CAST(rt.date AS TEXT) ILIKE search_term OR
                    rt.app_name ILIKE search_term
                ELSE TRUE
            END
    ),
    total AS (
        SELECT COUNT(*) AS cnt FROM filtered
    )
    SELECT
        f.id,
        f.txid,
        f.address,
        f.from_address,
        f.amount,
        f.amount_usd,
        f.block_height,
        f.timestamp,
        f.date,
        f.app_name,
        f.app_type,
        (SELECT cnt FROM total) AS total_count
    FROM filtered f
    ORDER BY f.block_height DESC, f.timestamp DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;
