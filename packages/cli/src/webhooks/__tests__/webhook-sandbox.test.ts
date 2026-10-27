import { mockInstance } from '@n8n/backend-test-utils';
import { SecurityConfig } from '@n8n/config';
import type express from 'express';
import { mock } from 'jest-mock-extended';
import { getWebhookSandboxCSP } from 'n8n-core';

import { applyWebhookSandboxHeader } from '../webhook-sandbox';

describe('applyWebhookSandboxHeader', () => {
	const securityConfig = mockInstance(SecurityConfig);

	const createResponse = (contentType?: string | string[], headersSent = false) => {
		const res = mock<express.Response>({ headersSent });
		res.getHeader.mockImplementation((name) =>
			name.toLowerCase() === 'content-type' ? contentType : undefined,
		);
		return res;
	};

	beforeEach(() => {
		securityConfig.disableWebhookHtmlSandboxing = false;
	});

	test.each([
		['missing', undefined],
		['empty', ''],
		['text/html', 'text/html'],
		['text/html with charset', 'text/html; charset=utf-8'],
		['uppercase TEXT/HTML', 'TEXT/HTML'],
		['application/xhtml+xml', 'application/xhtml+xml'],
	])('should set the sandbox CSP when content type is %s', (_, contentType) => {
		const res = createResponse(contentType);

		applyWebhookSandboxHeader(res);

		expect(res.setHeader).toHaveBeenCalledWith('Content-Security-Policy', getWebhookSandboxCSP());
	});

	test.each(['application/json', 'image/png', 'application/pdf', 'text/plain'])(
		'should not set the sandbox CSP when content type is %s',
		(contentType) => {
			const res = createResponse(contentType);

			applyWebhookSandboxHeader(res);

			expect(res.setHeader).not.toHaveBeenCalled();
		},
	);

	test('should set the sandbox CSP when content type is an array containing text/html', () => {
		const res = createResponse(['text/html']);

		applyWebhookSandboxHeader(res);

		expect(res.setHeader).toHaveBeenCalledWith('Content-Security-Policy', getWebhookSandboxCSP());
	});

	test('should not set the sandbox CSP when sandboxing is disabled', () => {
		securityConfig.disableWebhookHtmlSandboxing = true;
		const res = createResponse('text/html');

		applyWebhookSandboxHeader(res);

		expect(res.setHeader).not.toHaveBeenCalled();
	});

	test('should not touch headers once they have been sent', () => {
		const res = createResponse('text/html', true);

		applyWebhookSandboxHeader(res);

		expect(res.setHeader).not.toHaveBeenCalled();
	});
});
