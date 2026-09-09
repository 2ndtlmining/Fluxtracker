import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
    default: { get: vi.fn() }
}));

import axios from 'axios';
import {
    ensureGlobalSpecsCache,
    getAppSpecByName,
    getAppNameByHash,
    getAppTypeByName,
    determineAppType,
    resolveRunningAppName,
    clearGlobalSpecsCache
} from '../appSpecsCache.js';

const SAMPLE_SPECS = [
    {
        version: 8,
        name: 'FoldingAtRunOnFlux2',
        hash: 'hash-folding',
        compose: [
            { name: 'FoldingAtHome', repotag: 'runonflux/foldingathome:latest' }
        ]
    },
    {
        version: 8,
        name: '131barb1',
        hash: 'hash-131barb1',
        compose: [
            { name: 'fm1', repotag: 'earnfm/earnfm-client:latest' },
            { name: 'ps1', repotag: 'packetstream/psclient:latest' }
        ]
    },
    {
        version: 3,
        name: 'EthereumNodeLight',
        hash: 'hash-eth',
        repotag: 'ethereum/client-go:stable'
    }
];

function apiResponse(data) {
    return { data: { status: 'success', data } };
}

beforeEach(() => {
    vi.clearAllMocks();
    clearGlobalSpecsCache();
});

describe('ensureGlobalSpecsCache', () => {
    it('fetches and indexes specs by name', async () => {
        axios.get.mockResolvedValue(apiResponse(SAMPLE_SPECS));

        await ensureGlobalSpecsCache();

        expect(getAppSpecByName('FoldingAtRunOnFlux2')).toMatchObject({ name: 'FoldingAtRunOnFlux2' });
        expect(getAppSpecByName('foldingatrunonflux2')).toBeTruthy(); // case-insensitive lookup
    });

    it('does not refetch within the TTL', async () => {
        axios.get.mockResolvedValue(apiResponse(SAMPLE_SPECS));

        await ensureGlobalSpecsCache();
        await ensureGlobalSpecsCache();
        await ensureGlobalSpecsCache();

        expect(axios.get).toHaveBeenCalledTimes(1);
    });
});

describe('getAppNameByHash / getAppTypeByName', () => {
    it('resolves hash to name and name to git/docker type', async () => {
        axios.get.mockResolvedValue(apiResponse(SAMPLE_SPECS));
        await ensureGlobalSpecsCache();

        expect(getAppNameByHash('hash-eth')).toBe('EthereumNodeLight');
        expect(getAppNameByHash('no-such-hash')).toBeNull();
        expect(getAppTypeByName('EthereumNodeLight')).toBe('docker');
    });
});

describe('determineAppType', () => {
    it('detects git apps via runonflux/orbit repotag in compose', () => {
        const spec = { compose: [{ repotag: 'runonflux/orbit:latest' }] };
        expect(determineAppType(spec)).toBe('git');
    });

    it('detects git apps via flat repotag (legacy format)', () => {
        const spec = { repotag: 'runonflux/orbit:latest' };
        expect(determineAppType(spec)).toBe('git');
    });

    it('defaults to docker for anything else, including null', () => {
        expect(determineAppType({ compose: [{ repotag: 'nginx:latest' }] })).toBe('docker');
        expect(determineAppType(null)).toBe('docker');
    });
});

describe('resolveRunningAppName', () => {
    beforeEach(async () => {
        axios.get.mockResolvedValue(apiResponse(SAMPLE_SPECS));
        await ensureGlobalSpecsCache();
    });

    it('resolves a compose app from "/flux<component>_<appName>"', () => {
        const resolved = resolveRunningAppName('/fluxFoldingAtHome_FoldingAtRunOnFlux2');
        expect(resolved).toEqual({ appName: 'FoldingAtRunOnFlux2', repotag: 'runonflux/foldingathome:latest' });
    });

    it('resolves the correct component when an app has several', () => {
        expect(resolveRunningAppName('/fluxfm1_131barb1'))
            .toEqual({ appName: '131barb1', repotag: 'earnfm/earnfm-client:latest' });
        expect(resolveRunningAppName('/fluxps1_131barb1'))
            .toEqual({ appName: '131barb1', repotag: 'packetstream/psclient:latest' });
    });

    it('resolves a legacy flat-spec app with no component prefix', () => {
        expect(resolveRunningAppName('/fluxEthereumNodeLight'))
            .toEqual({ appName: 'EthereumNodeLight', repotag: 'ethereum/client-go:stable' });
    });

    it('returns null for a container name with no matching spec', () => {
        expect(resolveRunningAppName('/fluxcloudgit_bsserver')).toBeNull();
    });

    it('returns null for empty or missing input', () => {
        expect(resolveRunningAppName('')).toBeNull();
        expect(resolveRunningAppName(null)).toBeNull();
    });
});
