-- Free-trial badge on the transaction log.
--
-- Flux pays the first week of a new deployment from a team address. Those payments stay
-- Flux team; the table marks them TRIAL so the free deployments are easy to see. A trial is
-- a REGISTRATION from a trial address (config.js isFluxTrialPayment), so the table needs:
--   * msg_type in the returned rows, to badge each one (it was not returned before);
--   * p_trial_addresses, the TRIAL filter -- OR-ed with p_from_addresses, like the badges.
--
-- RETURNS TABLE changes, which CREATE OR REPLACE cannot do, hence the DROP. The old
-- 5-argument signature has to go too or PostgREST would see two candidates. Apply before or
-- after the code deploy: the code only sends p_trial_addresses when TRIAL is selected, and
-- rows without msg_type simply show TEAM.

DROP FUNCTION IF EXISTS get_transactions_paginated(TEXT, TEXT, INTEGER, INTEGER, TEXT[]);

CREATE OR REPLACE FUNCTION get_transactions_paginated(
    p_search TEXT,
    p_app TEXT,
    p_limit INTEGER,
    p_offset INTEGER,
    p_from_addresses TEXT[] DEFAULT NULL,
    p_trial_addresses TEXT[] DEFAULT NULL
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
    msg_type TEXT,
    total_count BIGINT
) AS $$
DECLARE
    search_term TEXT;
    has_payers BOOLEAN;
    has_trial BOOLEAN;
    has_app BOOLEAN;
    has_search BOOLEAN;
BEGIN
    search_term := '%' || COALESCE(p_search, '') || '%';
    has_payers := p_from_addresses IS NOT NULL AND cardinality(p_from_addresses) > 0;
    has_trial := p_trial_addresses IS NOT NULL AND cardinality(p_trial_addresses) > 0;
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
        rt.msg_type,
        (
            SELECT COUNT(*)
            FROM revenue_transactions c
            WHERE ((NOT has_payers AND NOT has_trial)
                   OR (has_payers AND c.from_address = ANY(p_from_addresses))
                   OR (has_trial AND c.msg_type = 'register' AND c.from_address = ANY(p_trial_addresses)))
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
    WHERE ((NOT has_payers AND NOT has_trial)
           OR (has_payers AND rt.from_address = ANY(p_from_addresses))
           OR (has_trial AND rt.msg_type = 'register' AND rt.from_address = ANY(p_trial_addresses)))
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
