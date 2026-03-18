import dotenv from 'dotenv';
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
let _failoverClient = null;

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

export function switchToFailover() {
    if (isSqlite || !_failoverClient) {
        return { success: false, reason: isSqlite ? 'SQLite mode' : 'No failover instance configured' };
    }
    const previous = _activeInstance;
    _activeInstance = _activeInstance === 'primary' ? 'failover' : 'primary';
    console.log(`🔀 Supabase switched: ${previous} → ${_activeInstance}`);
    return { success: true, previous, active: _activeInstance };
}

export function getActiveInstanceName() {
    return _activeInstance;
}

export function hasFailover() {
    return !!_failoverClient;
}
