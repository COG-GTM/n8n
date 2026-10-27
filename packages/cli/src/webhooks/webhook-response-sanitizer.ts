import type { WebhookResponseHeaders } from './webhook.types';

/**
 * Response headers a workflow must not be able to set, because webhooks are served
 * from the same origin as the editor. E.g. `Set-Cookie` would let a workflow plant
 * an `n8n-auth` cookie (session fixation), `Clear-Site-Data` would log users out.
 */
const DISALLOWED_RESPONSE_HEADERS = new Set([
	'set-cookie',
	'set-cookie2',
	'clear-site-data',
	'service-worker-allowed',
]);

export const isAllowedWebhookResponseHeader = (name: string) =>
	!DISALLOWED_RESPONSE_HEADERS.has(name.trim().toLowerCase());

/**
 * Returns a copy of the given workflow-supplied response headers without the disallowed ones
 */
export function sanitizeWebhookResponseHeaders(
	headers: WebhookResponseHeaders,
): WebhookResponseHeaders;
export function sanitizeWebhookResponseHeaders<T>(headers: Record<string, T>): Record<string, T>;
export function sanitizeWebhookResponseHeaders<T>(
	headers: WebhookResponseHeaders | Record<string, T>,
): WebhookResponseHeaders | Record<string, T> {
	if (headers instanceof Map) {
		return new Map([...headers].filter(([name]) => isAllowedWebhookResponseHeader(name)));
	}

	return Object.fromEntries(
		Object.entries(headers).filter(([name]) => isAllowedWebhookResponseHeader(name)),
	);
}
