import { writable } from 'svelte/store';

/**
 * "Show me this app's payments" (issue #284). The header sets it when an app frame is
 * clicked; the revenue section switches to the transaction table, searches for the name and
 * scrolls into view. `at` makes a second click on the same app a new value, so it re-fires.
 *
 * @type {import('svelte/store').Writable<{name: string, at: number}|null>}
 */
export const appFocus = writable(null);

export function focusApp(name) {
    if (!name) return;
    appFocus.set({ name, at: Date.now() });
}
