import { createWorkflow, mockInstance, testDb } from '@n8n/backend-test-utils';
import type { User } from '@n8n/db';

import { TestWebhooks } from '@/webhooks/test-webhooks';

import { createMember, createOwner } from './shared/db/users';
import { setupTestServer } from './shared/utils';

describe('TestWebhooksController', () => {
	const testWebhooks = mockInstance(TestWebhooks);
	const testServer = setupTestServer({ endpointGroups: ['test-webhooks'] });

	let owner: User;
	let member: User;

	beforeAll(async () => {
		owner = await createOwner();
		member = await createMember();
	});

	beforeEach(async () => {
		jest.resetAllMocks();
		await testDb.truncate(['WorkflowEntity', 'SharedWorkflow']);
	});

	describe('DELETE /test-webhook/:workflowId', () => {
		test('should reject unauthenticated requests', async () => {
			const workflow = await createWorkflow({}, owner);

			await testServer.authlessAgent.delete(`/test-webhook/${workflow.id}`).expect(401);

			expect(testWebhooks.cancelWebhook).not.toHaveBeenCalled();
		});

		test('should reject users without access to the workflow', async () => {
			const workflow = await createWorkflow({}, owner);

			await testServer.authAgentFor(member).delete(`/test-webhook/${workflow.id}`).expect(403);

			expect(testWebhooks.cancelWebhook).not.toHaveBeenCalled();
		});

		test('should cancel the test webhook for the workflow owner', async () => {
			const workflow = await createWorkflow({}, member);
			testWebhooks.cancelWebhook.mockResolvedValue(true);

			const response = await testServer
				.authAgentFor(member)
				.delete(`/test-webhook/${workflow.id}`)
				.expect(200);

			expect(response.body).toEqual({ data: true });
			expect(testWebhooks.cancelWebhook).toHaveBeenCalledWith(workflow.id);
		});
	});
});
