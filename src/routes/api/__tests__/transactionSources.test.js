import { describe, it, expect } from 'vitest';
import { resolveSourceAddresses } from '../revenue.js';
import { FLUX_TEAM_ADDRESSES, FLUX_FIAT_ADDRESSES } from '../../../lib/config.js';

/**
 * Issue #159: the TEAM / FIAT badges send a `source` name, never an address list. Letting
 * the client name addresses directly would turn the endpoint into an arbitrary
 * from_address query, so the mapping is resolved server-side from config.
 */
describe('resolveSourceAddresses', () => {
    it('returns null for no source, meaning "no filter"', () => {
        expect(resolveSourceAddresses(undefined)).toBeNull();
        expect(resolveSourceAddresses('')).toBeNull();
    });

    it('maps a source name to the configured addresses', () => {
        expect(resolveSourceAddresses('team')).toEqual(FLUX_TEAM_ADDRESSES);
        expect(resolveSourceAddresses('fiat')).toEqual(FLUX_FIAT_ADDRESSES);
    });

    it('unions multiple sources -- both badges means team OR fiat', () => {
        const both = resolveSourceAddresses('team,fiat');
        for (const addr of [...FLUX_TEAM_ADDRESSES, ...FLUX_FIAT_ADDRESSES]) {
            expect(both).toContain(addr);
        }
    });

    it('ignores an unknown source rather than erroring on a stale bookmark', () => {
        expect(resolveSourceAddresses('nonsense')).toBeNull();
        expect(resolveSourceAddresses('team,nonsense')).toEqual(FLUX_TEAM_ADDRESSES);
    });

    it('never returns a client-supplied address -- only configured ones', () => {
        const attacker = 't1AttackerControlledAddressNotInConfig';
        expect(resolveSourceAddresses(attacker)).toBeNull();
        expect(resolveSourceAddresses(`team,${attacker}`)).not.toContain(attacker);
    });

    it('is case and whitespace tolerant', () => {
        expect(resolveSourceAddresses(' TEAM , Fiat ')).toEqual(
            [...new Set([...FLUX_TEAM_ADDRESSES, ...FLUX_FIAT_ADDRESSES])]
        );
    });

    it('dedupes so an address listed twice cannot double-count', () => {
        const r = resolveSourceAddresses('team,team');
        expect(new Set(r).size).toBe(r.length);
    });
});
