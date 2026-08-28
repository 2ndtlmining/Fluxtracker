import { describe, it, expect } from 'vitest';
import {
    categorizeImage,
    getCanonicalName,
    getDisplayName,
    groupReposByCanonicalName,
    GAMING_REPOS,
    CRYPTO_REPOS,
    CANONICAL_NAME_OVERRIDES,
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

    it('excludes a monitoring sidecar that names the watched app in its tag', () => {
        // flux-dns-fdm runs one instance per app it watches. categorizeImage() matches the
        // whole image string including the tag, so `:minecraft-ping` counted as a game
        // server (47 phantom instances on 2025-11-17) and `:wordpress` as a WordPress site.
        expect(categorizeImage('wirewrex/flux-dns-fdm:minecraft-ping')).toBeNull();
        expect(categorizeImage('wirewrex/flux-dns-fdm:wordpress')).toBeNull();
        expect(categorizeImage('wirewrex/flux-dns-fdm:CSIAE')).toBeNull();

        // ...without touching the real thing it was shadowing
        expect(categorizeImage('itzg/minecraft-server:latest')).toBe('gaming');
    });

    it('still categorises crypto and wordpress', () => {
        expect(categorizeImage('presearch/node:latest')).toBe('crypto');
        expect(categorizeImage('kaspanet/rusty-kaspad:latest')).toBe('crypto');
        expect(categorizeImage('runonflux/wp-nginx:latest')).toBe('wordpress');
    });

    it('categorises Beldex masternodes published under an opaque image name', () => {
        // ghcr.io/girderworks/{edge,feather} carry no chain identifier, so the existing
        // 'beldex' keyword never matched them and 892 containers — the single biggest
        // crypto deployment on the network — fell through to uncategorised (issue #74).
        expect(categorizeImage('ghcr.io/girderworks/edge:1.0.13')).toBe('crypto');
        expect(categorizeImage('ghcr.io/girderworks/edge:1.0.14')).toBe('crypto');
        expect(categorizeImage('ghcr.io/girderworks/feather:1.0.13')).toBe('crypto');
        expect(categorizeImage('ghcr.io/girderworks/feather:1.0.14')).toBe('crypto');
    });

    it('categorises chain indexers, explorers and nodes missed by the keyword list', () => {
        // Issue #74 Group A: infrastructure for a named chain whose image name misses
        // every existing keyword. Blockbook alone is 124 containers.
        expect(categorizeImage('runonflux/blockbook-docker:latest')).toBe('crypto');
        expect(categorizeImage('runonflux/blockbook-docker:ubuntu')).toBe('crypto');
        expect(categorizeImage('runonflux/explorer:latest')).toBe('crypto');
        expect(categorizeImage('zelcash/dibi-fetch:latest')).toBe('crypto');
        expect(categorizeImage('bitgert/brise-node-flux:latest')).toBe('crypto');
        expect(categorizeImage('fusenet/node:latest')).toBe('crypto');
        expect(categorizeImage('runonflux/raven-insight-explorer:latest')).toBe('crypto');
        expect(categorizeImage('runonflux/dash-insight-explorer:latest')).toBe('crypto');
        expect(categorizeImage('runonflux/fusionbalances:latest')).toBe('crypto');
        expect(categorizeImage('steemfans/authsteem:latest')).toBe('crypto');
    });

    it('does not sweep in the platform and dApp images left out of Group A', () => {
        // Deliberate scope line: FluxOS/Titan/fluxcloud are Flux platform containers,
        // not nodes for a chain; IPFS and Nostr hold no chain state; beam105 is a miner.
        expect(categorizeImage('runonflux/fluxos:latest')).toBeNull();
        expect(categorizeImage('runonflux/titan:latest')).toBeNull();
        expect(categorizeImage('runonflux/fluxcloud:latest')).toBeNull();
        expect(categorizeImage('runonflux/ipfs:latest')).toBeNull();
        expect(categorizeImage('wirewrex/nostr-rs-relay:latest')).toBeNull();
        expect(categorizeImage('patpi93/beam105-worker:0.2.1-cloud7')).toBeNull();
        expect(categorizeImage('smartico/aave:latest')).toBeNull();
        expect(categorizeImage('piwnik/themok:latest')).toBeNull();
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

    it('gives every Group A image a label that names its chain or service', () => {
        // Without overrides these render as "Node", "Explorer", "Authsteem",
        // "Fusionbalances" and "Raven Insight Explorer" on the crypto card.
        expect(getDisplayName('fusenet/node:latest')).toBe('Fuse');
        expect(getDisplayName('runonflux/explorer:latest')).toBe('Flux Explorer');
        expect(getDisplayName('runonflux/blockbook-docker:latest')).toBe('Flux Blockbook');
        expect(getDisplayName('bitgert/brise-node-flux:latest')).toBe('Bitgert');
        expect(getDisplayName('steemfans/authsteem:latest')).toBe('Steem Auth');
        expect(getDisplayName('runonflux/fusionbalances:latest')).toBe('Fusion Balances');
        expect(getDisplayName('runonflux/raven-insight-explorer:latest')).toBe('Ravencoin Explorer');
        expect(getDisplayName('runonflux/dash-insight-explorer:latest')).toBe('Dash Explorer');
        expect(getDisplayName('zelcash/dibi-fetch:latest')).toBe('DiBi Fetch');
    });

    it('keeps a chain explorer separate from the node for that chain', () => {
        // Ravencoin has both; merging them would hide which is which.
        expect(getCanonicalName('dramirezrt/ravencoin-core-server:latest')).toBe('Ravencoin');
        expect(getCanonicalName('runonflux/raven-insight-explorer:latest')).toBe('Ravencoin Explorer');
    });

    it('collapses the two Beldex masternode images into one name', () => {
        // Without this the crypto card renders "Edge" and "Feather" as separate rows —
        // getDisplayName() takes the last path segment, which names neither the chain
        // nor anything a reader would recognise.
        expect(getCanonicalName('ghcr.io/girderworks/edge:1.0.14')).toBe('Beldex');
        expect(getCanonicalName('ghcr.io/girderworks/feather:1.0.14')).toBe('Beldex');
        expect(getCanonicalName('beldex/beldex-master-node:latest')).toBe('Beldex');
    });

    it('keeps the two Beldex variants distinct per image', () => {
        expect(getDisplayName('ghcr.io/girderworks/edge:1.0.14')).toBe('Beldex Edge');
        expect(getDisplayName('ghcr.io/girderworks/feather:1.0.14')).toBe('Beldex Feather');
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

    it('merges the Beldex variants into a single crypto row', () => {
        const grouped = groupReposByCanonicalName([
            { image_name: 'ghcr.io/girderworks/feather', instance_count: 564 },
            { image_name: 'ghcr.io/girderworks/edge', instance_count: 328 },
            { image_name: 'presearch/node', instance_count: 100 },
        ]);

        expect(grouped.map(g => [g.displayName, g.instance_count])).toEqual([
            ['Beldex', 892],
            ['Presearch', 100],
        ]);
    });

    it('handles an empty category', () => {
        expect(groupReposByCanonicalName([])).toEqual([]);
    });
});

describe('GAMING_REPOS image coverage', () => {
    it('has a featured column for every image that merges into a tracked game', () => {
        // Any image whose canonical name matches a configured repo must be in that repo's
        // imageMatch, or the metric card and the category card disagree.
        const tracked = new Map(GAMING_REPOS.map(r => [r.name, r.imageMatch]));
        for (const [image, canonical] of Object.entries(CANONICAL_NAME_OVERRIDES)) {
            if (!tracked.has(canonical)) continue;
            expect(tracked.get(canonical)).toContain(image);
        }
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
