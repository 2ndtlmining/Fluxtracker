-- Database size for the header (owner request, 2026-09-26). Read-only; safe to re-run.
--
-- The header showed the database size while the app ran on SQLite (the file's size). On
-- Supabase there is no file, so it has been blank since the migration. This is the same
-- figure Supabase's own dashboard reports: the whole database, in bytes.
CREATE OR REPLACE FUNCTION get_database_size()
RETURNS BIGINT AS $$
    SELECT pg_database_size(current_database());
$$ LANGUAGE sql STABLE SET search_path = public;
