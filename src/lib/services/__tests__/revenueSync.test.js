import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

/**
 * Tests for the retry-failed-txids logic and audit queuing.
 *
 * These tests validate the DB-backed failed txid lifecycle and the
 * retry logic patterns used in progressiveSync and auditRecentTransactions.
 * We test against an in-memory SQLite DB to avoid side effects.
 */

let db;

// ---- Replicate DB layer (same SQL as database.js) ----
function setup(db) {
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

        CREATE TABLE IF NOT EXISTS revenue_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            txid TEXT NOT NULL UNIQUE,
            address TEXT NOT NULL,
            from_address TEXT DEFAULT 'Unknown',
            amount REAL NOT NULL,
            amount_usd REAL,
            block_height INTEGER NOT NULL,
            timestamp INTEGER NOT NULL,
            date DATE NOT NULL,
            app_name TEXT DEFAULT NULL,
            app_type TEXT DEFAULT NULL
        );
    `);
}

function upsertFailedTxid(db, txid, address, reason = 'fetch_failed') {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
        INSERT INTO failed_txids (txid, address, failure_reason, attempt_count, first_seen, last_attempt, resolved)
        VALUES (?, ?, ?, 1, ?, ?, 0)
        ON CONFLICT(txid) DO UPDATE SET
            attempt_count = attempt_count + 1,
            last_attempt = ?,
            failure_reason = ?,
            resolved = 0
    `).run(txid, address, reason, now, now, now, reason);
}

function getUnresolvedFailedTxids(db, limit = 200) {
    return db.prepare(`
        SELECT txid, address, failure_reason, attempt_count, first_seen, last_attempt
        FROM failed_txids WHERE resolved = 0
        ORDER BY attempt_count ASC, last_attempt ASC LIMIT ?
    `).all(limit);
}

function resolveFailedTxid(db, txid) {
    db.prepare('UPDATE failed_txids SET resolved = 1 WHERE txid = ?').run(txid);
}

function getFailedTxidCount(db) {
    return db.prepare('SELECT COUNT(*) as count FROM failed_txids WHERE resolved = 0').get().count;
}

function getAllTxids(db) {
    return db.prepare('SELECT txid FROM revenue_transactions').all().map(r => r.txid);
}

function insertTx(db, txid, address = 'addr1', amount = 1.0) {
    db.prepare(`
        INSERT OR IGNORE INTO revenue_transactions (txid, address, amount, block_height, timestamp, date)
        VALUES (?, ?, ?, 100, 1000000, '2026-03-15')
    `).run(txid, address, amount);
}

// ---- Tests ----

describe('Revenue sync retry logic', () => {
    beforeEach(() => {
        db = new Database(':memory:');
        setup(db);
    });

    describe('Failed txid lifecycle', () => {
        it('failed txids persist and are available for retry across restarts', () => {
            upsertFailedTxid(db, 'tx_A', 'addr1', 'fetch_failed');

            const failedList = getUnresolvedFailedTxids(db);
            expect(failedList.length).toBe(1);
            expect(failedList[0].txid).toBe('tx_A');
        });

        it('retrying a failed txid resolves it when successful', () => {
            upsertFailedTxid(db, 'tx_A', 'addr1', 'fetch_failed');
            expect(getFailedTxidCount(db)).toBe(1);

            insertTx(db, 'tx_A');
            resolveFailedTxid(db, 'tx_A');

            expect(getFailedTxidCount(db)).toBe(0);
            expect(getAllTxids(db)).toContain('tx_A');
        });

        it('retrying a still-failing txid increments attempt count', () => {
            upsertFailedTxid(db, 'tx_A', 'addr1', 'fetch_failed');
            upsertFailedTxid(db, 'tx_A', 'addr1', 'fetch_failed');
            upsertFailedTxid(db, 'tx_A', 'addr1', 'fetch_failed');

            const row = db.prepare('SELECT * FROM failed_txids WHERE txid = ?').get('tx_A');
            expect(row.attempt_count).toBe(3);
            expect(row.resolved).toBe(0);
        });
    });

    describe('Retry phase integration pattern', () => {
        it('retry phase processes failed txids not in current scan range', () => {
            // Simulate: tx_A and tx_B failed during previous syncs
            upsertFailedTxid(db, 'tx_A', 'addr1', 'fetch_failed');
            upsertFailedTxid(db, 'tx_B', 'addr2', 'timeout');

            const existingTxids = new Set(getAllTxids(db));
            const failedList = getUnresolvedFailedTxids(db);
            expect(failedList.length).toBe(2);

            // Simulate: tx_A fetch succeeds, tx_B still fails
            const mockFetchResults = { tx_A: { txid: 'tx_A', confirmations: 10 }, tx_B: null };

            for (const failed of failedList) {
                const fetchResult = mockFetchResults[failed.txid];
                if (!fetchResult) {
                    upsertFailedTxid(db, failed.txid, failed.address, 'fetch_failed');
                    continue;
                }
                if (fetchResult.confirmations < 8) continue;
                if (existingTxids.has(failed.txid)) {
                    resolveFailedTxid(db, failed.txid);
                    continue;
                }
                insertTx(db, failed.txid, failed.address);
                resolveFailedTxid(db, failed.txid);
            }

            // tx_A recovered, tx_B still failed with incremented count
            expect(getFailedTxidCount(db)).toBe(1);
            expect(getAllTxids(db)).toContain('tx_A');

            const txB = db.prepare('SELECT * FROM failed_txids WHERE txid = ?').get('tx_B');
            expect(txB.attempt_count).toBe(2);
            expect(txB.resolved).toBe(0);
        });

        it('already-recovered txids are resolved without re-insert', () => {
            upsertFailedTxid(db, 'tx_A', 'addr1', 'fetch_failed');

            // tx_A was recovered by the audit in the meantime
            insertTx(db, 'tx_A');

            const existingTxids = new Set(getAllTxids(db));
            const failedList = getUnresolvedFailedTxids(db);

            for (const failed of failedList) {
                if (existingTxids.has(failed.txid)) {
                    resolveFailedTxid(db, failed.txid);
                    continue;
                }
            }

            expect(getFailedTxidCount(db)).toBe(0);
            const count = db.prepare('SELECT COUNT(*) as c FROM revenue_transactions WHERE txid = ?').get('tx_A').c;
            expect(count).toBe(1);
        });
    });

    describe('Cursor advancement safety', () => {
        it('failed txids do not block cursor advancement (recovered via retry phase)', () => {
            const txidsInRange = ['tx_ok1', 'tx_fail', 'tx_ok2'];
            const existingTxids = new Set(getAllTxids(db));

            for (const txid of txidsInRange) {
                if (existingTxids.has(txid)) continue;
                const fetchSuccess = txid !== 'tx_fail';
                if (!fetchSuccess) {
                    upsertFailedTxid(db, txid, 'addr1', 'fetch_failed');
                } else {
                    insertTx(db, txid);
                    resolveFailedTxid(db, txid);
                }
            }

            expect(getAllTxids(db).length).toBe(2);
            expect(getFailedTxidCount(db)).toBe(1);

            // Next cycle: retry phase recovers tx_fail
            const failedList = getUnresolvedFailedTxids(db);
            expect(failedList[0].txid).toBe('tx_fail');

            insertTx(db, 'tx_fail');
            resolveFailedTxid(db, 'tx_fail');

            expect(getAllTxids(db).length).toBe(3);
            expect(getFailedTxidCount(db)).toBe(0);
        });
    });
});

describe('Audit queuing logic', () => {
    it('audit queuing state machine works correctly', () => {
        // Simulate the scheduler's audit queuing behavior
        let isRunning = false;
        let auditPending = false;
        let auditRanCount = 0;

        function runAudit() {
            if (isRunning) {
                auditPending = true;
                return;
            }
            isRunning = true;
            auditRanCount++;
            isRunning = false;
        }

        function runSync() {
            isRunning = true;
            // Sync is running, audit fires during this time
            runAudit();
            expect(auditPending).toBe(true);
            isRunning = false;

            // After sync completes, check for queued audit
            if (auditPending) {
                auditPending = false;
                runAudit();
            }
        }

        runSync();
        // Audit should have run once (the queued one after sync)
        expect(auditRanCount).toBe(1);
        expect(auditPending).toBe(false);
    });

    it('audit runs normally when sync is not running', () => {
        let isRunning = false;
        let auditPending = false;
        let auditRanCount = 0;

        function runAudit() {
            if (isRunning) {
                auditPending = true;
                return;
            }
            isRunning = true;
            auditRanCount++;
            isRunning = false;
        }

        runAudit();
        expect(auditRanCount).toBe(1);
        expect(auditPending).toBe(false);
    });
});
