import type express from 'express';
import {
	getWebhookSandboxCSP,
	isHtmlRenderedContentType,
	isWebhookHtmlSandboxingDisabled,
} from 'n8n-core';

/**
 * Adds the sandbox CSP header when the response has no content type or one a
 * browser may render as HTML. Must be called after the response headers are
 * set and before the body is written. Every webhook write path has to go
 * through this so workflow-served HTML can't run scripts on the n8n origin.
 */
export function applyWebhookSandboxHeader(res: express.Response) {
	if (res.headersSent || isWebhookHtmlSandboxingDisabled()) return;

	const header = res.getHeader('content-type');
	const contentType = Array.isArray(header) ? header.join(',') : String(header ?? '');
	const needsSandbox = !contentType || isHtmlRenderedContentType(contentType);

	if (needsSandbox) {
		res.setHeader('Content-Security-Policy', getWebhookSandboxCSP());
	}
}
