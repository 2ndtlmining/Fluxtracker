import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
// Only load .env files if env vars aren't already set (e.g. via Docker -e)
if (!process.env.SUPABASE_URL) {
    dotenv.config({ path: '.env.local' });
    dotenv.config();
}

// ============================================
// SQLite MODE GUARD — no Supabase client needed
// ============================================
const dbType = (process.env.DB_TYPE || 'supabase').toLowerCase();
const isSqlite = dbType === 'sqlite';

let _supabase = null;
let _activeInstance = isSqlite ? 'sqlite' : 'primary';
let _activeSince = Date.now();
let _failoverClient = null;

// Which instance is live survives a restart (issue #308). It used to be memory only, so a
// restart during a failover silently went back to the primary -- and everything written to
// the failover in the meantime (snapshots, transactions, receipts) stayed there, unmerged,
// while the primary had a gap. Best effort: an unwritable path just means no persistence.
const ACTIVE_STATE_FILE = process.env.FAILOVER_STATE_FILE || path.join(process.cwd(), 'data', 'supabase-active.json');

function readActiveState() {
    try {
        return JSON.parse(fs.readFileSync(ACTIVE_STATE_FILE, 'utf8'));
    } catch {
        return null;
    }
}

function writeActiveState() {
    try {
        fs.mkdirSync(path.dirname(ACTIVE_STATE_FILE), { recursive: true });
        fs.writeFileSync(ACTIVE_STATE_FILE, JSON.stringify({ active: _activeInstance, since: _activeSince }));
    } catch (error) {
        console.warn(`Could not persist the active Supabase instance: ${error.message}`);
    }
}

if (!isSqlite) {
    const { createClient } = await import('@supabase/supabase-js');

    // Strip whitespace, BOM, and any non-ASCII invisible characters
    const clean = (s) => s?.replace(/[^\x20-\x7E]/g, '').trim();

    // ============================================
    // PRIMARY INSTANCE (required)
    // ============================================
    const primaryUrl = clean(process.env.SUPABASE_URL);
    const primaryKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);

    console.log(`Supabase URL: ${primaryUrl}`);
    console.log(`Service key: ${primaryKey ? 'PRESENT' : 'MISSING'}`);

    if (!primaryUrl || !primaryKey) {
        throw new Error(
            'Missing Supabase environment variables. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
        );
    }

    const clientOpts = { auth: { autoRefreshToken: false, persistSession: false } };
    const primaryClient = createClient(primaryUrl, primaryKey, clientOpts);

    // ============================================
    // FAILOVER INSTANCE (optional)
    // ============================================
    const failoverUrl = clean(process.env.SUPABASE_FAILOVER_URL);
    const failoverKey = clean(process.env.SUPABASE_FAILOVER_KEY);
    _failoverClient = (failoverUrl && failoverKey)
        ? createClient(failoverUrl, failoverKey, clientOpts)
        : null;

    if (_failoverClient) {
        console.log(`Failover URL: ${failoverUrl}`);
        console.log('Failover key: PRESENT');
        const saved = readActiveState();
        if (saved?.active === 'failover') {
            _activeInstance = 'failover';
            _activeSince = Number(saved.since) || Date.now();
            console.warn('⚠️  Resuming on the FAILOVER Supabase instance (switched ' +
                new Date(_activeSince).toISOString() + '). Data written since then is on the failover; ' +
                'reconcile it before POST /api/admin/failover switches back to the primary.');
        }
    } else {
        console.log('Failover instance: NOT CONFIGURED');
    }

    // ============================================
    // ACTIVE INSTANCE ROUTING (Proxy)
    // ============================================
    _supabase = new Proxy({}, {
        get(_target, prop) {
            const client = _activeInstance === 'primary' ? primaryClient : _failoverClient || primaryClient;
            const value = client[prop];
            return typeof value === 'function' ? value.bind(client) : value;
        }
    });
} else {
    console.log('DB_TYPE=sqlite — Supabase client disabled');
}

export const supabase = _supabase;

/**
 * Make `target` ('primary' | 'failover') the live instance. Explicit, never a toggle: the
 * automatic path must only ever move primary -> failover (issue #308).
 */
export function switchTo(target) {
    if (isSqlite || !_failoverClient) {
        return { success: false, reason: isSqlite ? 'SQLite mode' : 'No failover instance configured' };
    }
    if (target !== 'primary' && target !== 'failover') {
        return { success: false, reason: `Unknown instance: ${target}` };
    }
    const previous = _activeInstance;
    if (previous === target) return { success: true, previous, active: target, changed: false };
    _activeInstance = target;
    _activeSince = Date.now();
    writeActiveState();
    console.log(`🔀 Supabase switched: ${previous} → ${_activeInstance}`);
    return { success: true, previous, active: _activeInstance, changed: true };
}

/** Manual admin switch (POST /api/admin/failover): flips to the other instance. */
export function switchToFailover() {
    return switchTo(_activeInstance === 'primary' ? 'failover' : 'primary');
}

export function getActiveInstanceName() {
    return _activeInstance;
}

/** When the current instance became live (ms). */
export function getActiveInstanceSince() {
    return _activeSince;
}

export function hasFailover() {
    return !!_failoverClient;
}
