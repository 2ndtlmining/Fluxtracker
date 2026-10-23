import { describe, it, expect } from 'vitest';
import { resolveSourceAddresses, resolveTrialAddresses } from '../revenue.js';
import { FLUX_TEAM_ADDRESSES, FLUX_FIAT_ADDRESSES, FLUX_TRIAL_ADDRESSES, isFluxTrialPayment } from '../../../lib/config.js';

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

describe('free trial source', () => {
    const TRIAL = 't1Mzja9iJcEYeW5B4m4s1tJG8M42odFZ16A';

    it('is a registration from a trial address, not every payment from it', () => {
        expect(isFluxTrialPayment({ from_address: TRIAL, msg_type: 'register' })).toBe(true);
        expect(isFluxTrialPayment({ from_address: TRIAL, msg_type: 'update' })).toBe(false);
        expect(isFluxTrialPayment({ from_address: TRIAL, msg_type: null })).toBe(false);
        expect(isFluxTrialPayment({ from_address: 't1gjUUxBpBeVC1sWwAFrtSsVCbSaFdZx8UY', msg_type: 'register' })).toBe(false);
    });

    it('stays a sub-category of team: every trial address is a team address', () => {
        for (const addr of FLUX_TRIAL_ADDRESSES) expect(FLUX_TEAM_ADDRESSES).toContain(addr);
    });

    it('resolves "trial" to the configured trial addresses, and only when named', () => {
        expect(resolveTrialAddresses('trial')).toEqual(FLUX_TRIAL_ADDRESSES);
        expect(resolveTrialAddresses(' Fiat , TRIAL ')).toEqual(FLUX_TRIAL_ADDRESSES);
        expect(resolveTrialAddresses('team')).toBeNull();
        expect(resolveTrialAddresses('')).toBeNull();
        expect(resolveTrialAddresses(undefined)).toBeNull();
    });

    it('is not an address source -- "trial" alone adds no plain address match', () => {
        expect(resolveSourceAddresses('trial')).toBeNull();
    });
});
