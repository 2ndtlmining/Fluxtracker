-- Issue #264: app lifetime and retention cohorts. Read-only; safe to re-run.
--
-- Built on the payment metadata migration 019 stores. An app "life" starts at a paid
-- registration and takes in every later payment for that name until the next registration --
-- names are reused once an app expires, so each registration begins a new life. The life
-- ends at its latest payment date plus the days that payment bought (expire_blocks / 2,880).
-- Payments before a name's first recorded registration (apps older than the history) have no
-- known start and are left out.
--
-- Per registration month:
--   new_apps                   lives started
--   eligible_N / survived_N    lives at least N days old today / of those, still paid for N days
--                              (only lives old enough to know count, so a young cohort is not
--                              shown as having died)
--   paid_again                 lives with at least one paid update or renewal
--   still_active               lives paid up beyond p_today
CREATE OR REPLACE FUNCTION get_app_cohorts(p_start DATE, p_end DATE, p_today DATE)
RETURNS TABLE(
    month DATE,
    new_apps INTEGER,
    eligible_30 INTEGER, survived_30 INTEGER,
    eligible_90 INTEGER, survived_90 INTEGER,
    eligible_180 INTEGER, survived_180 INTEGER,
    paid_again INTEGER,
    still_active INTEGER
) AS $$
DECLARE
    t DOUBLE PRECISION := p_today - DATE '2000-01-01';
BEGIN
    RETURN QUERY
    WITH p AS (
        SELECT rt.app_name, rt.date, rt.msg_type, rt.expire_blocks,
               SUM(CASE WHEN rt.msg_type = 'register' THEN 1 ELSE 0 END) OVER (
                   PARTITION BY rt.app_name ORDER BY rt.date, rt.block_height, rt.txid
                   ROWS UNBOUNDED PRECEDING) AS life
        FROM revenue_transactions rt
        WHERE rt.app_name IS NOT NULL AND rt.msg_type IS NOT NULL AND rt.date <= p_today
    ),
    lives AS (
        SELECT MIN(p.date) AS s,
               (MIN(p.date) - DATE '2000-01-01')::DOUBLE PRECISION AS s_num,
               MAX((p.date - DATE '2000-01-01') + p.expire_blocks / 2880.0) AS e_num,
               COUNT(*) FILTER (WHERE p.msg_type = 'update') AS updates
        FROM p
        WHERE p.life > 0
        GROUP BY p.app_name, p.life
    )
    SELECT date_trunc('month', l.s)::DATE,
           COUNT(*)::INTEGER,
           COUNT(*) FILTER (WHERE l.s_num + 30 <= t)::INTEGER,
           COUNT(*) FILTER (WHERE l.s_num + 30 <= t AND l.e_num >= l.s_num + 30)::INTEGER,
           COUNT(*) FILTER (WHERE l.s_num + 90 <= t)::INTEGER,
           COUNT(*) FILTER (WHERE l.s_num + 90 <= t AND l.e_num >= l.s_num + 90)::INTEGER,
           COUNT(*) FILTER (WHERE l.s_num + 180 <= t)::INTEGER,
           COUNT(*) FILTER (WHERE l.s_num + 180 <= t AND l.e_num >= l.s_num + 180)::INTEGER,
           COUNT(*) FILTER (WHERE l.updates > 0)::INTEGER,
           COUNT(*) FILTER (WHERE l.e_num > t)::INTEGER
    FROM lives l
    WHERE l.e_num IS NOT NULL
      AND l.s >= date_trunc('month', p_start)::DATE AND l.s <= p_end
    GROUP BY 1
    ORDER BY 1 ASC;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;
