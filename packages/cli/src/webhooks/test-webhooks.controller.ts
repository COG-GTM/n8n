import { AuthenticatedRequest } from '@n8n/db';
import { Delete, ProjectScope, RestController } from '@n8n/decorators';

import { TestWebhooks } from './test-webhooks';

@RestController('/test-webhook')
export class TestWebhooksController {
	constructor(private readonly testWebhooks: TestWebhooks) {}

	@Delete('/:workflowId')
	@ProjectScope('workflow:execute')
	async cancelWebhook(req: AuthenticatedRequest<{ workflowId: string }>) {
		return await this.testWebhooks.cancelWebhook(req.params.workflowId);
	}
}
