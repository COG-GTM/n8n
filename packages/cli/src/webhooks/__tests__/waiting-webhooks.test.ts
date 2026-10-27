import type { IExecutionResponse, ExecutionRepository } from '@n8n/db';
import type express from 'express';
import { mock } from 'jest-mock-extended';
import type { InstanceSettings } from 'n8n-core';
import {
	generateUrlSignature,
	generateWaitingExecutionToken,
	prepareUrlForSigning,
	WAITING_TOKEN_QUERY_PARAM,
} from 'n8n-core';

import { ConflictError } from '@/errors/response-errors/conflict.error';
import { NotFoundError } from '@/errors/response-errors/not-found.error';
import { WaitingWebhooks } from '@/webhooks/waiting-webhooks';
import type { WaitingWebhookRequest } from '@/webhooks/webhook.types';

describe('WaitingWebhooks', () => {
	const SIGNING_SECRET = 'test-secret';
	const executionRepository = mock<ExecutionRepository>();
	const mockInstanceSettings = mock<InstanceSettings>({
		hmacSignatureSecret: SIGNING_SECRET,
	});
	const waitingWebhooks = new WaitingWebhooks(
		mock(),
		mock(),
		executionRepository,
		mock(),
		mockInstanceSettings,
	);

	const authorizedRequest = (executionId = '123') =>
		mock<WaitingWebhookRequest>({
			params: {
				path: `${executionId}-${generateWaitingExecutionToken(executionId, SIGNING_SECRET)}`,
			},
		});

	beforeEach(() => {
		jest.restoreAllMocks();
		executionRepository.findSingleExecution.mockReset();
	});

	describe('authorization', () => {
		it.each([
			['without a token', '123'],
			['with an invalid token', '123-invalid'],
			[
				'with the token of another execution',
				`123-${generateWaitingExecutionToken('124', SIGNING_SECRET)}`,
			],
		])('should throw NotFoundError %s without loading the execution', async (_, path) => {
			executionRepository.findSingleExecution.mockResolvedValue(
				mock<IExecutionResponse>({ status: 'waiting' }),
			);
			const req = mock<WaitingWebhookRequest>({
				url: `/webhook-waiting/${path}`,
				query: {},
				host: 'example.com',
				headers: { host: 'example.com' },
				params: { path },
			});
			const res = mock<express.Response>();

			await expect(waitingWebhooks.executeWebhook(req, res)).rejects.toThrowError(NotFoundError);

			expect(executionRepository.findSingleExecution).not.toHaveBeenCalled();
		});

		it('should accept a signed Send and Wait url', async () => {
			executionRepository.findSingleExecution.mockResolvedValue(undefined);
			const host = 'example.com';
			const signature = generateUrlSignature(
				prepareUrlForSigning(new URL('/webhook-waiting/123/node?approved=true', `http://${host}`)),
				SIGNING_SECRET,
			);
			const req = mock<WaitingWebhookRequest>({
				url: `/webhook-waiting/123/node?approved=true&${WAITING_TOKEN_QUERY_PARAM}=${signature}`,
				query: { approved: 'true', [WAITING_TOKEN_QUERY_PARAM]: signature },
				host,
				headers: { host },
				params: { path: '123', suffix: 'node' },
			});

			await expect(
				waitingWebhooks.executeWebhook(req, mock<express.Response>()),
			).rejects.toThrowError(NotFoundError);

			expect(executionRepository.findSingleExecution).toHaveBeenCalledWith(
				'123',
				expect.anything(),
			);
		});
	});

	it('should throw NotFoundError if there is no execution to resume', async () => {
		/**
		 * Arrange
		 */
		executionRepository.findSingleExecution.mockResolvedValue(undefined);

		/**
		 * Act
		 */
		const promise = waitingWebhooks.executeWebhook(authorizedRequest(), mock<express.Response>());

		/**
		 * Assert
		 */
		await expect(promise).rejects.toThrowError(NotFoundError);
	});

	it('should throw ConflictError if the execution to resume is already running', async () => {
		/**
		 * Arrange
		 */
		executionRepository.findSingleExecution.mockResolvedValue(
			mock<IExecutionResponse>({ status: 'running' }),
		);

		/**
		 * Act
		 */
		const promise = waitingWebhooks.executeWebhook(authorizedRequest(), mock<express.Response>());

		/**
		 * Assert
		 */
		await expect(promise).rejects.toThrowError(ConflictError);
	});

	it('should throw ConflictError if the execution to resume already finished', async () => {
		/**
		 * Arrange
		 */
		executionRepository.findSingleExecution.mockResolvedValue(
			mock<IExecutionResponse>({ finished: true, workflowData: { nodes: [] } }),
		);

		/**
		 * Act
		 */
		const promise = waitingWebhooks.executeWebhook(authorizedRequest(), mock<express.Response>());

		/**
		 * Assert
		 */
		await expect(promise).rejects.toThrowError(ConflictError);
	});

	describe('validateSignatureInRequest', () => {
		const EXAMPLE_HOST = 'example.com';
		const generateValidSignature = (host = EXAMPLE_HOST) =>
			generateUrlSignature(
				prepareUrlForSigning(new URL('/webhook/test', `http://${host}`)),
				SIGNING_SECRET,
			);

		const createMockRequest = (opts: { host?: string; signature: string }) =>
			mock<express.Request>({
				url: `/webhook/test?${WAITING_TOKEN_QUERY_PARAM}=` + opts.signature,
				host: opts.host ?? EXAMPLE_HOST,
				query: { [WAITING_TOKEN_QUERY_PARAM]: opts.signature },
				headers: { host: opts.host ?? EXAMPLE_HOST },
			});

		it('should validate signature correctly', () => {
			/* Arrange */
			const signature = generateValidSignature();
			const mockReq = createMockRequest({ signature });

			/* Act */
			const result = waitingWebhooks.validateSignatureInRequest(mockReq);

			/* Assert */
			expect(result).toBe(true);
		});

		it('should validate signature correctly when host contains a port', () => {
			/* Arrange */
			const signature = generateValidSignature('example.com:8080');
			const mockReq = createMockRequest({
				signature,
				host: 'example.com:8080',
			});

			/* Act */
			const result = waitingWebhooks.validateSignatureInRequest(mockReq);

			/* Assert */
			expect(result).toBe(true);
		});

		it('should validate signature correctly when n8n is behind a reverse proxy', () => {
			/* Arrange */
			const signature = generateValidSignature('proxy.example.com');
			const mockReq = mock<express.Request>({
				url: `/webhook/test?${WAITING_TOKEN_QUERY_PARAM}=` + signature,
				host: 'proxy.example.com',
				query: { [WAITING_TOKEN_QUERY_PARAM]: signature },
				headers: {
					host: 'localhost',
					// eslint-disable-next-line @typescript-eslint/naming-convention
					'x-forwarded-host': 'proxy.example.com',
				},
			});

			/* Act */
			const result = waitingWebhooks.validateSignatureInRequest(mockReq);

			/* Assert */
			expect(result).toBe(true);
		});

		it('should return false when signature is missing', () => {
			/* Arrange */
			const mockReq = mock<express.Request>({
				url: '/webhook/test',
				hostname: 'example.com',
				query: {},
			});

			/* Act */
			const result = waitingWebhooks.validateSignatureInRequest(mockReq);

			/* Assert */
			expect(result).toBe(false);
		});

		it('should return false when signature is empty', () => {
			/* Arrange */
			const mockReq = mock<express.Request>({
				url: `/webhook/test?${WAITING_TOKEN_QUERY_PARAM}=`,
				hostname: 'example.com',
				query: { [WAITING_TOKEN_QUERY_PARAM]: '' },
			});

			/* Act */
			const result = waitingWebhooks.validateSignatureInRequest(mockReq);

			/* Assert */
			expect(result).toBe(false);
		});

		it('should return false when signatures do not match', () => {
			/* Arrange */
			const wrongSignature = 'wrong-signature';
			const mockReq = createMockRequest({ signature: wrongSignature });

			/* Act */
			const result = waitingWebhooks.validateSignatureInRequest(mockReq);

			/* Assert */
			expect(result).toBe(false);
		});
	});
});
