-- Batch USD backfill.
--
-- updateTransactionUsdBatch() previously issued one PostgREST UPDATE per transaction, so
-- backfilling ~21,000 rows meant ~21,000 HTTP round-trips. This RPC does the whole batch in a
-- single statement. The `amount_usd IS NULL` guard is kept so the RPC can never overwrite a
-- value that was already set from the live price.

CREATE OR REPLACE FUNCTION update_transaction_usd_batch(p_updates JSONB)
RETURNS INTEGER AS $$
DECLARE
    affected INTEGER;
BEGIN
    UPDATE revenue_transactions rt
    SET amount_usd = u.amount_usd
    FROM jsonb_to_recordset(p_updates) AS u(txid TEXT, amount_usd DOUBLE PRECISION)
    WHERE rt.txid = u.txid
      AND rt.amount_usd IS NULL;

    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$ LANGUAGE plpgsql SET search_path = public;
