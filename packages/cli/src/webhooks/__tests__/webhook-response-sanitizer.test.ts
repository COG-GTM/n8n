import {
	isAllowedWebhookResponseHeader,
	sanitizeWebhookResponseHeaders,
} from '@/webhooks/webhook-response-sanitizer';

describe('webhookResponseSanitizer', () => {
	describe('isAllowedWebhookResponseHeader', () => {
		test.each([
			'set-cookie',
			'Set-Cookie',
			' SET-COOKIE ',
			'set-cookie2',
			'Clear-Site-Data',
			'Service-Worker-Allowed',
		])('should disallow %s', (name) => {
			expect(isAllowedWebhookResponseHeader(name)).toBe(false);
		});

		test.each(['content-type', 'x-custom-header', 'location', 'cache-control'])(
			'should allow %s',
			(name) => {
				expect(isAllowedWebhookResponseHeader(name)).toBe(true);
			},
		);
	});

	describe('sanitizeWebhookResponseHeaders', () => {
		it('should remove disallowed headers from a Map', () => {
			const headers = new Map([
				['set-cookie', 'n8n-auth=attacker-token; Path=/'],
				['clear-site-data', '"cookies"'],
				['x-custom-header', 'test'],
			]);

			const result = sanitizeWebhookResponseHeaders(headers);

			expect(result).toEqual(new Map([['x-custom-header', 'test']]));
			expect(headers.size).toBe(3);
		});

		it('should remove disallowed headers from an object', () => {
			const headers = {
				'Set-Cookie': 'n8n-auth=attacker-token; Path=/',
				'content-type': 'text/html',
			};

			expect(sanitizeWebhookResponseHeaders(headers)).toEqual({ 'content-type': 'text/html' });
		});
	});
});
