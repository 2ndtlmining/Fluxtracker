import { describe, it, expect } from 'vitest';
import { isValidDiscordWebhook, buildSchedulerFailurePayload } from '../discord.js';

describe('isValidDiscordWebhook — SSRF guard', () => {
    it('accepts real Discord webhook URLs', () => {
        for (const url of [
            'https://discord.com/api/webhooks/123456789/abcDEF-_123',
            'https://discordapp.com/api/webhooks/987654321/tokenTOKEN',
            'https://canary.discord.com/api/webhooks/1/aa',
            'https://ptb.discord.com/api/webhooks/1/aa'
        ]) {
            expect(isValidDiscordWebhook(url), url).toBe(true);
        }
    });

    it('rejects any non-Discord host — this endpoint must not become an open relay', () => {
        for (const url of [
            'https://evil.com/api/webhooks/123/abc',
            'https://discord.com.evil.com/api/webhooks/123/abc',
            'http://discord.com/api/webhooks/123/abc',          // plain http
            'https://discord.com/api/webhooks/123/abc@evil.com',
            'https://mydiscord.com/api/webhooks/123/abc',
            'http://169.254.169.254/latest/meta-data/',          // cloud metadata
            'https://discord.com/api/channels/123/messages'      // Discord, but not a webhook
        ]) {
            expect(isValidDiscordWebhook(url), url).toBe(false);
        }
    });

    it('rejects malformed input without throwing', () => {
        for (const value of [null, undefined, '', '   ', 42, {}, [], 'https://discord.com/api/webhooks/']) {
            expect(isValidDiscordWebhook(value)).toBe(false);
        }
    });

    it('rejects an absurdly long URL', () => {
        expect(isValidDiscordWebhook('https://discord.com/api/webhooks/1/' + 'a'.repeat(600))).toBe(false);
    });
});

describe('buildSchedulerFailurePayload', () => {
    it('names the timeframe and the error, without emoji', () => {
        const embed = buildSchedulerFailurePayload('yearly', 'Not enough historical data').embeds[0];
        expect(embed.description).toContain('Timeframe: yearly');
        expect(embed.description).toContain('Not enough historical data');
        expect(JSON.stringify(embed)).not.toMatch(/\p{Extended_Pictographic}/u);
    });
});
