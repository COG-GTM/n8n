import { GlobalConfig } from '@n8n/config';
import { Container } from '@n8n/di';
import { NodeTestHarness } from '@nodes-testing/node-test-harness';
import type { Request, Response } from 'express';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import { mock } from 'jest-mock-extended';
import type { IWebhookFunctions } from 'n8n-workflow';
import { PassThrough } from 'stream';
import * as tmp from 'tmp-promise';

import { Webhook } from '../Webhook.node';

jest.mock('fs/promises');
jest.mock('tmp-promise', () => {
	const actual = jest.requireActual<typeof import('tmp-promise')>('tmp-promise');
	return { ...actual, file: jest.fn(actual.file) };
});
const mockFs = jest.mocked(fs);

describe('Test Webhook Node', () => {
	new NodeTestHarness().setupTests();

	describe('handleFormData', () => {
		const node = new Webhook();
		const context = mock<IWebhookFunctions>({
			nodeHelpers: mock(),
		});
		context.getNodeParameter.calledWith('options').mockReturnValue({});
		context.getNode.calledWith().mockReturnValue({
			type: 'n8n-nodes-base.webhook',
			typeVersion: 1.1,
		} as any);
		const req = mock<Request>();
		req.contentType = 'multipart/form-data';
		context.getRequestObject.mockReturnValue(req);

		it('should handle when no files are present', async () => {
			req.body = {
				files: {},
			};
			const returnData = await node.webhook(context);
			expect(returnData.workflowData?.[0][0].binary).toBeUndefined();
			expect(context.nodeHelpers.copyBinaryFile).not.toHaveBeenCalled();
		});

		it('should handle when files are present', async () => {
			req.body = {
				files: { file1: { filepath: '/tmp/test.txt' } },
			};
			const returnData = await node.webhook(context);
			expect(returnData.workflowData?.[0][0].binary).not.toBeUndefined();
			expect(context.nodeHelpers.copyBinaryFile).toHaveBeenCalled();
			expect(mockFs.rm).toHaveBeenCalledWith('/tmp/test.txt', { force: true });
		});
	});

	describe('streaming response mode', () => {
		const node = new Webhook();
		const context = mock<IWebhookFunctions>({
			nodeHelpers: mock(),
		});
		const req = mock<Request>();
		const res = mock<Response>();

		beforeEach(() => {
			jest.clearAllMocks();
			context.getRequestObject.mockReturnValue(req);
			context.getResponseObject.mockReturnValue(res);
			context.getChildNodes.mockReturnValue([]);
			context.getNode.mockReturnValue({
				type: 'n8n-nodes-base.webhook',
				typeVersion: 2,
				name: 'Webhook',
			} as any);
			context.getNodeParameter.mockImplementation((paramName: string) => {
				if (paramName === 'options') return {};
				if (paramName === 'responseMode') return 'streaming';
				return undefined;
			});
			req.headers = {};
			req.params = {};
			req.query = {};
			req.body = { message: 'test' };
			Object.defineProperty(req, 'ips', { value: [], configurable: true });
			Object.defineProperty(req, 'ip', { value: '127.0.0.1', configurable: true });
			res.writeHead.mockImplementation(() => res);
			res.flushHeaders.mockImplementation(() => undefined);
		});

		it('should enable streaming when responseMode is "streaming"', async () => {
			const result = await node.webhook(context);

			// Verify streaming headers are set
			expect(res.writeHead).toHaveBeenCalledWith(200, {
				'Content-Type': 'application/json; charset=utf-8',
				'Transfer-Encoding': 'chunked',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			});
			expect(res.flushHeaders).toHaveBeenCalled();

			// Verify response structure for streaming
			expect(result).toEqual({
				noWebhookResponse: true,
				workflowData: expect.any(Array),
			});
		});

		it('should not enable streaming when responseMode is not "streaming"', async () => {
			context.getNodeParameter.mockImplementation((paramName: string) => {
				if (paramName === 'options') return {};
				if (paramName === 'responseMode') return 'onReceived';
				return undefined;
			});

			const result = await node.webhook(context);

			// Verify streaming headers are NOT set
			expect(res.writeHead).not.toHaveBeenCalled();
			expect(res.flushHeaders).not.toHaveBeenCalled();

			// Verify normal response structure
			expect(result).toEqual({
				webhookResponse: undefined,
				workflowData: expect.any(Array),
			});
		});

		it('should handle multipart form data with streaming enabled', async () => {
			req.contentType = 'multipart/form-data';
			req.body = {
				data: { message: 'Hello' },
				files: {},
			};

			const result = await node.webhook(context);

			// For multipart form data, streaming is handled in handleFormData method
			// The current implementation returns normal workflowData for form data
			expect(result).toEqual({
				workflowData: expect.any(Array),
			});
		});
	});

	describe('binary data size limit', () => {
		const node = new Webhook();
		const context = mock<IWebhookFunctions>({ nodeHelpers: mock() });
		const res = mock<Response>();
		const endpoints = Container.get(GlobalConfig).endpoints;
		const originalLimit = endpoints.formDataFileSizeMax;
		const limitBytes = 1024;

		const createRequest = (size: number) => {
			const req = new PassThrough() as unknown as Request;
			Object.assign(req, {
				method: 'POST',
				headers: {},
				params: {},
				query: {},
				body: undefined,
				contentType: 'application/octet-stream',
			});
			Object.defineProperty(req, 'ips', { value: [], configurable: true });
			Object.defineProperty(req, 'ip', { value: '127.0.0.1', configurable: true });
			(req as unknown as PassThrough).end(Buffer.alloc(size, 1));
			return req;
		};

		const lastTmpFilePath = async () => {
			const results = jest.mocked(tmp.file).mock.results;
			const { path } = (await results[results.length - 1].value) as tmp.FileResult;
			return path;
		};

		beforeEach(() => {
			jest.clearAllMocks();
			endpoints.formDataFileSizeMax = limitBytes / (1024 * 1024);
			Object.defineProperty(res, 'headersSent', { value: false, configurable: true });
			context.getResponseObject.mockReturnValue(res);
			context.getChildNodes.mockReturnValue([]);
			context.getNode.mockReturnValue({
				type: 'n8n-nodes-base.webhook',
				typeVersion: 2,
				name: 'Webhook',
			} as any);
			context.getNodeParameter.mockImplementation((paramName: string) => {
				if (paramName === 'options') return {};
				if (paramName === 'responseMode') return 'onReceived';
				return undefined;
			});
		});

		afterAll(() => {
			endpoints.formDataFileSizeMax = originalLimit;
		});

		it('should reject a binary body larger than the limit with 413 and remove the temp file', async () => {
			context.getRequestObject.mockReturnValue(createRequest(limitBytes + 1));

			const result = await node.webhook(context);

			expect(result).toEqual({ noWebhookResponse: true });
			expect(res.writeHead).toHaveBeenCalledWith(
				413,
				expect.objectContaining({ Connection: 'close' }),
			);
			expect(res.end).toHaveBeenCalledWith(expect.stringContaining('maximum allowed size'));
			expect(context.nodeHelpers.copyBinaryFile).not.toHaveBeenCalled();
			expect(existsSync(await lastTmpFilePath())).toBe(false);
		});

		it('should reject an oversized body when the binaryData option is enabled', async () => {
			context.getNodeParameter.mockImplementation((paramName: string) => {
				if (paramName === 'options') return { binaryData: true };
				if (paramName === 'responseMode') return 'onReceived';
				return undefined;
			});
			context.getRequestObject.mockReturnValue(createRequest(limitBytes * 4));

			const result = await node.webhook(context);

			expect(result).toEqual({ noWebhookResponse: true });
			expect(res.writeHead).toHaveBeenCalledWith(413, expect.anything());
			expect(context.nodeHelpers.copyBinaryFile).not.toHaveBeenCalled();
		});

		it('should accept a binary body within the limit', async () => {
			mockFs.stat.mockResolvedValue({ size: limitBytes } as any);
			context.getRequestObject.mockReturnValue(createRequest(limitBytes));

			const result = await node.webhook(context);

			expect(res.writeHead).not.toHaveBeenCalled();
			expect(context.nodeHelpers.copyBinaryFile).toHaveBeenCalledWith(
				await lastTmpFilePath(),
				expect.any(String),
				'application/octet-stream',
			);
			expect(result.workflowData?.[0][0].binary).toHaveProperty('data');
		});
	});
});
