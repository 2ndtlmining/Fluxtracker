import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { categorizeImage, groupReposByCanonicalName } from '../../config.js';

/**
 * Issue #305 — some images are categorised BY THEIR TAG (`ethereum/client-go:stable` is
 * crypto; bare `ethereum/client-go` matches nothing). getTopReposByCategory used to strip the
 * tag before returning, the category route re-validated the tagless name, and the image fell
 * off the card -- the card total then disagreed with the metric card by its instance count.
 *
 * Written through the real SQLite adapter, then re-validated exactly the way the route does.
 */

// The adapter keeps one DB handle per module, so rows persist across tests here -- each test
// writes its own snapshot_date and reads only the latest day.
let dbDir, db;

beforeEach(async () => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'top-repos-tags-'));
    process.env.DB_TYPE = 'sqlite';
    process.env.DB_PATH = path.join(dbDir, 'test.sqlite3');
    db = await import('../adapters/sqliteAdapter.js');
    await db.initDatabase();
});

afterEach(() => {
    try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* windows file lock */ }
});

const row = (image_name, instance_count, snapshot_date = '2026-09-21') => ({
    snapshot_date, image_name, instance_count, category: categorizeImage(image_name)
});

describe('getTopReposByCategory keeps tag-derived categories (issue #305)', () => {
    it('returns full image names, so route re-validation keeps a tag-categorised image', async () => {
        await db.upsertRepoSnapshots([
            row('ethereum/client-go:stable', 10),
            row('presearch/node', 198),
            row('kaspanet/rusty-kaspad:latest', 52)
        ]);

        const { date, repos } = await db.getTopReposByCategory('crypto', 200);
        const valid = repos.filter(r => categorizeImage(r.image_name) === 'crypto');

        expect(date).toBe('2026-09-21');
        expect(valid).toHaveLength(3);
        expect(valid.reduce((s, r) => s + r.instance_count, 0))
            .toBe(await db.getCategoryTotal('crypto', '2026-09-21'));
    });

    it('tags of one image still merge into one card row via canonical grouping', async () => {
        await db.upsertRepoSnapshots([
            row('kaspanet/rusty-kaspad:latest', 40, '2026-09-22'),
            row('kaspanet/rusty-kaspad:v1.0', 12, '2026-09-22')
        ]);

        const { repos } = await db.getTopReposByCategory('crypto', 200);
        const grouped = groupReposByCanonicalName(repos);

        expect(grouped).toHaveLength(1);
        expect(grouped[0].instance_count).toBe(52);
        expect(grouped[0].images).toHaveLength(2);
    });
});
