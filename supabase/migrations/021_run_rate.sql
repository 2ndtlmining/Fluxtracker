-- Issue #263: run-rate (amortised MRR) and deferred revenue. Read-only; safe to re-run.
--
-- Each payment's USD is spread evenly over the days it bought (expire_blocks / 2,880 blocks a
-- day, stored by migration 019), so one big prepayment no longer reads as one big day.
-- For every day in the range:
--   daily_rate_usd  the USD per day of every payment active that day (MRR = x 365.25/12)
--   deferred_usd    paid but not yet consumed, as of the start of the day
-- Payments with no known term (never matched to a message) or no USD value are left out.
--
-- Computed from start/end events and a running sum rather than a join of days x payments,
-- so the cost is one pass over the payments however long the range is. For a payment
-- starting on day s for len days at rate r = usd/len, active while (d - s) < len:
--   rate(d)     = SUM(r)                    over active payments
--   deferred(d) = SUM(r * (s + len)) - d * rate(d)   (the unconsumed r * (s + len - d))
CREATE OR REPLACE FUNCTION get_daily_run_rate(p_start DATE, p_end DATE)
RETURNS TABLE(date DATE, daily_rate_usd DOUBLE PRECISION, deferred_usd DOUBLE PRECISION) AS $$
BEGIN
    RETURN QUERY
    WITH pay AS (
        SELECT rt.date AS s,
               (rt.date - DATE '2000-01-01') AS s_num,
               rt.expire_blocks / 2880.0 AS len,
               rt.amount_usd AS usd
        FROM revenue_transactions rt
        WHERE rt.expire_blocks > 0 AND rt.amount_usd > 0 AND rt.date <= p_end
    ),
    ev AS (
        SELECT s AS d, usd / len AS dr, usd / len * (s_num + len) AS dk FROM pay
        UNION ALL
        SELECT s + CEIL(len)::INTEGER, -usd / len, -usd / len * (s_num + len) FROM pay
    ),
    days AS (
        SELECT gs::DATE AS d
        FROM generate_series((SELECT MIN(s) FROM pay), p_end, INTERVAL '1 day') gs
    ),
    cum AS (
        SELECT days.d,
               SUM(COALESCE(e.dr, 0)) OVER (ORDER BY days.d) AS a,
               SUM(COALESCE(e.dk, 0)) OVER (ORDER BY days.d) AS k
        FROM days
        LEFT JOIN (SELECT ev.d, SUM(ev.dr) AS dr, SUM(ev.dk) AS dk FROM ev GROUP BY ev.d) e
            ON e.d = days.d
    )
    SELECT cum.d,
           GREATEST(cum.a, 0)::DOUBLE PRECISION,
           GREATEST(cum.k - (cum.d - DATE '2000-01-01') * cum.a, 0)::DOUBLE PRECISION
    FROM cum
    WHERE cum.d >= p_start
    ORDER BY cum.d ASC;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;
