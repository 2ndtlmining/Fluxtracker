import { writable } from 'svelte/store';

/**
 * Dashboard-wide refresh signal.
 *
 * The footer's Refresh button used to POST /api/admin/test-services and then only re-read
 * its own stats, so the database updated but the visible cards didn't change until the next
 * poll — the button looked broken (issue #53). Every card subscribes to this counter and
 * re-fetches when it increments.
 *
 * It's a counter rather than a boolean so repeated clicks each produce a distinct value.
 */
export const refreshSignal = writable(0);

/** Tell every subscribed card to re-fetch now. */
export function triggerRefresh() {
    refreshSignal.update(n => n + 1);
}
