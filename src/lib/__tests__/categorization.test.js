import { describe, it, expect } from 'vitest';
import {
    categorizeImage,
    getCanonicalName,
    getDisplayName,
    groupReposByCanonicalName,
    GAMING_REPOS,
    CRYPTO_REPOS,
    METRIC_COLUMNS
} from '../config.js';

/**
 * Categorisation and grouping rules.
 *
 * Context: the gaming card counted `runonflux/minecraft-server-website` (a companion web
 * frontend) as a game instance, and split Minecraft across its Java and Bedrock images.
 * Between them that inflated the gaming total by 18 instances and produced the label
 * "MINECRAFT SERVER WEBSITE", which overflowed the card.
 */

describe('categorizeImage', () => {
    it('categorises real game servers as gaming', () => {
        expect(categorizeImage('itzg/minecraft-server:latest')).toBe('gaming');
        expect(categorizeImage('thijsvanloef/palworld-server-docker:latest')).toBe('gaming');
        expect(categorizeImage('littlestache/terraria:latest')).toBe('gaming');
        expect(categorizeImage('thmhoag/arkserver:latest')).toBe('gaming');
        expect(categorizeImage('indifferentbroccoli/windrose-server-docker:latest')).toBe('gaming');
    });

    it('excludes companion websites from every category', () => {
        expect(categorizeImage('runonflux/minecraft-server-website:latest')).toBeNull();
        expect(categorizeImage('runonflux/palworld-server-website:latest')).toBeNull();
        expect(categorizeImage('runonflux/rust-server-website:latest')).toBeNull();
        expect(categorizeImage('runonflux/enshrouded-server-website:latest')).toBeNull();
        expect(categorizeImage('runonflux/windrose-server-website:latest')).toBeNull();
    });

    it('still categorises crypto and wordpress', () => {
        expect(categorizeImage('presearch/node:latest')).toBe('crypto');
        expect(categorizeImage('kaspanet/rusty-kaspad:latest')).toBe('crypto');
        expect(categorizeImage('runonflux/wp-nginx:latest')).toBe('wordpress');
    });

    it('leaves unrelated images uncategorised', () => {
        expect(categorizeImage('wirewrex/flux-dns-fdm:CSIAE')).toBeNull();
        expect(categorizeImage('yurinnick/folding-at-home:latest')).toBeNull();
        expect(categorizeImage('mysql:8.3.0')).toBeNull();
    });
});

describe('getCanonicalName', () => {
    it('collapses Minecraft Java and Bedrock into one name', () => {
        expect(getCanonicalName('itzg/minecraft-server:latest')).toBe('Minecraft');
        expect(getCanonicalName('itzg/minecraft-bedrock-server:latest')).toBe('Minecraft');
    });

    it('collapses the Valheim, Enshrouded and Rust variants', () => {
        expect(getCanonicalName('mbround18/valheim:latest')).toBe('Valheim');
        expect(getCanonicalName('lloesche/valheim-server:latest')).toBe('Valheim');
        expect(getCanonicalName('sknnr/enshrouded-dedicated-server:latest')).toBe('Enshrouded');
        expect(getCanonicalName('jktuned/enshrouded-server:latest')).toBe('Enshrouded');
        expect(getCanonicalName('littlestache/rust-server:latest')).toBe('Rust');
        expect(getCanonicalName('pfeiffermax/rust-game-server:latest-oxide')).toBe('Rust');
    });

    it('falls back to the display name for untracked images', () => {
        const image = 'somebody/brand-new-game-server:latest';
        expect(getCanonicalName(image)).toBe(getDisplayName(image));
    });

    it('keeps the per-image display name distinct for Bedrock', () => {
        // Per-image views (history, repo lists) still distinguish the two
        expect(getDisplayName('itzg/minecraft-bedrock-server')).toBe('Minecraft BE');
    });
});

describe('groupReposByCanonicalName', () => {
    it('merges variants and sorts by merged total', () => {
        // Live shape from /api/metrics/category/gaming/top, minus the excluded websites
        const repos = [
            { image_name: 'itzg/minecraft-server', instance_count: 34 },
            { image_name: 'thijsvanloef/palworld-server-docker', instance_count: 266 },
            { image_name: 'itzg/minecraft-bedrock-server', instance_count: 6 },
            { image_name: 'mbround18/valheim', instance_count: 4 },
            { image_name: 'lloesche/valheim-server', instance_count: 1 },
        ];

        const grouped = groupReposByCanonicalName(repos);

        expect(grouped.map(g => [g.displayName, g.instance_count])).toEqual([
            ['Palworld', 266],
            ['Minecraft', 40],
            ['Valheim', 5],
        ]);
    });

    it('records every contributing image so previous-period lookups can sum them', () => {
        const grouped = groupReposByCanonicalName([
            { image_name: 'itzg/minecraft-server', instance_count: 34 },
            { image_name: 'itzg/minecraft-bedrock-server', instance_count: 6 },
        ]);

        expect(grouped[0].images).toEqual([
            'itzg/minecraft-server',
            'itzg/minecraft-bedrock-server'
        ]);
    });

    it('preserves the grand total across grouping', () => {
        const repos = [
            { image_name: 'itzg/minecraft-server', instance_count: 34 },
            { image_name: 'itzg/minecraft-bedrock-server', instance_count: 6 },
            { image_name: 'littlestache/rust-server', instance_count: 2 },
            { image_name: 'pfeiffermax/rust-game-server', instance_count: 2 },
        ];
        const before = repos.reduce((s, r) => s + r.instance_count, 0);
        const after = groupReposByCanonicalName(repos).reduce((s, g) => s + g.instance_count, 0);

        expect(after).toBe(before);
    });

    it('handles an empty category', () => {
        expect(groupReposByCanonicalName([])).toEqual([]);
    });
});

describe('METRIC_COLUMNS', () => {
    it('includes a column for every configured repo', () => {
        // Both adapters used to hardcode this list, so a newly configured game's counts
        // were silently dropped even after schemaMigrator created the column.
        for (const repo of [...GAMING_REPOS, ...CRYPTO_REPOS]) {
            expect(METRIC_COLUMNS).toContain(repo.dbKey);
        }
    });

    it('includes the category totals', () => {
        expect(METRIC_COLUMNS).toContain('gaming_apps_total');
        expect(METRIC_COLUMNS).toContain('crypto_nodes_total');
        expect(METRIC_COLUMNS).toContain('wordpress_count');
    });

    it('has no duplicates', () => {
        expect(new Set(METRIC_COLUMNS).size).toBe(METRIC_COLUMNS.length);
    });
});
