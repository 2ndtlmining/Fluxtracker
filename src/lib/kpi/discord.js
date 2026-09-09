/**
 * Discord webhook payload for a KPI report.
 *
 * House style, per spec: no emoji anywhere. Direction is carried by explicit +/- signs.
 * Each section is a code block so the Qty / +/- / +/-% columns stay aligned in Discord's
 * proportional font — without one, the columns wobble badly on mobile.
 */

import { formatValue, formatDelta, formatPercent } from './metrics.js';
import { formatPeriod } from './periods.js';

// Discord limits: 6000 chars per embed, 1024 per field value. Sections are fixed-size so
// these can't realistically be hit, but the value is truncated defensively before send.
const MAX_FIELD_CHARS = 1024;
const EMBED_COLOR = 0x00b8d4; // FluxTracker cyan — one restrained accent, not a status color

const DISCORD_WEBHOOK_PATTERN =
    /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

/**
 * Only Discord webhook URLs may be posted to. Without this the endpoint is an open relay —
 * anyone could make the server POST arbitrary JSON to an arbitrary host (SSRF).
 */
export function isValidDiscordWebhook(url) {
    if (typeof url !== 'string' || url.length > 500) return false;
    return DISCORD_WEBHOOK_PATTERN.test(url.trim());
}

/** Pad to a fixed width so the code block lines up. */
function pad(text, width, align = 'left') {
    const s = String(text);
    if (s.length >= width) return s.slice(0, width);
    const fill = ' '.repeat(width - s.length);
    return align === 'right' ? fill + s : s + fill;
}

const COLS = { label: 16, qty: 15, delta: 14, percent: 9 };

/**
 * Spelled out per section rather than abbreviated: a reader must be able to tell whether a
 * number is a period total or a daily mean without opening the README.
 */
const AGGREGATION_TEXT = {
    sum: 'SUM of all days in the period',
    average: 'AVERAGE of the daily values across the period',
    instant: 'Point-in-time reading taken when the report was generated'
};

/**
 * The daily report reads single-day snapshots — nothing is summed or averaged — so it
 * renders bare: no "- SUM/AVERAGE" field suffix, no aggregation line, and the price
 * row is that day's price rather than an average.
 */
function sectionHeading(section, isDaily) {
    return isDaily ? section.title : `${section.title} - ${section.aggregation === 'sum' ? 'SUM' : section.aggregation === 'instant' ? 'INSTANT' : 'AVERAGE'}`;
}

function metricLabel(metric, isDaily) {
    if (isDaily && metric.key === 'fluxPrice') return 'FLUX price';
    return metric.label;
}

function sectionTable(section, isDaily) {
    // Instant sections carry no comparison at all — their table has no delta columns.
    const instant = section.source === 'instant';
    const lines = [
        pad('Metric', COLS.label) +
        pad('Qty', COLS.qty, 'right') +
        (instant ? '' : pad('+/-', COLS.delta, 'right') + pad('+/-%', COLS.percent, 'right'))
    ];

    for (const metric of section.metrics) {
        if (!metric.available) {
            if (instant) {
                lines.push(pad(metricLabel(metric, isDaily), COLS.label) + 'Not available at report time');
                continue;
            }
            const missing = metric.coverage?.missing;
            const why = missing > 0
                ? `Insufficient data (${missing} day${missing === 1 ? '' : 's'} missing)`
                : 'Insufficient data (no history)';
            lines.push(pad(metricLabel(metric, isDaily), COLS.label) + why);
            continue;
        }
        lines.push(
            pad(metricLabel(metric, isDaily), COLS.label) +
            pad(formatValue(metric.current, metric.format), COLS.qty, 'right') +
            (instant ? '' : pad(formatDelta(metric.change, metric.format), COLS.delta, 'right') +
                pad(formatPercent(metric.change), COLS.percent, 'right'))
        );
    }

    return lines.join('\n');
}

/**
 * Failure notice for a missed/failed scheduled report. Posted once per period to
 * the configured webhook; /api/health is the backstop when this cannot deliver.
 */
export function buildSchedulerFailurePayload(timeframe, errorMessage) {
    return {
        username: 'FluxTracker',
        embeds: [
            {
                title: 'FluxTracker scheduled KPI report failed',
                description:
                    `Timeframe: ${timeframe}\n` +
                    `Error: ${errorMessage}\n` +
                    'The scheduler retries on its next check; see /api/health for state.',
                color: EMBED_COLOR,
                footer: { text: 'via FluxTracker' },
                timestamp: new Date().toISOString()
            }
        ]
    };
}

/**
 * @param {object} report from buildKpiReport()
 * @returns Discord webhook JSON body
 */
export function buildDiscordPayload(report) {
    const { timeframe, current, comparison, dataset, generatedAt, topDatacenters = [] } = report;
    const isDaily = timeframe === 'daily';

    const currentLabel = formatPeriod(timeframe, current);
    const comparisonLabel = formatPeriod(timeframe, comparison);
    const timeframeTitle = timeframe.charAt(0).toUpperCase() + timeframe.slice(1);

    // Daily only: currentLabel/comparisonLabel already spell out a single date each
    // ("Sep 4, 2026"), so a raw "2026-09-04 | 2026-09-03" line still adds the exact
    // ISO date at a glance. For every other timeframe currentLabel/comparisonLabel are
    // themselves a full period ("Aug 10-16, 2026") -- appending the same range again as
    // "2026-08-10 to 2026-08-16 | 2026-08-03 to 2026-08-09" is pure repetition with no
    // new information, so that line is dropped there (issue #105).
    const dateLine = isDaily ? `${current.start} | ${comparison.start}` : null;

    const fields = dataset.sections.map(section => {
        // Daily snapshots are not aggregated (a one-day "average" is the day itself),
        // so the aggregation note and heading suffix are dropped on daily only.
        const aggregationNote = section.aggregation === 'sum'
            ? 'SUM'
            : section.aggregation === 'instant'
                ? 'INSTANT'
                : 'AVERAGE';

        // A row aggregated differently from its section is called out by name. Without this
        // the section heading would claim every number under it is a period total, and the
        // average FLUX price row would read as the sum of every daily price.
        const exceptions = !isDaily && section.mixedAggregation
            ? section.metrics.filter(m => m.aggregation !== section.aggregation)
            : [];
        const exceptionNote = exceptions.length
            ? `\nExcept ${exceptions.map(m => m.label).join(', ')}: ` +
              `${AGGREGATION_TEXT[exceptions[0].aggregation]}.`
            : '';

        const aggregationLine = isDaily ? '' : `${AGGREGATION_TEXT[section.aggregation]}${exceptionNote}\n`;

        let value =
            `${aggregationLine}` +
            '```\n' + sectionTable(section, isDaily) + '\n```';
        if (section.key === 'decentralization' && topDatacenters.length > 0) {
            const lines = topDatacenters
                .map((dc, i) => `${i + 1}. ${dc.org} — ${Math.round(dc.avgCount)} avg nodes`)
                .join('\n');
            value += `\nTop datacenters:\n${lines}`;
        }
        if (value.length > MAX_FIELD_CHARS) {
            value = value.slice(0, MAX_FIELD_CHARS - 4) + '\n```';
        }

        return {
            name: sectionHeading(section, isDaily),
            value,
            inline: false
        };
    });

    const incomplete = dataset.totalMetrics - dataset.availableMetrics;
    if (incomplete > 0) {
        fields.push({
            name: 'Data coverage',
            value:
                `${incomplete} of ${dataset.totalMetrics} metrics are not reported because one or ` +
                'both periods are missing days. A metric is only shown when every day in both ' +
                'periods has data, so every figure above covers the full range.',
            inline: false
        });
    } else {
        fields.push({
            name: 'Data coverage',
            value: 'Complete. Every day in both periods has data for all metrics.',
            inline: false
        });
    }

    return {
        username: 'FluxTracker',
        embeds: [
            {
                title: `FluxTracker KPI Report - ${timeframeTitle}`,
                description: dateLine
                    ? `${currentLabel} vs ${comparisonLabel}\n${dateLine}`
                    : `${currentLabel} vs ${comparisonLabel}`,
                color: EMBED_COLOR,
                fields,
                footer: { text: 'via FluxTracker' },
                timestamp: generatedAt
            }
        ]
    };
}

// ============================================
// FLUX CLOUD ACTIVITY (second message, daily only)
// ============================================

// Per-app detail rows. Discord soft-wraps code blocks at the panel width, so the
// table must stay narrow enough to hold one line per app: no repo column (it alone
// was wide enough to force a wrap), names capped at 8 characters. ~35 chars/row
// keeps every row on one line even on mobile, and the budget cap plus "+N more"
// tail keeps the field under Discord's 1024-char limit no matter how many apps
// deployed or expired.
const ACTIVITY_COLS = { instances: 5, name: 8, cpu: 5, ram: 6, ssd: 6 };
const ACTIVITY_ROW_BUDGET = 950;

function truncateCell(text, width) {
    const s = String(text || '');
    return s.length <= width ? s : s.slice(0, width - 3) + '...';
}

function activityCpu(cpu) {
    const v = Math.round((cpu || 0) * 100) / 100;
    return String(v);
}

function activityRam(ram) {
    const v = ram || 0;
    return v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}G` : `${v}M`;
}

function activitySsd(hdd) {
    const v = hdd || 0;
    return v >= 1000 ? `${(v / 1000).toFixed(1).replace(/\.0$/, '')}T` : `${v}G`;
}

/** Fixed-width per-app table, capped to a character budget with a "+N more" tail. */
function activityTable(apps) {
    const c = ACTIVITY_COLS;
    const header =
        pad('Inst', c.instances, 'right') + ' ' +
        pad('Name', c.name) + ' ' +
        pad('CPU', c.cpu, 'right') + ' ' +
        pad('RAM', c.ram, 'right') + ' ' +
        pad('SSD', c.ssd, 'right');
    const lines = [header];
    let used = header.length;
    let shown = 0;

    for (const app of apps) {
        const row =
            pad(String(app.instances ?? 0), c.instances, 'right') + ' ' +
            pad(truncateCell(app.name, c.name), c.name) + ' ' +
            pad(activityCpu(app.cpu), c.cpu, 'right') + ' ' +
            pad(activityRam(app.ram), c.ram, 'right') + ' ' +
            pad(activitySsd(app.hdd), c.ssd, 'right');
        if (shown > 0 && used + row.length + 1 > ACTIVITY_ROW_BUDGET) break;
        lines.push(row);
        used += row.length + 1;
        shown++;
    }

    return { table: lines.join('\n'), shown, total: apps.length };
}

function activityField(title, list) {
    if (!list) {
        return { name: title, value: 'Not available at report time.', inline: false };
    }
    if (!list.apps || list.apps.length === 0) {
        return { name: title, value: 'None in the last 24 hours.', inline: false };
    }

    const { table, shown, total } = activityTable(list.apps);
    let value = 'Total: ' + total + '\n```\n' + table + '\n```';
    if (shown < total) {
        value += `\n+ ${total - shown} more not listed (total ${total}).`;
    }
    if (value.length > MAX_FIELD_CHARS) {
        value = value.slice(0, MAX_FIELD_CHARS - 4) + '\n```';
    }
    return { name: title, value, inline: false };
}

/**
 * Second daily message: the per-app detail behind the main report's Flux Cloud
 * section — what was deployed in the last 24 hours and what expires within them.
 * Point-in-time, like the section it expands.
 */
export function buildFluxCloudActivityPayload(report) {
    const fc = report.fluxCloud;
    if (!fc) return null;

    return {
        username: 'FluxTracker',
        embeds: [
            {
                title: 'FluxTracker Flux Cloud Activity',
                description:
                    `${report.currentLabel}\n` +
                    `${report.current.start} | point-in-time at ${report.generatedAt}`,
                color: EMBED_COLOR,
                fields: [
                    activityField('Deployments (24 hours)', fc.deployedToday),
                    activityField('Expiring today', fc.expiring24h)
                ],
                footer: { text: 'via FluxTracker' },
                timestamp: report.generatedAt
            }
        ]
    };
}
