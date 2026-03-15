import dotenv from 'dotenv';
// Only load .env files if env vars aren't already set (e.g. via Docker -e)
if (!process.env.SUPABASE_URL) {
    dotenv.config({ path: '.env.local' });
    dotenv.config();
}

import { createClient } from '@supabase/supabase-js';

// Strip whitespace, BOM, and any non-ASCII invisible characters
const clean = (s) => s?.replace(/[^\x20-\x7E]/g, '').trim();
const supabaseUrl = clean(process.env.SUPABASE_URL);
const supabaseServiceKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log(`Supabase URL: ${supabaseUrl}`);
console.log(`Service key: ${supabaseServiceKey ? 'PRESENT' : 'MISSING'}`);

if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
        'Missing Supabase environment variables. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});
