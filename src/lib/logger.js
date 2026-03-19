/**
 * Structured logger — wraps pino for consistent, leveled logging.
 *
 * Usage:
 *   import { logger } from '../logger.js';          // default logger
 *   import { createLogger } from '../logger.js';    // named child
 *   const log = createLogger('revenueService');
 *   log.info('sync started');
 *   log.warn({ blocks: 50000 }, 'large chunk');
 *   log.error({ err }, 'fetch failed');
 *
 * Env vars:
 *   LOG_LEVEL  — debug | info | warn | error | fatal  (default: info)
 *   LOG_FORMAT — json | pretty                         (default: pretty in dev, json in production)
 */

import pino from 'pino';

const level = process.env.LOG_LEVEL || 'info';
const isProd = process.env.NODE_ENV === 'production';
const format = process.env.LOG_FORMAT || (isProd ? 'json' : 'pretty');

const transport = format === 'pretty'
    ? { target: 'pino/file', options: { destination: 1 } } // stdout with default serializers
    : undefined; // raw JSON to stdout

export const logger = pino({
    level,
    transport,
    formatters: {
        level(label) {
            return { level: label };
        }
    },
    // Omit pid/hostname in pretty mode for cleaner output
    base: isProd ? undefined : null,
    timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Create a child logger with a component name.
 * All messages from this logger include { component: name }.
 */
export function createLogger(component) {
    return logger.child({ component });
}
