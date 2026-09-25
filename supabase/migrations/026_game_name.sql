-- Issue #395: game-server revenue before the game sites existed. Safe to re-run.
--
-- Migration 024 recognised a game server by its game-site app name (`palworld` + a 13-digit
-- timestamp). Game servers deployed by hand before the sites -- `rustserver`, `vrising`,
-- `Minecraft`, `terraria`... -- were not counted, so game revenue looked like it started in
-- mid-2026. Each payment's permanent message names the app's container image, and the
-- dashboard already knows which images are games (categorizeImage). This stores the game a
-- payment was for: from the site-style name, or else from a game image in its message.
-- Measured on the dev history: +$3,074 of game revenue, every month back to June 2024.
--
-- Coverage, stated plainly: payments whose spec is private (encrypted, ~12%) hide their image,
-- so they only count when they use a game-site name. NULL = not a game (or not knowable).
ALTER TABLE revenue_transactions ADD COLUMN IF NOT EXISTS game_name TEXT;

-- Back-fill in one statement per batch, like update_transaction_metadata_batch (019). Only
-- rows with no game yet are touched, so re-running it never overwrites the sync's value.
CREATE OR REPLACE FUNCTION update_transaction_game_batch(p_updates JSONB)
RETURNS INTEGER AS $$
DECLARE
    affected INTEGER;
BEGIN
    UPDATE revenue_transactions rt
    SET game_name = u.game_name
    FROM jsonb_to_recordset(p_updates) AS u(txid TEXT, game_name TEXT)
    WHERE rt.txid = u.txid
      AND rt.game_name IS NULL
      AND u.game_name IS NOT NULL;

    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Same signature as 024: a payment is game revenue when it has a game_name OR its app name
-- matches the game-site pattern (so payments the back-fill has not reached still count).
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
           COALESCE(SUM(rt.amount) FILTER (WHERE rt.game_name IS NOT NULL OR lower(rt.app_name) ~ p_pattern), 0)::DOUBLE PRECISION,
           COALESCE(SUM(COALESCE(rt.amount_usd, 0)) FILTER (WHERE rt.game_name IS NOT NULL OR lower(rt.app_name) ~ p_pattern), 0)::DOUBLE PRECISION
    FROM revenue_transactions rt
    WHERE rt.date BETWEEN p_start AND p_end
    GROUP BY rt.date
    ORDER BY rt.date ASC;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public;
