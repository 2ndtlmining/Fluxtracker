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
    average: 'AVERAGE of the daily values across the period'
};

function sectionTable(section) {
    const lines = [
        pad('Metric', COLS.label) +
        pad('Qty', COLS.qty, 'right') +
        pad('+/-', COLS.delta, 'right') +
        pad('+/-%', COLS.percent, 'right')
    ];

    for (const metric of section.metrics) {
        if (!metric.available) {
            const missing = metric.coverage?.missing;
            const why = missing > 0
                ? `Insufficient data (${missing} day${missing === 1 ? '' : 's'} missing)`
                : 'Insufficient data (no history)';
            lines.push(pad(metric.label, COLS.label) + why);
            continue;
        }
        lines.push(
            pad(metric.label, COLS.label) +
            pad(formatValue(metric.current, metric.format), COLS.qty, 'right') +
            pad(formatDelta(metric.change, metric.format), COLS.delta, 'right') +
            pad(formatPercent(metric.change), COLS.percent, 'right')
        );
    }

    return lines.join('\n');
}

/**
 * @param {object} report from buildKpiReport()
 * @returns Discord webhook JSON body
 */
export function buildDiscordPayload(report) {
    const { timeframe, current, comparison, dataset, generatedAt } = report;

    const currentLabel = formatPeriod(timeframe, current);
    const comparisonLabel = formatPeriod(timeframe, comparison);
    const timeframeTitle = timeframe.charAt(0).toUpperCase() + timeframe.slice(1);

    const fields = dataset.sections.map(section => {
        const aggregationNote = section.aggregation === 'sum' ? 'SUM' : 'AVERAGE';

        // A row aggregated differently from its section is called out by name. Without this
        // the section heading would claim every number under it is a period total, and the
        // average FLUX price row would read as the sum of every daily price.
        const exceptions = section.mixedAggregation
            ? section.metrics.filter(m => m.aggregation !== section.aggregation)
            : [];
        const exceptionNote = exceptions.length
            ? `\nExcept ${exceptions.map(m => m.label).join(', ')}: ` +
              `${AGGREGATION_TEXT[exceptions[0].aggregation]}.`
            : '';

        let value =
            `${AGGREGATION_TEXT[section.aggregation]}${exceptionNote}\n` +
            '```\n' + sectionTable(section) + '\n```';
        if (value.length > MAX_FIELD_CHARS) {
            value = value.slice(0, MAX_FIELD_CHARS - 4) + '\n```';
        }

        return {
            name: `${section.title} - ${aggregationNote}`,
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
                description:
                    `${currentLabel} vs ${comparisonLabel}\n` +
                    `${current.start} to ${current.end}  |  ${comparison.start} to ${comparison.end}`,
                color: EMBED_COLOR,
                fields,
                footer: { text: 'via FluxTracker' },
                timestamp: generatedAt
            }
        ]
    };
}
