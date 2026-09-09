-- Issue #146: Team Funded historical trend. Same shape as get_daily_revenue_in_range /
-- get_daily_revenue_usd_in_range (002_rpc_functions.sql), with an address-list filter --
-- a per-day GROUP BY has to run server-side, so this can't reuse
-- getRevenueFromAddressesForDateRange()'s plain .in()-based single-range query.

CREATE OR REPLACE FUNCTION get_daily_revenue_from_addresses_in_range(p_start DATE, p_end DATE, p_addresses TEXT[])
RETURNS TABLE(date DATE, daily_revenue DOUBLE PRECISION) AS $$
BEGIN
    RETURN QUERY
    SELECT rt.date, SUM(rt.amount) AS daily_revenue
    FROM revenue_transactions rt
    WHERE rt.date BETWEEN p_start AND p_end
      AND rt.from_address = ANY(p_addresses)
    GROUP BY rt.date
    ORDER BY rt.date ASC;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;

CREATE OR REPLACE FUNCTION get_daily_revenue_usd_from_addresses_in_range(p_start DATE, p_end DATE, p_addresses TEXT[])
RETURNS TABLE(date DATE, daily_revenue_usd DOUBLE PRECISION) AS $$
BEGIN
    RETURN QUERY
    SELECT rt.date, SUM(COALESCE(rt.amount_usd, 0)) AS daily_revenue_usd
    FROM revenue_transactions rt
    WHERE rt.date BETWEEN p_start AND p_end
      AND rt.from_address = ANY(p_addresses)
    GROUP BY rt.date
    ORDER BY rt.date ASC;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;
