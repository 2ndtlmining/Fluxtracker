-- Issue #294: get_transactions_paginated materialised and sorted the whole table on every page.
--
-- The old body referenced its `filtered` CTE twice (once to COUNT, once to page), and Postgres
-- 12+ materialises a CTE referenced more than once -- so every call copied every matching row
-- (all ~23k, all columns), counted them, then sorted all of them for ORDER BY ... LIMIT/OFFSET.
-- The CSV export pages through this at 1000 rows a call, so it paid that ~24 times.
--
-- Now:
--   * the count is a separate, uncorrelated scalar subquery -- planned once as an InitPlan,
--     and a bare COUNT(*) over the table when no filter is active;
--   * the page itself is a plain ORDER BY ... LIMIT that the new composite index can serve by
--     walking the index in order and stopping after OFFSET + LIMIT rows, no sort at all;
--   * the order is TOTAL: `id` breaks ties. 1,116 (block, timestamp) pairs are shared by more
--     than one payment (one transaction paying several outputs), and SQL leaves the order of
--     tied rows undefined. It happened to be stable for the old plan -- a full paged export
--     came back complete -- but it is the plan, not the query, that decides it: this rewrite
--     alone reordered 285 tied rows on the last export page. Without the tiebreak, any plan
--     change could make offset pages repeat or skip rows at a boundary.
-- Same signature and columns -- safe to apply before or after the code deploy.

CREATE INDEX IF NOT EXISTS idx_rt_block_height_ts_id_desc
    ON revenue_transactions (block_height DESC, "timestamp" DESC, id DESC);

CREATE OR REPLACE FUNCTION get_transactions_paginated(
    p_search TEXT,
    p_app TEXT,
    p_limit INTEGER,
    p_offset INTEGER,
    p_from_addresses TEXT[] DEFAULT NULL
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
    has_payers BOOLEAN;
    has_app BOOLEAN;
    has_search BOOLEAN;
BEGIN
    search_term := '%' || COALESCE(p_search, '') || '%';
    has_payers := p_from_addresses IS NOT NULL AND cardinality(p_from_addresses) > 0;
    has_app := p_app IS NOT NULL AND p_app != '';
    has_search := p_search IS NOT NULL AND p_search != '';

    RETURN QUERY
    SELECT
        rt.id,
        rt.txid,
        rt.address,
        rt.from_address,
        rt.amount,
        rt.amount_usd,
        rt.block_height,
        rt."timestamp",
        rt.date,
        rt.app_name,
        rt.app_type,
        (
            SELECT COUNT(*)
            FROM revenue_transactions c
            WHERE (NOT has_payers OR c.from_address = ANY(p_from_addresses))
              AND CASE
                    WHEN has_app THEN c.app_name = p_app
                    WHEN has_search THEN
                        c.txid ILIKE search_term OR
                        c.address ILIKE search_term OR
                        c.from_address ILIKE search_term OR
                        CAST(c.amount AS TEXT) ILIKE search_term OR
                        CAST(c.date AS TEXT) ILIKE search_term OR
                        c.app_name ILIKE search_term
                    ELSE TRUE
                  END
        ) AS total_count
    FROM revenue_transactions rt
    WHERE (NOT has_payers OR rt.from_address = ANY(p_from_addresses))
      AND CASE
            WHEN has_app THEN rt.app_name = p_app
            WHEN has_search THEN
                rt.txid ILIKE search_term OR
                rt.address ILIKE search_term OR
                rt.from_address ILIKE search_term OR
                CAST(rt.amount AS TEXT) ILIKE search_term OR
                CAST(rt.date AS TEXT) ILIKE search_term OR
                rt.app_name ILIKE search_term
            ELSE TRUE
          END
    ORDER BY rt.block_height DESC, rt."timestamp" DESC, rt.id DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;
