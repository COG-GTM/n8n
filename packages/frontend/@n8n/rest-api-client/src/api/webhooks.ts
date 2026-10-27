import type { IHttpRequestMethods } from 'n8n-workflow';

import type { IRestApiContext } from '../types';
import { makeRestApiRequest } from '../utils';

/**
 * `workflowId` and `node` are only returned when the current user can read the
 * workflow that owns the webhook.
 */
export type WebhookData = {
	workflowId?: string;
	webhookPath: string;
	method: IHttpRequestMethods;
	node?: string;
};

export const findWebhook = async (
	context: IRestApiContext,
	data: { path: string; method: string },
): Promise<WebhookData | null> => {
	return await makeRestApiRequest(context, 'POST', '/webhooks/find', data);
};
