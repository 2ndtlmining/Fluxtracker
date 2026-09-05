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
        cpu_utilization_percent: 42.5, ram_utilization_percent: 38.1, storage_utilization_percent: 29.7,
        flux_price_usd: 0.4213,
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
            'Revenue - SUM',
            'Nodes - AVERAGE',
            'Resource Utilization - AVERAGE',
            'Applications - AVERAGE',
            'Data coverage'
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
            expect(field.value).toContain('```');
            expect(field.value.endsWith('```')).toBe(true);
        }
    });

    it('states the aggregation method in the field name and above the table', () => {
        const embed = buildDiscordPayload(report()).embeds[0];
        expect(embed.fields[0].name).toBe('Revenue - SUM');
        expect(embed.fields[0].value).toContain('SUM of all days in the period');
        expect(embed.fields[1].name).toBe('Nodes - AVERAGE');
        expect(embed.fields[1].value).toContain('AVERAGE of the daily values across the period');
    });

    it('keeps every table row the same width', () => {
        const embed = buildDiscordPayload(report()).embeds[0];
        // Only the fenced block — the prose line above it is deliberately not padded
        const block = embed.fields[1].value.split('```')[1];
        const lines = block.split('\n').filter(Boolean);
        expect(lines.length).toBeGreaterThan(1);
        expect(new Set(lines.map(l => l.length)).size).toBe(1);
    });

    it('contains no emoji anywhere', () => {
        const json = JSON.stringify(buildDiscordPayload(report()));
        expect(/\p{Extended_Pictographic}/u.test(json)).toBe(false);
    });

    it('signs the deltas rather than using arrows', () => {        const embed = buildDiscordPayload(report()).embeds[0];
        const revenue = embed.fields[0].value;
        expect(revenue).toContain('+100.0%');
        expect(revenue).not.toMatch(/[↑↓▲▼]/);
    });

    it('says how many days are missing rather than only "no data"', () => {
        const embed = buildDiscordPayload(report({
            comparisonSnapshots: snapshots({ gitapps_count: 0, dockerapps_count: 0 })
        })).embeds[0];

        const coverage = embed.fields.find(f => f.name === 'Data coverage');
        expect(coverage.value).toContain('2 of 21 metrics are not reported');
        expect(embed.fields[3].value).toContain('Insufficient data (7 days missing)');
    });

    it('confirms complete coverage when nothing is missing', () => {
        const embed = buildDiscordPayload(report()).embeds[0];
        const coverage = embed.fields.find(f => f.name === 'Data coverage');
        expect(coverage.value).toContain('Complete.');
    });

    it('discloses the averaged price row inside the summed revenue section', () => {
        const embed = buildDiscordPayload(report()).embeds[0];
        const revenue = embed.fields[0];

        // The heading still says SUM, so the exception has to be named or the price row
        // reads as a total of every daily price.
        expect(revenue.name).toBe('Revenue - SUM');
        expect(revenue.value).toContain('Except FLUX price (avg)');
        expect(revenue.value).toContain('AVERAGE of the daily values across the period');
        expect(revenue.value).toContain('$0.4213');
    });

    it('leaves single-aggregation sections without an exception note', () => {
        const embed = buildDiscordPayload(report()).embeds[0];
        expect(embed.fields[1].value).not.toContain('Except');
    });

    it('renders utilization deltas in percentage points', () => {
        const embed = buildDiscordPayload(report({
            comparisonSnapshots: snapshots({ cpu_utilization_percent: 40.0 })
        })).embeds[0];

        expect(embed.fields[2].value).toContain('+2.5pp');
    });

    it('stays inside Discord field and embed limits', () => {
        const embed = buildDiscordPayload(report()).embeds[0];
        for (const field of embed.fields) {
            expect(field.value.length).toBeLessThanOrEqual(1024);
        }
        expect(JSON.stringify(embed).length).toBeLessThan(6000);
    });

    describe('instant section (apps expiring in 24h)', () => {
        function dailyReport(instant) {
            const dataset = buildKpiDataset({
                current: { start: '2026-08-20', end: '2026-08-20' },
                comparison: { start: '2026-08-19', end: '2026-08-19' },
                currentSnapshots: snapshots(),
                comparisonSnapshots: snapshots({ node_total: 5800 }),
                currentRevenue: { flux: 200, usd: 9 },
                comparisonRevenue: { flux: 100, usd: 4 },
                instant
            });
            return {
                timeframe: 'daily',
                current: { start: '2026-08-20', end: '2026-08-20' },
                comparison: { start: '2026-08-19', end: '2026-08-19' },
                dataset,
                generatedAt: '2026-08-21T00:00:00.000Z'
            };
        }

        it('heads the field INSTANT and shows the count without a fabricated delta', () => {
            const embed = buildDiscordPayload(dailyReport({ expiring: 12 })).embeds[0];
            const field = embed.fields.find(f => f.name === 'Expiring (24h) - INSTANT');
            expect(field).toBeDefined();
            expect(field.value).toContain('Point-in-time reading taken when the report was generated');
            const block = field.value.split('```')[1];
            const row = block.split('\n').find(l => l.includes('Apps expiring'));
            expect(row).toContain('12');
            // +/- and +/-% carry explicit placeholders, not a made-up comparison
            expect(row).toMatch(/-\s+n\/a\s*$/);
        });

        it('says the reading was unavailable rather than inventing a count', () => {
            const embed = buildDiscordPayload(dailyReport({ expiring: null })).embeds[0];
            const field = embed.fields.find(f => f.name === 'Expiring (24h) - INSTANT');
            expect(field.value).toContain('Not available at report time');
        });
    });
});
