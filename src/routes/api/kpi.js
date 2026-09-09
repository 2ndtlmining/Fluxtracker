// KPI report endpoints: availability check, in-modal preview, and the Discord send.
// Mounted at '/api' in server.js ('/kpi/*' and '/kpi-report' don't share a sub-prefix).
import express from 'express';

import { buildKpiReport, sendToDiscord, isValidDiscordWebhook } from '../../lib/services/kpiService.js';
import { TIMEFRAMES } from '../../lib/kpi/periods.js';
import { consumeRateLimit, refundTarget, LIMITS } from '../../lib/kpi/rateLimiter.js';
import { createLogger } from '../../lib/logger.js';

const log = createLogger('server');
const router = express.Router();

/** Never log a full webhook URL — it is a bearer credential. */
function maskWebhook(url) {
    const match = /webhooks\/(\d+)\//.exec(url || '');
    return match ? `webhook:${match[1]}` : 'webhook:unknown';
}

function clientKeyFor(req) {
    // trust proxy is not enabled, so req.ip is the direct peer. X-Forwarded-For is taken as
    // a hint only — it is spoofable, so it narrows abuse but is not a security boundary.
    const forwarded = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * GET /api/kpi/availability
 * Which timeframes can actually be reported on right now, so the modal can disable the
 * rest up front instead of failing after submit. The same check runs on POST.
 */
router.get('/kpi/availability', async (_req, res) => {
    try {
        const results = await Promise.all(TIMEFRAMES.map(async timeframe => {
            const report = await buildKpiReport(timeframe);
            const { dataset } = report;
            return {
                timeframe,
                available: !dataset.empty,
                currentLabel: report.currentLabel,
                comparisonLabel: report.comparisonLabel,
                current: report.current,
                comparison: report.comparison,
                availableMetrics: dataset.availableMetrics,
                totalMetrics: dataset.totalMetrics
            };
        }));
        res.json({ timeframes: results, limits: LIMITS });
    } catch (error) {
        log.error({ err: error }, 'KPI availability check failed');
        res.status(500).json({ error: 'Could not check KPI availability' });
    }
});

/**
 * GET /api/kpi/preview?timeframe=weekly
 * The computed numbers, without sending anything. Powers the in-modal preview.
 */
router.get('/kpi/preview', async (req, res) => {
    const timeframe = String(req.query.timeframe || '').toLowerCase();

    if (!TIMEFRAMES.includes(timeframe)) {
        return res.status(400).json({ error: `timeframe must be one of: ${TIMEFRAMES.join(', ')}` });
    }

    try {
        const report = await buildKpiReport(timeframe);
        res.json(report);
    } catch (error) {
        log.error({ err: error, timeframe }, 'KPI preview failed');
        res.status(500).json({ error: 'Could not build the KPI report' });
    }
});

/**
 * POST /api/kpi-report
 * body: { timeframe, medium: 'discord', target: '<webhook url>' }
 */
router.post('/kpi-report', async (req, res) => {
    const { timeframe, medium, target, website } = req.body || {};

    // Honeypot: a real browser leaves this hidden field empty
    if (website) {
        log.warn({ client: clientKeyFor(req) }, 'KPI honeypot triggered');
        return res.status(400).json({ error: 'Request rejected.' });
    }

    if (!TIMEFRAMES.includes(timeframe)) {
        return res.status(400).json({ error: `timeframe must be one of: ${TIMEFRAMES.join(', ')}` });
    }

    if (medium !== 'discord') {
        // Email delivery is designed for but not yet configured — see README.
        return res.status(400).json({ error: 'Only Discord delivery is available right now.' });
    }

    if (!isValidDiscordWebhook(target)) {
        return res.status(400).json({
            error: 'Enter a valid Discord webhook URL (https://discord.com/api/webhooks/...).'
        });
    }

    const clientKey = clientKeyFor(req);
    const targetKey = `discord:${target.trim()}`;

    // Claimed up front, not after the send: checking here and recording after the outbound
    // POST left a window where two parallel requests both passed before either was counted.
    const limit = consumeRateLimit(clientKey, targetKey);
    if (!limit.allowed) {
        res.set('Retry-After', String(limit.retryAfterSeconds));
        return res.status(429).json({ error: limit.reason, retryAfterSeconds: limit.retryAfterSeconds });
    }

    try {
        const report = await buildKpiReport(timeframe);

        if (report.dataset.empty) {
            // Nothing was delivered, so the destination keeps its slot
            refundTarget(targetKey);
            return res.status(422).json({
                error: `Not enough historical data for a ${timeframe} report yet ` +
                       `(${report.currentLabel} vs ${report.comparisonLabel}). Choose a shorter timeframe.`,
                insufficientData: true
            });
        }

        const result = await sendToDiscord(target.trim(), report);

        const incomplete = report.dataset.totalMetrics - report.dataset.availableMetrics;
        log.info(
            { timeframe, medium, target: maskWebhook(target), incomplete, activityDelivered: result.activityDelivered !== false },
            'KPI report delivered'
        );

        res.json({
            success: true,
            timeframe,
            currentLabel: report.currentLabel,
            comparisonLabel: report.comparisonLabel,
            metricsReported: report.dataset.availableMetrics,
            metricsTotal: report.dataset.totalMetrics,
            // The daily report is two messages (report + Flux Cloud Activity); a failure
            // of the second one is surfaced as a warning rather than an error, because
            // the main report did arrive and a retry would duplicate it.
            activityDelivered: result.activityDelivered !== false,
            ...(result.activityError ? { warning: `The main report was delivered, but the Flux Cloud Activity message failed: ${result.activityError}` } : {})
        });

    } catch (error) {
        // The report never arrived, so don't hold the destination's slot against it — a
        // mistyped webhook should be correctable straight away, not in five minutes.
        refundTarget(targetKey);
        log.error({ err: error, timeframe, target: maskWebhook(target) }, 'KPI report failed');
        // sendToDiscord throws user-safe messages; anything else stays generic
        res.status(502).json({ error: error.message || 'Could not send the KPI report.' });
    }
});

export default router;
