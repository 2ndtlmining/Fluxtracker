-- Issue #262 part 2: daily revenue mix from the message metadata migration 019 added --
-- new apps vs renewals/updates, enterprise vs standard, and the average commitment length
-- (days bought per payment, as a sum and a count). Read-only; safe to re-run. Payments with no metadata (about 3%,
-- never matched to a message) are counted in total_flux only, so every share is honest about
-- what it covers.
CREATE OR REPLACE FUNCTION get_daily_revenue_mix(p_start DATE, p_end DATE)
RETURNS TABLE(
    date DATE,
    total_flux DOUBLE PRECISION,
    new_flux DOUBLE PRECISION,
    new_usd DOUBLE PRECISION,
    update_flux DOUBLE PRECISION,
    update_usd DOUBLE PRECISION,
    enterprise_flux DOUBLE PRECISION,
    enterprise_usd DOUBLE PRECISION,
    commitment_days_sum DOUBLE PRECISION,
    commitment_payments INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT rt.date,
           SUM(rt.amount)::DOUBLE PRECISION,
           COALESCE(SUM(rt.amount) FILTER (WHERE rt.msg_type = 'register'), 0)::DOUBLE PRECISION,
           COALESCE(SUM(COALESCE(rt.amount_usd, 0)) FILTER (WHERE rt.msg_type = 'register'), 0)::DOUBLE PRECISION,
           COALESCE(SUM(rt.amount) FILTER (WHERE rt.msg_type = 'update'), 0)::DOUBLE PRECISION,
           COALESCE(SUM(COALESCE(rt.amount_usd, 0)) FILTER (WHERE rt.msg_type = 'update'), 0)::DOUBLE PRECISION,
           COALESCE(SUM(rt.amount) FILTER (WHERE rt.enterprise), 0)::DOUBLE PRECISION,
           COALESCE(SUM(COALESCE(rt.amount_usd, 0)) FILTER (WHERE rt.enterprise), 0)::DOUBLE PRECISION,
           -- 2,880 blocks a day. A sum and a count rather than an average, so a week or a
           -- month can be averaged over its payments, not over its daily averages
           COALESCE(SUM(rt.expire_blocks / 2880.0), 0)::DOUBLE PRECISION,
           COUNT(rt.expire_blocks)::INTEGER
    FROM revenue_transactions rt
    WHERE rt.date BETWEEN p_start AND p_end
    GROUP BY rt.date
    ORDER BY rt.date ASC;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;
