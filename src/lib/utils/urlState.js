// Shareable view state (issue #446): a few query parameters mirror what is on screen, so a
// link can say "payments for app X" or "this chart, this period". Written with SvelteKit's
// shallow replaceState -- no navigation, no history entry per click -- and read back on load.

import { replaceState } from '$app/navigation';

/** A query parameter from the current URL, or null (and always null on the server). */
export function readUrlParam(key) {
    if (typeof window === 'undefined') return null;
    return new URL(window.location.href).searchParams.get(key);
}

/** Set or clear (null/'') query parameters, without a navigation. No-op if nothing changes. */
export function setUrlParams(params) {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries(params)) {
        if (value === null || value === undefined || value === '') url.searchParams.delete(key);
        else url.searchParams.set(key, String(value));
    }
    if (url.href === window.location.href) return;
    try {
        replaceState(url, {});
    } catch {
        // Before the router has started, SvelteKit's replaceState throws; the plain History
        // API is equivalent for a same-page URL.
        history.replaceState(history.state, '', url);
    }
}
