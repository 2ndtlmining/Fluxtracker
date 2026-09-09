-- Decentralization metric (issue #108): one row per node IP ever classified via the free
-- ipwho.is/ip-api.com chain, cached indefinitely (an IP's ASN/org rarely changes) and
-- re-checked only once classified_at goes stale -- see decentralizationService.js.

CREATE TABLE IF NOT EXISTS node_ip_classification (
    ip TEXT PRIMARY KEY,
    asn INTEGER,
    org TEXT,
    is_datacenter BOOLEAN NOT NULL DEFAULT FALSE,
    classified_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_node_ip_classified_at ON node_ip_classification(classified_at);

-- Same RLS posture as every other table (003_enable_rls.sql): service_role bypasses this
-- entirely, so it only blocks accidental anon-key access.
ALTER TABLE node_ip_classification ENABLE ROW LEVEL SECURITY;
