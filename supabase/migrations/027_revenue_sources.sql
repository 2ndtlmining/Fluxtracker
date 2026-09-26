-- Issue #386: the Revenue Sources chart in one query instead of six. Read-only; safe to re-run.
--
-- /api/history/revenue/sources/daily used to call six RPCs over the same date range -- total
-- FLUX, total USD, then FLUX and USD for the team addresses and for the fiat on-ramp -- six
-- PostgREST round trips for what is one scan with different filters. Same sums, same rules as
-- get_daily_revenue_in_range / _usd_in_range (002) and the _from_addresses_ pair (010): USD
-- counts a missing amount_usd as 0. Until this is applied the API falls back to the six calls.
CREATE OR REPLACE FUNCTION get_daily_revenue_sources(p_start DATE, p_end DATE, p_team TEXT[], p_fiat TEXT[])
RETURNS TABLE(
    date DATE,
    total_flux DOUBLE PRECISION,
    total_usd DOUBLE PRECISION,
    team_flux DOUBLE PRECISION,
    team_usd DOUBLE PRECISION,
    fiat_flux DOUBLE PRECISION,
    fiat_usd DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT rt.date,
           SUM(rt.amount)::DOUBLE PRECISION,
           SUM(COALESCE(rt.amount_usd, 0))::DOUBLE PRECISION,
           COALESCE(SUM(rt.amount) FILTER (WHERE rt.from_address = ANY(p_team)), 0)::DOUBLE PRECISION,
           COALESCE(SUM(COALESCE(rt.amount_usd, 0)) FILTER (WHERE rt.from_address = ANY(p_team)), 0)::DOUBLE PRECISION,
           COALESCE(SUM(rt.amount) FILTER (WHERE rt.from_address = ANY(p_fiat)), 0)::DOUBLE PRECISION,
           COALESCE(SUM(COALESCE(rt.amount_usd, 0)) FILTER (WHERE rt.from_address = ANY(p_fiat)), 0)::DOUBLE PRECISION
    FROM revenue_transactions rt
    WHERE rt.date BETWEEN p_start AND p_end
    GROUP BY rt.date
    ORDER BY rt.date ASC;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;
