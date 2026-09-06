import { resilientFetch } from './resilientFetch.js';
import { createLogger } from '../logger.js';

const log = createLogger('hostLocationService');

// Where this instance is physically running. On Flux the app moves between nodes, so this
// is genuinely useful information — and it only changes when the app is redeployed.
const REFRESH_MS = 6 * 60 * 60 * 1000; // 6 hours
const TIMEOUT_MS = 8000;

let cache = null;       // { city, region, country, countryCode, flag, ip, source, fetchedAt }
let inFlight = null;
let lastError = null;

/**
 * Country code -> flag emoji, via Unicode regional indicator symbols.
 * 'AU' -> 0x1F1E6 + 'A'-'A', 0x1F1E6 + 'U'-'A' -> 🇦🇺
 */
function toFlagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return '';
    const base = 0x1F1E6;
    const chars = [...countryCode.toUpperCase()].map(c => base + c.charCodeAt(0) - 65);
    return String.fromCodePoint(...chars);
}

function normalize({ city, region, country, countryCode, ip, source }) {
    if (!country) return null;
    return {
        city: city || null,
        region: region || null,
        country,
        countryCode: countryCode || null,
        flag: toFlagEmoji(countryCode),
        // Where the app is hosted, not who is viewing it — the IP is the server's own
        // public address, which is already discoverable from the URL.
        ip: ip || null,
        source
    };
}

// HTTPS, no key required
async function fromIpwhois() {
    const data = await resilientFetch('https://ipwho.is/', { timeout: TIMEOUT_MS, breakerKey: 'ipwhois' });
    if (!data?.success) throw new Error(data?.message || 'ipwho.is returned success=false');
    return normalize({
        city: data.city,
        region: data.region,
        country: data.country,
        countryCode: data.country_code,
        ip: data.ip,
        source: 'ipwho.is'
    });
}

// HTTP only on the free tier, which is fine for a server-side call
async function fromIpApi() {
    const data = await resilientFetch(
        'http://ip-api.com/json/?fields=status,message,country,countryCode,regionName,city,query',
        { timeout: TIMEOUT_MS, breakerKey: 'ip-api' }
    );
    if (data?.status !== 'success') throw new Error(data?.message || 'ip-api.com lookup failed');
    return normalize({
        city: data.city,
        region: data.regionName,
        country: data.country,
        countryCode: data.countryCode,
        ip: data.query,
        source: 'ip-api.com'
    });
}

async function lookup() {
    const providers = [['ipwho.is', fromIpwhois], ['ip-api.com', fromIpApi]];
    const errors = [];

    for (const [name, fn] of providers) {
        try {
            const result = await fn();
            if (result) {
                log.info({ location: result }, 'Host located: %s, %s', result.city || '?', result.country);
                return result;
            }
            errors.push(`${name}: empty result`);
        } catch (error) {
            errors.push(`${name}: ${error.message}`);
        }
    }

    throw new Error(errors.join('; '));
}

/**
 * Where this server is hosted. Cached for 6 hours; never throws — the header degrades to
 * hiding the location rather than failing the whole /api/header response.
 */
export async function getHostLocation() {
    if (cache && Date.now() - cache.fetchedAt < REFRESH_MS) return cache;
    if (inFlight) return inFlight;

    inFlight = lookup()
        .then(result => {
            cache = { ...result, fetchedAt: Date.now() };
            lastError = null;
            return cache;
        })
        .catch(error => {
            lastError = error.message;
            log.warn('Host location lookup failed: %s', error.message);
            return cache; // stale is better than nothing; null on first failure
        })
        .finally(() => { inFlight = null; });

    return inFlight;
}

/** Last lookup error, or null. */
export function getHostLocationError() {
    return lastError;
}

/** Test hook. */
export function clearHostLocationCache() {
    cache = null;
    inFlight = null;
    lastError = null;
}
