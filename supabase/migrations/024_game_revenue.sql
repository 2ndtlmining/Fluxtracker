-- Issue #265: game-server revenue. Read-only; safe to re-run.
--
-- Per day: all revenue, and the part paid for game servers. A game server is recognised by
-- its app NAME, the one thing that survives spec encryption: Flux's game sites deploy as
-- `<prefix><13-digit timestamp>` ("palworld1790087212677"). The pattern is NOT written here
-- -- the API passes it in, built from GAME_APP_PREFIXES in config.js, the same list the
-- Gaming card counts instances with -- so adding a game there updates this too.
--
-- Coverage, stated plainly: this is game servers deployed through the game sites. A game
-- deployed by hand under another name is not counted, and nothing else is inferred.
CREATE OR REPLACE FUNCTION get_daily_game_revenue(p_start DATE, p_end DATE, p_pattern TEXT)
RETURNS TABLE(
    date DATE,
    total_flux DOUBLE PRECISION,
    game_flux DOUBLE PRECISION,
    game_usd DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT rt.date,
           SUM(rt.amount)::DOUBLE PRECISION,
           COALESCE(SUM(rt.amount) FILTER (WHERE lower(rt.app_name) ~ p_pattern), 0)::DOUBLE PRECISION,
           COALESCE(SUM(COALESCE(rt.amount_usd, 0)) FILTER (WHERE lower(rt.app_name) ~ p_pattern), 0)::DOUBLE PRECISION
    FROM revenue_transactions rt
    WHERE rt.date BETWEEN p_start AND p_end
    GROUP BY rt.date
    ORDER BY rt.date ASC;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;
