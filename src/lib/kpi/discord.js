/**
 * Discord helpers for the KPI reports: the webhook SSRF guard and the scheduler's failure
 * notice. The report itself is the executive scorecard in ./scorecard.js (owner redesign,
 * 2026-09-26), which replaced the per-section tables and the second "Flux Cloud Activity"
 * message that used to live here.
 */

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
