import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * resilientFetch — the shared HTTP GET primitive: retries, timeout, per-endpoint
 * breaker and shape validation. The breaker is mocked here so these tests exercise
 * the fetch logic alone; the breaker itself has its own suite.
 */

vi.mock('axios', () => ({
    default: { get: vi.fn() }
}));
vi.mock('../fetchBreaker.js', () => ({
    shouldAllowRequest: vi.fn(() => true),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn()
}));

import axios from 'axios';
import { resilientFetch, CircuitOpenError } from '../resilientFetch.js';
import { shouldAllowRequest, recordSuccess, recordFailure } from '../fetchBreaker.js';

beforeEach(() => {
    vi.clearAllMocks();
    shouldAllowRequest.mockReturnValue(true);
});

describe('resilientFetch', () => {
    it('resolves with the parsed response body', async () => {
        axios.get.mockResolvedValue({ data: { status: 'success', value: 42 } });

        const data = await resilientFetch('https://example.test/api', { breakerKey: 'test' });

        expect(data).toEqual({ status: 'success', value: 42 });
        expect(axios.get).toHaveBeenCalledTimes(1);
        expect(recordSuccess).toHaveBeenCalledWith('test');
        expect(recordFailure).not.toHaveBeenCalled();
    });

    it('passes timeout and extra axios config through', async () => {
        axios.get.mockResolvedValue({ data: {} });

        await resilientFetch('https://example.test/api', {
            timeout: 30000,
            axiosConfig: { headers: { 'X-Test': '1' } }
        });

        expect(axios.get).toHaveBeenCalledWith('https://example.test/api', {
            timeout: 30000,
            headers: { 'X-Test': '1' }
        });
    });

    it('retries a failure and succeeds on a later attempt', async () => {
        axios.get.mockRejectedValueOnce(new Error('boom'));
        axios.get.mockResolvedValueOnce({ data: { ok: true } });

        const data = await resilientFetch('https://example.test/api', { retries: 2, delayMs: 0, breakerKey: 'test' });

        expect(data).toEqual({ ok: true });
        expect(axios.get).toHaveBeenCalledTimes(2);
        expect(recordSuccess).toHaveBeenCalledWith('test');
        expect(recordFailure).not.toHaveBeenCalled();
    });

    it('exhausts retries and throws the last error, recording one failure', async () => {
        axios.get.mockRejectedValue(new Error('down'));

        await expect(resilientFetch('https://example.test/api', { retries: 2, delayMs: 0, breakerKey: 'test' }))
            .rejects.toThrow('down');

        expect(axios.get).toHaveBeenCalledTimes(3);
        expect(recordFailure).toHaveBeenCalledTimes(1);
        expect(recordFailure).toHaveBeenCalledWith('test');
        expect(recordSuccess).not.toHaveBeenCalled();
    });

    it('treats a failed shape validation as a failure and retries it', async () => {
        axios.get.mockResolvedValueOnce({ data: { garbage: true } });
        axios.get.mockResolvedValueOnce({ data: { status: 'success' } });

        const data = await resilientFetch('https://example.test/api', {
            retries: 1,
            delayMs: 0,
            validate: d => d?.status === 'success'
        });

        expect(data).toEqual({ status: 'success' });
        expect(axios.get).toHaveBeenCalledTimes(2);
        expect(recordFailure).not.toHaveBeenCalled();
    });

    it('a validation failure through all attempts records a breaker failure', async () => {
        axios.get.mockResolvedValue({ data: { garbage: true } });

        await expect(resilientFetch('https://example.test/api', {
            retries: 1,
            delayMs: 0,
            breakerKey: 'test',
            validate: d => d?.status === 'success'
        })).rejects.toThrow(/failed validation/);

        expect(recordFailure).toHaveBeenCalledTimes(1);
    });

    it('short-circuits with CircuitOpenError when the breaker is open', async () => {
        shouldAllowRequest.mockReturnValue(false);

        await expect(resilientFetch('https://example.test/api', { breakerKey: 'test' }))
            .rejects.toBeInstanceOf(CircuitOpenError);

        expect(axios.get).not.toHaveBeenCalled();
        expect(recordFailure).not.toHaveBeenCalled();
        expect(recordSuccess).not.toHaveBeenCalled();
    });

    it('works entirely without a breaker (no key passed)', async () => {
        axios.get.mockRejectedValue(new Error('down'));

        await expect(resilientFetch('https://example.test/api', { retries: 1, delayMs: 0 }))
            .rejects.toThrow('down');

        expect(recordFailure).not.toHaveBeenCalled();
        expect(recordSuccess).not.toHaveBeenCalled();
    });
});
