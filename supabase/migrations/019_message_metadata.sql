-- Issue #262: persist the permanent-message metadata the revenue sync already downloads every
-- hour and used to discard. Each payment's message says whether it registered a new app or
-- updated/renewed one, whether the spec is enterprise, how many blocks it paid for and how
-- many instances it ordered. Safe to run more than once; every column is nullable, so rows
-- written before this migration (or never matched to a message) simply stay NULL.

ALTER TABLE revenue_transactions ADD COLUMN IF NOT EXISTS msg_type TEXT;          -- 'register' | 'update'
ALTER TABLE revenue_transactions ADD COLUMN IF NOT EXISTS enterprise BOOLEAN;
ALTER TABLE revenue_transactions ADD COLUMN IF NOT EXISTS expire_blocks INTEGER;
ALTER TABLE revenue_transactions ADD COLUMN IF NOT EXISTS instances INTEGER;

-- Back-fill in one statement per batch (same shape as migration 006's USD batch). Only rows
-- with no metadata yet are touched, so re-running it never overwrites what the sync wrote.
CREATE OR REPLACE FUNCTION update_transaction_metadata_batch(p_updates JSONB)
RETURNS INTEGER AS $$
DECLARE
    affected INTEGER;
BEGIN
    UPDATE revenue_transactions rt
    SET msg_type = u.msg_type,
        enterprise = u.enterprise,
        expire_blocks = u.expire_blocks,
        instances = u.instances
    FROM jsonb_to_recordset(p_updates)
        AS u(txid TEXT, msg_type TEXT, enterprise BOOLEAN, expire_blocks INTEGER, instances INTEGER)
    WHERE rt.txid = u.txid
      AND rt.msg_type IS NULL;

    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$ LANGUAGE plpgsql SET search_path = public;
