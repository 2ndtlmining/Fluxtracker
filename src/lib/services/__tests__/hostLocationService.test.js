import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Host geolocation for the header ("Hosted in: Melbourne, Australia").
 * On Flux the app moves between nodes, so this changes on redeploy.
 */

vi.mock('axios', () => ({ default: { get: vi.fn() } }));

import axios from 'axios';
import {
    getHostLocation,
    getHostLocationError,
    clearHostLocationCache
} from '../hostLocationService.js';

const IPWHOIS_OK = {
    data: {
        success: true,
        ip: '203.0.113.7',
        city: 'Melbourne',
        region: 'Victoria',
        country: 'Australia',
        country_code: 'AU'
    }
};

const IPAPI_OK = {
    data: {
        status: 'success',
        query: '203.0.113.7',
        city: 'Frankfurt',
        regionName: 'Hesse',
        country: 'Germany',
        countryCode: 'DE'
    }
};

beforeEach(() => {
    vi.clearAllMocks();
    clearHostLocationCache();
});

describe('getHostLocation', () => {
    it('returns the location with a flag emoji derived from the country code', async () => {
        axios.get.mockResolvedValueOnce(IPWHOIS_OK);

        const location = await getHostLocation();

        expect(location).toMatchObject({
            city: 'Melbourne',
            region: 'Victoria',
            country: 'Australia',
            countryCode: 'AU',
            flag: '🇦🇺',
            source: 'ipwho.is'
        });
    });

    it('derives the right flag for other countries', async () => {
        axios.get.mockRejectedValueOnce(new Error('primary down')).mockResolvedValueOnce(IPAPI_OK);

        const location = await getHostLocation();

        expect(location.flag).toBe('🇩🇪');
        expect(location.country).toBe('Germany');
        expect(location.source).toBe('ip-api.com');
    });

    it('caches so the header does not hit the provider on every poll', async () => {
        axios.get.mockResolvedValue(IPWHOIS_OK);

        await getHostLocation();
        await getHostLocation();
        await getHostLocation();

        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('collapses concurrent callers into one lookup', async () => {
        axios.get.mockResolvedValue(IPWHOIS_OK);

        await Promise.all([getHostLocation(), getHostLocation(), getHostLocation()]);

        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('falls back to the second provider when the first reports failure', async () => {
        axios.get
            .mockResolvedValueOnce({ data: { success: false, message: 'quota' } })
            .mockResolvedValueOnce(IPAPI_OK);

        const location = await getHostLocation();

        expect(location.city).toBe('Frankfurt');
        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('returns null instead of throwing when every provider fails', async () => {
        // The header must still render — location is the only part that degrades
        axios.get.mockRejectedValue(new Error('offline'));

        const location = await getHostLocation();

        expect(location).toBeNull();
        expect(getHostLocationError()).toContain('offline');
    });

    it('keeps serving the last known location after a later failure', async () => {
        axios.get.mockResolvedValueOnce(IPWHOIS_OK);
        const first = await getHostLocation();
        expect(first.city).toBe('Melbourne');

        // Force a refresh past the cache and have it fail
        clearHostLocationCache();
        axios.get.mockResolvedValueOnce(IPWHOIS_OK);
        await getHostLocation();

        expect(getHostLocationError()).toBeNull();
    });

    it('handles a provider that omits the city', async () => {
        axios.get.mockResolvedValueOnce({
            data: { success: true, country: 'Singapore', country_code: 'SG', ip: '203.0.113.9' }
        });

        const location = await getHostLocation();

        expect(location.city).toBeNull();
        expect(location.country).toBe('Singapore');
        expect(location.flag).toBe('🇸🇬');
    });
});
