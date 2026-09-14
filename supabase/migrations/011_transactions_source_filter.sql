-- Issue #159: filter the transaction history to Flux-team-funded or fiat-gateway payers
-- by clicking the TEAM / FIAT badges.
--
-- The predicate is an address-set match, not a text match: FLUX_TEAM_ADDRESSES and
-- FLUX_FIAT_ADDRESSES in config.js are lists that grow as gateways are rotated and added,
-- so this takes an array rather than a single address.
--
-- p_from_addresses is AND-ed with the existing search/app-name CASE rather than joining
-- it, so the payer filter composes with whatever is already active ("team-funded payments
-- for app alpha") instead of replacing it.
--
-- NULL or an empty array means "no payer filter" -- no badges selected has to mean show
-- everything, not show nothing.
--
-- The parameter carries a DEFAULT so callers that predate this migration keep working;
-- apply this migration BEFORE deploying the code that passes the new argument.
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
BEGIN
    search_term := '%' || COALESCE(p_search, '') || '%';

    RETURN QUERY
    WITH filtered AS (
        SELECT rt.*
        FROM revenue_transactions rt
        WHERE
            (
                p_from_addresses IS NULL
                OR cardinality(p_from_addresses) = 0
                OR rt.from_address = ANY(p_from_addresses)
            )
            AND CASE
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

-- The payer filter scans from_address across the whole table; without this the badge
-- click does a sequential scan of ~21k rows on every page turn.
CREATE INDEX IF NOT EXISTS idx_rt_from_address ON revenue_transactions(from_address);
