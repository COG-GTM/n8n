import { UserError } from 'n8n-workflow';

export class BinaryDataScopeError extends UserError {
	constructor(binaryDataId: string, scope: { workflowId: string; executionId?: string }) {
		super('Binary data does not belong to this workflow execution', {
			extra: { binaryDataId, ...scope },
		});
	}
}
