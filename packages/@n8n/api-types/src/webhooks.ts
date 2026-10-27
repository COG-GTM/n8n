import type { IHttpRequestMethods } from 'n8n-workflow';

/**
 * Response of `POST /rest/webhooks/find`. `workflowId` and `node` are only
 * included when the current user can read the workflow that owns the webhook.
 */
export type FindWebhookResponse =
	| {
			workflowId: string;
			webhookPath: string;
			method: IHttpRequestMethods;
			node: string;
	  }
	| {
			workflowId?: never;
			webhookPath: string;
			method: IHttpRequestMethods;
			node?: never;
	  };
