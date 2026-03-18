import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read source files as plain text — we CANNOT import them because they have
// side effects (Supabase connections, env var reads, SQLite file creation).
const sqliteSrc = fs.readFileSync(
    path.resolve(__dirname, '../adapters/sqliteAdapter.js'),
    'utf-8',
);
const supabaseSrc = fs.readFileSync(
    path.resolve(__dirname, '../adapters/supabaseAdapter.js'),
    'utf-8',
);
const routerSrc = fs.readFileSync(
    path.resolve(__dirname, '../database.js'),
    'utf-8',
);

/**
 * Extract exported function names from adapter source code.
 * Matches both `export function foo()` and `export async function foo()`.
 */
function extractExportedFunctions(source) {
    const regex = /^export\s+(?:async\s+)?function\s+(\w+)/gm;
    const names = [];
    let match;
    while ((match = regex.exec(source)) !== null) {
        names.push(match[1]);
    }
    return names.sort();
}

/**
 * Extract the destructured names from the `export const { ... } = adapter;`
 * block in database.js.
 */
function extractRouterExports(source) {
    // Match the entire `export const { ... } = adapter;` block (may span many lines)
    const blockMatch = source.match(/export\s+const\s+\{([\s\S]*?)\}\s*=\s*adapter\s*;/);
    if (!blockMatch) return [];

    const block = blockMatch[1];
    // Pull out bare identifiers, ignoring comments and whitespace
    const names = [];
    for (const token of block.split(',')) {
        const cleaned = token.replace(/\/\/.*$/gm, '').trim();
        if (cleaned && /^[a-zA-Z_$]\w*$/.test(cleaned)) {
            names.push(cleaned);
        }
    }
    return names.sort();
}

const sqliteFns = extractExportedFunctions(sqliteSrc);
const supabaseFns = extractExportedFunctions(supabaseSrc);
const routerFns = extractRouterExports(routerSrc);

describe('Adapter contract', () => {
    it('both adapters export the same function names', () => {
        expect(sqliteFns).toEqual(supabaseFns);
    });

    it('SQLite adapter exports exactly 71 functions', () => {
        expect(sqliteFns).toHaveLength(71);
    });

    it('Supabase adapter exports exactly 71 functions', () => {
        expect(supabaseFns).toHaveLength(71);
    });

    it('no adapter has extra functions the other lacks', () => {
        const onlyInSqlite = sqliteFns.filter((fn) => !supabaseFns.includes(fn));
        const onlyInSupabase = supabaseFns.filter((fn) => !sqliteFns.includes(fn));

        expect(onlyInSqlite).toEqual([]);
        expect(onlyInSupabase).toEqual([]);
    });
});

describe('database.js router', () => {
    it('re-exports every adapter function', () => {
        const missingFromRouter = sqliteFns.filter((fn) => !routerFns.includes(fn));
        expect(missingFromRouter).toEqual([]);
    });

    it('does not re-export names that are not in the adapters', () => {
        const extraInRouter = routerFns.filter((fn) => !sqliteFns.includes(fn));
        expect(extraInRouter).toEqual([]);
    });

    it('re-exports exactly 71 functions', () => {
        expect(routerFns).toHaveLength(71);
    });
});
