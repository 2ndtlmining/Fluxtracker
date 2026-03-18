import dotenv from 'dotenv';
// Only load .env files if env vars aren't already set (e.g. via Docker -e)
if (!process.env.SUPABASE_URL) {
    dotenv.config({ path: '.env.local' });
    dotenv.config();
}

import { createClient } from '@supabase/supabase-js';

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
const failoverClient = (failoverUrl && failoverKey)
    ? createClient(failoverUrl, failoverKey, clientOpts)
    : null;

if (failoverClient) {
    console.log(`Failover URL: ${failoverUrl}`);
    console.log('Failover key: PRESENT');
} else {
    console.log('Failover instance: NOT CONFIGURED');
}

// ============================================
// ACTIVE INSTANCE ROUTING (Proxy)
// ============================================
let activeInstance = 'primary';

/**
 * Proxy routes all property access to the currently-active Supabase client.
 * Existing code using `supabase.from(...)` works transparently.
 */
export const supabase = new Proxy({}, {
    get(_target, prop) {
        const client = activeInstance === 'primary' ? primaryClient : failoverClient || primaryClient;
        const value = client[prop];
        return typeof value === 'function' ? value.bind(client) : value;
    }
});

export function switchToFailover() {
    if (!failoverClient) {
        return { success: false, reason: 'No failover instance configured' };
    }
    const previous = activeInstance;
    activeInstance = activeInstance === 'primary' ? 'failover' : 'primary';
    console.log(`🔀 Supabase switched: ${previous} → ${activeInstance}`);
    return { success: true, previous, active: activeInstance };
}

export function getActiveInstanceName() {
    return activeInstance;
}

export function hasFailover() {
    return !!failoverClient;
}
