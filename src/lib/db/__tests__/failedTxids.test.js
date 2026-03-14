import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

// We test the SQL logic directly against an in-memory DB
// rather than importing from database.js (which has side effects).

let db;

// Replicate the table creation and functions exactly as they'll appear in database.js
function createFailedTxidsTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS failed_txids (
            txid TEXT NOT NULL UNIQUE,
            address TEXT NOT NULL,
            failure_reason TEXT NOT NULL DEFAULT 'fetch_failed',
            attempt_count INTEGER NOT NULL DEFAULT 1,
            first_seen INTEGER NOT NULL,
            last_attempt INTEGER NOT NULL,
            resolved INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_failed_txids_resolved ON failed_txids(resolved);
    `);
}

function upsertFailedTxid(db, txid, address, reason = 'fetch_failed') {
    const now = Math.floor(Date.now() / 1000);
    const stmt = db.prepare(`
        INSERT INTO failed_txids (txid, address, failure_reason, attempt_count, first_seen, last_attempt, resolved)
        VALUES (?, ?, ?, 1, ?, ?, 0)
        ON CONFLICT(txid) DO UPDATE SET
            attempt_count = attempt_count + 1,
            last_attempt = ?,
            failure_reason = ?,
            resolved = 0
    `);
    stmt.run(txid, address, reason, now, now, now, reason);
}

function getUnresolvedFailedTxids(db, limit = 200) {
    const stmt = db.prepare(`
        SELECT txid, address, failure_reason, attempt_count, first_seen, last_attempt
        FROM failed_txids
        WHERE resolved = 0
        ORDER BY attempt_count ASC, last_attempt ASC
        LIMIT ?
    `);
    return stmt.all(limit);
}

function resolveFailedTxid(db, txid) {
    const stmt = db.prepare('UPDATE failed_txids SET resolved = 1 WHERE txid = ?');
    stmt.run(txid);
}

function getFailedTxidCount(db) {
    const stmt = db.prepare('SELECT COUNT(*) as count FROM failed_txids WHERE resolved = 0');
    return stmt.get().count;
}

function clearAbandonedFailedTxids(db, maxAgeDays = 30) {
    const cutoff = Math.floor(Date.now() / 1000) - (maxAgeDays * 86400);
    const stmt = db.prepare('DELETE FROM failed_txids WHERE resolved = 1 AND last_attempt < ?');
    return stmt.run(cutoff).changes;
}

function isFailedTxid(db, txid) {
    const stmt = db.prepare('SELECT * FROM failed_txids WHERE txid = ? AND resolved = 0');
    return stmt.get(txid) || null;
}

describe('failed_txids table', () => {
    beforeEach(() => {
        db = new Database(':memory:');
        createFailedTxidsTable(db);
    });

    describe('upsertFailedTxid', () => {
        it('inserts a new failed txid with attempt_count=1', () => {
            upsertFailedTxid(db, 'tx_abc123', 't1addr', 'fetch_failed');

            const row = db.prepare('SELECT * FROM failed_txids WHERE txid = ?').get('tx_abc123');
            expect(row).toBeTruthy();
            expect(row.attempt_count).toBe(1);
            expect(row.address).toBe('t1addr');
            expect(row.failure_reason).toBe('fetch_failed');
            expect(row.resolved).toBe(0);
        });

        it('increments attempt_count on duplicate txid', () => {
            upsertFailedTxid(db, 'tx_abc123', 't1addr', 'fetch_failed');
            upsertFailedTxid(db, 'tx_abc123', 't1addr', 'timeout');

            const row = db.prepare('SELECT * FROM failed_txids WHERE txid = ?').get('tx_abc123');
            expect(row.attempt_count).toBe(2);
            expect(row.failure_reason).toBe('timeout');
        });

        it('re-opens a resolved txid on upsert', () => {
            upsertFailedTxid(db, 'tx_abc123', 't1addr', 'fetch_failed');
            resolveFailedTxid(db, 'tx_abc123');

            const before = isFailedTxid(db, 'tx_abc123');
            expect(before).toBeNull();

            upsertFailedTxid(db, 'tx_abc123', 't1addr', 'fetch_failed');

            const after = isFailedTxid(db, 'tx_abc123');
            expect(after).toBeTruthy();
            expect(after.resolved).toBe(0);
        });
    });

    describe('getUnresolvedFailedTxids', () => {
        it('returns only unresolved txids', () => {
            upsertFailedTxid(db, 'tx_1', 'addr1', 'fetch_failed');
            upsertFailedTxid(db, 'tx_2', 'addr2', 'fetch_failed');
            upsertFailedTxid(db, 'tx_3', 'addr3', 'fetch_failed');
            resolveFailedTxid(db, 'tx_2');

            const results = getUnresolvedFailedTxids(db);
            expect(results.length).toBe(2);
            expect(results.map(r => r.txid)).toContain('tx_1');
            expect(results.map(r => r.txid)).toContain('tx_3');
            expect(results.map(r => r.txid)).not.toContain('tx_2');
        });

        it('orders by attempt_count ASC (least attempted first)', () => {
            upsertFailedTxid(db, 'tx_many', 'addr1', 'fetch_failed');
            upsertFailedTxid(db, 'tx_many', 'addr1', 'fetch_failed'); // 2 attempts
            upsertFailedTxid(db, 'tx_many', 'addr1', 'fetch_failed'); // 3 attempts
            upsertFailedTxid(db, 'tx_few', 'addr2', 'fetch_failed');  // 1 attempt

            const results = getUnresolvedFailedTxids(db);
            expect(results[0].txid).toBe('tx_few');
            expect(results[1].txid).toBe('tx_many');
        });

        it('respects limit parameter', () => {
            for (let i = 0; i < 10; i++) {
                upsertFailedTxid(db, `tx_${i}`, 'addr', 'fetch_failed');
            }
            const results = getUnresolvedFailedTxids(db, 3);
            expect(results.length).toBe(3);
        });
    });

    describe('resolveFailedTxid', () => {
        it('marks txid as resolved', () => {
            upsertFailedTxid(db, 'tx_1', 'addr1', 'fetch_failed');
            resolveFailedTxid(db, 'tx_1');

            const row = db.prepare('SELECT * FROM failed_txids WHERE txid = ?').get('tx_1');
            expect(row.resolved).toBe(1);
        });

        it('does nothing for nonexistent txid', () => {
            // Should not throw
            resolveFailedTxid(db, 'nonexistent');
        });
    });

    describe('getFailedTxidCount', () => {
        it('returns count of unresolved txids', () => {
            expect(getFailedTxidCount(db)).toBe(0);

            upsertFailedTxid(db, 'tx_1', 'addr1', 'fetch_failed');
            upsertFailedTxid(db, 'tx_2', 'addr2', 'fetch_failed');
            expect(getFailedTxidCount(db)).toBe(2);

            resolveFailedTxid(db, 'tx_1');
            expect(getFailedTxidCount(db)).toBe(1);
        });
    });

    describe('clearAbandonedFailedTxids', () => {
        it('removes old resolved entries', () => {
            // Insert and resolve a txid, then backdate it
            upsertFailedTxid(db, 'tx_old', 'addr1', 'fetch_failed');
            resolveFailedTxid(db, 'tx_old');
            // Backdate to 60 days ago
            const sixtyDaysAgo = Math.floor(Date.now() / 1000) - (60 * 86400);
            db.prepare('UPDATE failed_txids SET last_attempt = ? WHERE txid = ?').run(sixtyDaysAgo, 'tx_old');

            // This one is resolved but recent - should NOT be deleted
            upsertFailedTxid(db, 'tx_recent', 'addr2', 'fetch_failed');
            resolveFailedTxid(db, 'tx_recent');

            // This one is old but unresolved - should NOT be deleted
            upsertFailedTxid(db, 'tx_unresolved', 'addr3', 'fetch_failed');
            db.prepare('UPDATE failed_txids SET last_attempt = ? WHERE txid = ?').run(sixtyDaysAgo, 'tx_unresolved');

            const deleted = clearAbandonedFailedTxids(db, 30);
            expect(deleted).toBe(1);

            const remaining = db.prepare('SELECT COUNT(*) as c FROM failed_txids').get().c;
            expect(remaining).toBe(2);
        });
    });

    describe('isFailedTxid', () => {
        it('returns row for unresolved txid', () => {
            upsertFailedTxid(db, 'tx_1', 'addr1', 'fetch_failed');
            const result = isFailedTxid(db, 'tx_1');
            expect(result).toBeTruthy();
            expect(result.txid).toBe('tx_1');
        });

        it('returns null for resolved txid', () => {
            upsertFailedTxid(db, 'tx_1', 'addr1', 'fetch_failed');
            resolveFailedTxid(db, 'tx_1');
            expect(isFailedTxid(db, 'tx_1')).toBeNull();
        });

        it('returns null for nonexistent txid', () => {
            expect(isFailedTxid(db, 'nonexistent')).toBeNull();
        });
    });
});
