import type { FindWebhookResponse } from '@n8n/api-types';

import type { IRestApiContext } from '../types';
import { makeRestApiRequest } from '../utils';

export type WebhookData = FindWebhookResponse;

export const findWebhook = async (
	context: IRestApiContext,
	data: { path: string; method: string },
): Promise<WebhookData | null> => {
	return await makeRestApiRequest(context, 'POST', '/webhooks/find', data);
};
