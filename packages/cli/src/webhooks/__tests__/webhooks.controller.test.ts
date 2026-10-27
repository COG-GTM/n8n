import type { AuthenticatedRequest, User, WorkflowEntity } from '@n8n/db';
import { WebhookEntity } from '@n8n/db';
import { mock } from 'jest-mock-extended';

import type { WorkflowFinderService } from '@/workflows/workflow-finder.service';

import type { WebhookService } from '../webhook.service';
import { WebhooksController } from '../webhooks.controller';

describe('WebhooksController', () => {
	const webhookService = mock<WebhookService>();
	const workflowFinderService = mock<WorkflowFinderService>();
	const controller = new WebhooksController(webhookService, workflowFinderService);

	const user = mock<User>({ id: 'member-id' });
	const webhook = Object.assign(new WebhookEntity(), {
		workflowId: 'private-workflow-id',
		webhookPath: 'finance-export',
		method: 'POST',
		node: 'Finance Webhook',
		webhookId: 'abc',
	});

	const makeRequest = (body: unknown) =>
		mock<AuthenticatedRequest<{}, {}, { path?: unknown; method?: unknown }>>({
			user,
			body: body as { path?: unknown; method?: unknown },
		});

	beforeEach(() => {
		jest.resetAllMocks();
	});

	describe('findWebhook', () => {
		it('returns null when no webhook matches', async () => {
			webhookService.findWebhook.mockResolvedValue(null);

			const result = await controller.findWebhook(
				makeRequest({ path: 'unused', method: 'POST' }),
			);

			expect(result).toBeNull();
			expect(workflowFinderService.findWorkflowForUser).not.toHaveBeenCalled();
		});

		it('returns workflow id and node when the user can read the owning workflow', async () => {
			webhookService.findWebhook.mockResolvedValue(webhook);
			workflowFinderService.findWorkflowForUser.mockResolvedValue(mock<WorkflowEntity>());

			const result = await controller.findWebhook(
				makeRequest({ path: 'finance-export', method: 'POST' }),
			);

			expect(workflowFinderService.findWorkflowForUser).toHaveBeenCalledWith(
				'private-workflow-id',
				user,
				['workflow:read'],
			);
			expect(result).toEqual({
				workflowId: 'private-workflow-id',
				webhookPath: 'finance-export',
				method: 'POST',
				node: 'Finance Webhook',
			});
		});

		it('does not disclose workflow id or node when the user cannot read the owning workflow', async () => {
			webhookService.findWebhook.mockResolvedValue(webhook);
			workflowFinderService.findWorkflowForUser.mockResolvedValue(null);

			const result = await controller.findWebhook(
				makeRequest({ path: 'finance-export', method: 'POST' }),
			);

			expect(result).toEqual({ webhookPath: 'finance-export', method: 'POST' });
			expect(result).not.toHaveProperty('workflowId');
			expect(result).not.toHaveProperty('node');
		});

		it('echoes the requested path instead of the stored dynamic path for inaccessible workflows', async () => {
			webhookService.findWebhook.mockResolvedValue(
				Object.assign(new WebhookEntity(), {
					...webhook,
					webhookPath: 'user/:id',
					webhookId: 'secret-webhook-id',
				}),
			);
			workflowFinderService.findWorkflowForUser.mockResolvedValue(null);

			const result = await controller.findWebhook(
				makeRequest({ path: 'secret-webhook-id/user/123', method: 'POST' }),
			);

			expect(result).toEqual({ webhookPath: 'secret-webhook-id/user/123', method: 'POST' });
		});

		it.each([
			{},
			{ path: 'finance-export' },
			{ path: 'finance-export', method: 'OPTIONS' },
			{ path: ['finance-export'], method: 'POST' },
			{ path: 'finance-export', method: { $ne: null } },
		])('returns null without a lookup for invalid body %j', async (body) => {
			const result = await controller.findWebhook(makeRequest(body));

			expect(result).toBeNull();
			expect(webhookService.findWebhook).not.toHaveBeenCalled();
		});

		it('returns null when the lookup throws', async () => {
			webhookService.findWebhook.mockRejectedValue(new Error('db down'));

			const result = await controller.findWebhook(
				makeRequest({ path: 'finance-export', method: 'POST' }),
			);

			expect(result).toBeNull();
			expect(workflowFinderService.findWorkflowForUser).not.toHaveBeenCalled();
		});
	});
});
