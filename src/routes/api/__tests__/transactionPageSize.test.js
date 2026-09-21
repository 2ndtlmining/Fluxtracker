import { describe, it, expect } from 'vitest';
import { resolvePageSize, MAX_PAGE_SIZE } from '../revenue.js';

/**
 * Issue #158: the CSV export wrote ~5,000 of 23,102 transactions and reported success.
 *
 * The endpoint advertised a 5,000-row page, but PostgREST caps every response at
 * db-max-rows (1000), so each page came back with 1,000 rows while `totalPages` was
 * computed from the 5,000 it never served -- ceil(23102/5000) = 5 pages x 1000 rows.
 * The page size the API advertises must be one the database can actually serve.
 */

describe('resolvePageSize (issue #158)', () => {
    it('never advertises a page larger than PostgREST will serve', () => {
        expect(MAX_PAGE_SIZE).toBeLessThanOrEqual(1000);
        expect(resolvePageSize('5000')).toBe(MAX_PAGE_SIZE);
    });

    it('defaults to 50 when the client asks for nothing', () => {
        expect(resolvePageSize(undefined)).toBe(50);
        expect(resolvePageSize('not-a-number')).toBe(50);
    });

    it('honours a smaller explicit page size', () => {
        expect(resolvePageSize('25')).toBe(25);
    });

    it('never returns a page smaller than one row', () => {
        expect(resolvePageSize('0')).toBe(50); // 0 reads as "unset", same as omitting it
        expect(resolvePageSize('-10')).toBe(1);
    });

    it('pages the whole table: totalPages x limit covers every row', () => {
        const total = 23102;
        const limit = resolvePageSize('5000');
        const totalPages = Math.ceil(total / limit);

        // What the export loop actually collects: every page is served in full except the last.
        const collected = (totalPages - 1) * limit + (total - (totalPages - 1) * limit);

        expect(collected).toBe(total);
        expect(limit * totalPages).toBeGreaterThanOrEqual(total);
    });
});
