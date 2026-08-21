import { describe, it, expect } from 'vitest';
import { buildDiscordPayload, isValidDiscordWebhook } from '../discord.js';
import { buildKpiDataset } from '../metrics.js';

describe('isValidDiscordWebhook — SSRF guard', () => {
    it('accepts real Discord webhook URLs', () => {
        for (const url of [
            'https://discord.com/api/webhooks/123456789/abcDEF-_123',
            'https://discordapp.com/api/webhooks/987654321/tokenTOKEN',
            'https://canary.discord.com/api/webhooks/1/aa',
            'https://ptb.discord.com/api/webhooks/1/aa'
        ]) {
            expect(isValidDiscordWebhook(url), url).toBe(true);
        }
    });

    it('rejects any non-Discord host — this endpoint must not become an open relay', () => {
        for (const url of [
            'https://evil.com/api/webhooks/123/abc',
            'https://discord.com.evil.com/api/webhooks/123/abc',
            'http://discord.com/api/webhooks/123/abc',          // plain http
            'https://discord.com/api/webhooks/123/abc@evil.com',
            'https://mydiscord.com/api/webhooks/123/abc',
            'http://169.254.169.254/latest/meta-data/',          // cloud metadata
            'https://discord.com/api/channels/123/messages'      // Discord, but not a webhook
        ]) {
            expect(isValidDiscordWebhook(url), url).toBe(false);
        }
    });

    it('rejects malformed input without throwing', () => {
        for (const value of [null, undefined, '', '   ', 42, {}, [], 'https://discord.com/api/webhooks/']) {
            expect(isValidDiscordWebhook(value)).toBe(false);
        }
    });

    it('rejects an absurdly long URL', () => {
        expect(isValidDiscordWebhook('https://discord.com/api/webhooks/1/' + 'a'.repeat(600))).toBe(false);
    });
});

describe('buildDiscordPayload', () => {
    const current = { start: '2026-08-10', end: '2026-08-16' };
    const comparison = { start: '2026-08-03', end: '2026-08-09' };

    const snapshots = (overrides = {}) => Array.from({ length: 7 }, (_, i) => ({
        snapshot_date: `2026-08-${String(10 + i).padStart(2, '0')}`,
        node_total: 6000, node_cumulus: 2800, node_nimbus: 1500, node_stratus: 1700,
        used_cpu_cores: 8800, used_ram_gb: 17, used_storage_gb: 250,
        total_apps: 6400, dockerapps_count: 6200, gitapps_count: 170, gaming_apps_total: 320,
        ...overrides
    }));

    function report(overrides = {}) {
        const dataset = buildKpiDataset({
            current, comparison,
            currentSnapshots: snapshots(),
            comparisonSnapshots: snapshots({ node_total: 5800 }),
            currentRevenue: { flux: 1400, usd: 60 },
            comparisonRevenue: { flux: 700, usd: 30 },
            ...overrides
        });
        return {
            timeframe: 'weekly',
            current,
            comparison,
            dataset,
            generatedAt: '2026-08-21T00:00:00.000Z'
        };
    }

    it('builds one embed with a field per section', () => {
        const payload = buildDiscordPayload(report());
        const embed = payload.embeds[0];

        expect(payload.embeds).toHaveLength(1);
        expect(embed.title).toBe('FluxTracker KPI Report - Weekly');
        expect(embed.fields.map(f => f.name)).toEqual([
            'Revenue (sum over period)',
            'Nodes (daily average)',
            'Resource Utilization (daily average)',
            'Applications (daily average)'
        ]);
        expect(embed.footer.text).toBe('via FluxTracker');
        expect(embed.timestamp).toBe('2026-08-21T00:00:00.000Z');
    });

    it('names both periods in the description', () => {
        const embed = buildDiscordPayload(report()).embeds[0];
        expect(embed.description).toContain('Aug 10-16, 2026');
        expect(embed.description).toContain('Aug 3-9, 2026');
    });

    it('wraps each section in a code block so columns stay aligned on mobile', () => {
        const embed = buildDiscordPayload(report()).embeds[0];
        for (const field of embed.fields.slice(0, 4)) {
            expect(field.value.startsWith('```')).toBe(true);
            expect(field.value.endsWith('```')).toBe(true);
        }
    });

    it('keeps every table row the same width', () => {
        const embed = buildDiscordPayload(report()).embeds[0];
        const lines = embed.fields[1].value.split('\n').filter(l => l && !l.startsWith('```'));
        const widths = new Set(lines.map(l => l.length));
        expect(widths.size).toBe(1);
    });

    it('contains no emoji anywhere', () => {
        const json = JSON.stringify(buildDiscordPayload(report()));
        expect(/\p{Extended_Pictographic}/u.test(json)).toBe(false);
    });

    it('signs the deltas rather than using arrows', () => {
        const embed = buildDiscordPayload(report()).embeds[0];
        const revenue = embed.fields[0].value;
        expect(revenue).toContain('+100.0%');
        expect(revenue).not.toMatch(/[↑↓▲▼]/);
    });

    it('adds a note when some metrics lack history', () => {
        const embed = buildDiscordPayload(report({
            comparisonSnapshots: snapshots({ gitapps_count: 0, dockerapps_count: 0 })
        })).embeds[0];

        const note = embed.fields.find(f => f.name === 'Note');
        expect(note).toBeDefined();
        expect(note.value).toContain('2 metric(s)');
        expect(embed.fields[3].value).toContain('Insufficient data');
    });

    it('omits the note when everything is complete', () => {
        const embed = buildDiscordPayload(report()).embeds[0];
        expect(embed.fields.find(f => f.name === 'Note')).toBeUndefined();
    });

    it('stays inside Discord field and embed limits', () => {
        const embed = buildDiscordPayload(report()).embeds[0];
        for (const field of embed.fields) {
            expect(field.value.length).toBeLessThanOrEqual(1024);
        }
        expect(JSON.stringify(embed).length).toBeLessThan(6000);
    });
});
