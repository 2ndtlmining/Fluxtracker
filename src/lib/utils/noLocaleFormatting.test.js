import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Issue #443: numbers on screen go through $lib/utils/format.js (fixed en-US). A bare
 * toLocaleString() follows the visitor's locale, so a de-DE browser showed "7.109 of 9.176"
 * beside "23,838" on the same screen (#323 fixed the hero cards; nine calls remained).
 */

function svelteFiles(dir) {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return svelteFiles(path);
        return path.endsWith('.svelte') ? [path] : [];
    });
}

describe('no locale-dependent number formatting in components (issue #443)', () => {
    it('has no toLocaleString() without an explicit en-US locale', () => {
        const offenders = [];
        for (const file of [...svelteFiles('src/lib/components'), ...svelteFiles('src/routes')]) {
            readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
                if (line.trim().startsWith('//')) return;          // comments explaining the rule
                if (/\.toLocaleString\(\s*\)/.test(line)) offenders.push(`${file}:${i + 1}`);
            });
        }
        expect(offenders).toEqual([]);
    });
});
