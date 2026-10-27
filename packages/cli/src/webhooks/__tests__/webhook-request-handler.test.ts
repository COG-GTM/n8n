import { type Response } from 'express';
import { mock } from 'jest-mock-extended';
import { getWebhookSandboxCSP } from 'n8n-core';
import { randomString } from 'n8n-workflow';
import type { IHttpRequestMethods } from 'n8n-workflow';

import { ResponseError } from '@/errors/response-errors/abstract/response.error';
import { createWebhookHandlerFor } from '@/webhooks/webhook-request-handler';
import { createStaticResponse } from '@/webhooks/webhook-response';
import type {
	IWebhookManager,
	IWebhookResponseCallbackData,
	WebhookOptionsRequest,
	WebhookRequest,
} from '@/webhooks/webhook.types';

describe('WebhookRequestHandler', () => {
	const webhookManager = mock<Required<IWebhookManager>>();
	const handler = createWebhookHandlerFor(webhookManager);

	beforeEach(() => {
		jest.resetAllMocks();
	});

	it('should throw for unsupported methods', async () => {
		const req = mock<WebhookRequest | WebhookOptionsRequest>({
			method: 'CONNECT' as IHttpRequestMethods,
		});
		const res = mock<Response>();
		res.status.mockReturnValue(res);

		await handler(req, res);

		expect(res.status).toHaveBeenCalledWith(500);
		expect(res.json).toHaveBeenCalledWith({
			code: 0,
			message: 'The method CONNECT is not supported.',
		});
	});

	describe('preflight requests', () => {
		it('should handle missing header for requested method', async () => {
			const req = mock<WebhookRequest | WebhookOptionsRequest>({
				method: 'OPTIONS',
				headers: {
					origin: 'https://example.com',
					'access-control-request-method': undefined,
				},
				params: { path: 'test' },
			});
			const res = mock<Response>();
			res.status.mockReturnValue(res);

			webhookManager.getWebhookMethods.mockResolvedValue(['GET', 'PATCH']);

			await handler(req, res);

			expect(res.status).toHaveBeenCalledWith(204);
			expect(res.header).toHaveBeenCalledWith(
				'Access-Control-Allow-Methods',
				'OPTIONS, GET, PATCH',
			);
		});

		it('should handle default origin and max-age', async () => {
			const req = mock<WebhookRequest | WebhookOptionsRequest>({
				method: 'OPTIONS',
				headers: {
					origin: 'https://example.com',
					'access-control-request-method': 'GET',
				},
				params: { path: 'test' },
			});
			const res = mock<Response>();
			res.status.mockReturnValue(res);

			webhookManager.getWebhookMethods.mockResolvedValue(['GET', 'PATCH']);

			await handler(req, res);

			expect(res.status).toHaveBeenCalledWith(204);
			expect(res.header).toHaveBeenCalledWith(
				'Access-Control-Allow-Methods',
				'OPTIONS, GET, PATCH',
			);
			expect(res.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://example.com');
			expect(res.header).toHaveBeenCalledWith('Access-Control-Max-Age', '300');
		});

		it('should handle wildcard origin', async () => {
			const randomOrigin = randomString(10);
			const req = mock<WebhookRequest | WebhookOptionsRequest>({
				method: 'OPTIONS',
				headers: {
					origin: randomOrigin,
					'access-control-request-method': 'GET',
				},
				params: { path: 'test' },
			});
			const res = mock<Response>();
			res.status.mockReturnValue(res);

			webhookManager.getWebhookMethods.mockResolvedValue(['GET', 'PATCH']);
			webhookManager.findAccessControlOptions.mockResolvedValue({
				allowedOrigins: '*',
			});

			await handler(req, res);

			expect(res.status).toHaveBeenCalledWith(204);
			expect(res.header).toHaveBeenCalledWith(
				'Access-Control-Allow-Methods',
				'OPTIONS, GET, PATCH',
			);
			expect(res.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', randomOrigin);
		});

		it('should handle custom origin', async () => {
			const req = mock<WebhookRequest | WebhookOptionsRequest>({
				method: 'OPTIONS',
				headers: {
					origin: 'https://example.com',
					'access-control-request-method': 'GET',
				},
				params: { path: 'test' },
			});
			const res = mock<Response>();
			res.status.mockReturnValue(res);

			webhookManager.getWebhookMethods.mockResolvedValue(['GET', 'PATCH']);
			webhookManager.findAccessControlOptions.mockResolvedValue({
				allowedOrigins: 'https://test.com',
			});

			await handler(req, res);

			expect(res.status).toHaveBeenCalledWith(204);
			expect(res.header).toHaveBeenCalledWith(
				'Access-Control-Allow-Methods',
				'OPTIONS, GET, PATCH',
			);
			expect(res.header).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://test.com');
		});
	});

	describe('webhook requests', () => {
		it('should delegate the request to the webhook manager and send the response', async () => {
			const req = mock<WebhookRequest>({
				method: 'GET',
				params: { path: 'test' },
			});

			const res = mock<Response>();

			const executeWebhookResponse: IWebhookResponseCallbackData = {
				responseCode: 200,
				data: {},
				headers: {
					'x-custom-header': 'test',
				},
			};
			webhookManager.executeWebhook.mockResolvedValueOnce(executeWebhookResponse);

			await handler(req, res);

			expect(webhookManager.executeWebhook).toHaveBeenCalledWith(req, res);
			expect(res.status).toHaveBeenCalledWith(200);
			expect(res.setHeader).toHaveBeenCalledWith('x-custom-header', 'test');
			expect(res.json).toHaveBeenCalledWith(executeWebhookResponse.data);
		});

		it('should send an error response if webhook execution throws', async () => {
			class TestError extends ResponseError {}
			const req = mock<WebhookRequest>({
				method: 'GET',
				params: { path: 'test' },
			});

			const res = mock<Response>();
			res.status.mockReturnValue(res);

			webhookManager.executeWebhook.mockRejectedValueOnce(
				new TestError('Test error', 500, 100, 'Test hint'),
			);

			await handler(req, res);

			expect(webhookManager.executeWebhook).toHaveBeenCalledWith(req, res);
			expect(res.status).toHaveBeenCalledWith(500);
			expect(res.json).toHaveBeenCalledWith({
				code: 100,
				message: 'Test error',
				hint: 'Test hint',
			});
		});

		test.each<IHttpRequestMethods>(['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'])(
			"should handle '%s' method",
			async (method) => {
				const req = mock<WebhookRequest>({
					method,
					params: { path: 'test' },
				});

				const res = mock<Response>();

				const executeWebhookResponse: IWebhookResponseCallbackData = {
					responseCode: 200,
				};
				webhookManager.executeWebhook.mockResolvedValueOnce(executeWebhookResponse);

				await handler(req, res);

				expect(webhookManager.executeWebhook).toHaveBeenCalledWith(req, res);
				expect(res.status).toHaveBeenCalledWith(200);
				expect(res.json).toHaveBeenCalledWith(executeWebhookResponse.data);
			},
		);
	});

	describe('webhook HTML sandbox', () => {
		const sandboxCSP = getWebhookSandboxCSP();

		const createResponse = () => {
			const headers = new Map<string, unknown>();
			const res = mock<Response>();
			res.setHeader.mockImplementation((name, value) => {
				headers.set(name.toLowerCase(), value);
				return res;
			});
			res.getHeader.mockImplementation((name) => headers.get(name.toLowerCase()) as string);
			return res;
		};

		const req = () => mock<WebhookRequest>({ method: 'GET', params: { path: 'test' } });

		test.each([
			'text/html',
			'image/svg+xml',
			'application/xml',
			'text/xml; charset=utf-8',
			'application/mathml+xml',
			'text/xsl',
			' image/svg+xml',
			'text/plain, image/svg+xml',
		])('should sandbox a static response with content-type "%s"', async (contentType) => {
			const res = createResponse();
			webhookManager.executeWebhook.mockResolvedValueOnce(
				createStaticResponse(
					'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
					200,
					new Map([['content-type', contentType]]),
				),
			);

			await handler(req(), res);

			expect(res.setHeader).toHaveBeenCalledWith('Content-Security-Policy', sandboxCSP);
		});

		test.each(['application/json', 'text/plain', 'image/png', 'application/pdf'])(
			'should not sandbox a static response with content-type "%s"',
			async (contentType) => {
				const res = createResponse();
				webhookManager.executeWebhook.mockResolvedValueOnce(
					createStaticResponse('data', 200, new Map([['content-type', contentType]])),
				);

				await handler(req(), res);

				expect(res.setHeader).not.toHaveBeenCalledWith('Content-Security-Policy', sandboxCSP);
			},
		);

		it('should sandbox a legacy response with an SVG content-type', async () => {
			const res = createResponse();
			webhookManager.executeWebhook.mockResolvedValueOnce({
				responseCode: 200,
				data: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
				headers: { 'content-type': 'image/svg+xml' },
			});

			await handler(req(), res);

			expect(res.setHeader).toHaveBeenCalledWith('content-type', 'image/svg+xml');
			expect(res.setHeader).toHaveBeenCalledWith('Content-Security-Policy', sandboxCSP);
		});

		it('should sandbox a legacy string response without headers', async () => {
			const res = createResponse();
			webhookManager.executeWebhook.mockResolvedValueOnce({
				responseCode: 200,
				data: '<script>alert(1)</script>',
			});

			await handler(req(), res);

			expect(res.setHeader).toHaveBeenCalledWith('Content-Security-Policy', sandboxCSP);
			expect(res.send).toHaveBeenCalledWith('<script>alert(1)</script>');
		});
	});
});
