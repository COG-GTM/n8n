import type { FindWebhookResponse } from '@n8n/api-types';
import { AuthenticatedRequest } from '@n8n/db';
import { Post, RestController } from '@n8n/decorators';

import { WorkflowFinderService } from '@/workflows/workflow-finder.service';

import { WebhookService } from './webhook.service';
import type { Method } from './webhook.types';

const WEBHOOK_METHODS: readonly Method[] = ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'];

const isWebhookMethod = (method: unknown): method is Method =>
	typeof method === 'string' && WEBHOOK_METHODS.some((m) => m === method);

@RestController('/webhooks')
export class WebhooksController {
	constructor(
		private readonly webhookService: WebhookService,
		private readonly workflowFinderService: WorkflowFinderService,
	) {}

	/**
	 * Check whether a webhook path and method is already registered.
	 * The owning workflow and node are only disclosed to users who can read that workflow.
	 */
	@Post('/find')
	async findWebhook(
		req: AuthenticatedRequest<{}, {}, { path?: unknown; method?: unknown }>,
	): Promise<FindWebhookResponse | null> {
		const { path, method } = req.body ?? {};
		if (typeof path !== 'string' || !isWebhookMethod(method)) return null;

		try {
			const webhook = await this.webhookService.findWebhook(method, path);
			if (!webhook) return null;

			const workflow = await this.workflowFinderService.findWorkflowForUser(
				webhook.workflowId,
				req.user,
				['workflow:read'],
			);

			if (!workflow) return { webhookPath: path, method: webhook.method };

			return {
				workflowId: webhook.workflowId,
				webhookPath: webhook.webhookPath,
				method: webhook.method,
				node: webhook.node,
			};
		} catch {
			return null;
		}
	}
}
