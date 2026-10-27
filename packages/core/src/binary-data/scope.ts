import { BinaryDataScopeError } from '../errors/binary-data-scope.error';

export type BinaryDataScope = {
	workflowId: string;
	/** When known, the binary data must also belong to this execution. */
	executionId?: string;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEGACY_FILE_ID_REGEX =
	/^(\w+)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Placeholder execution id used when binary data is stored before the execution id is known. */
const TEMP_EXECUTION_ID = 'temp';

function isExecutionIdInScope(executionIdInFileId: string, scope: BinaryDataScope) {
	if (executionIdInFileId === TEMP_EXECUTION_ID) return true;
	if (scope.executionId === undefined) return /^\w+$/.test(executionIdInFileId);
	return executionIdInFileId === scope.executionId;
}

/**
 * Whether a binary data id points to a file stored for the given workflow
 * (and execution, if known), e.g.
 * `filesystem-v2:workflows/{workflowId}/executions/{executionId}/binary_data/{uuid}`.
 */
export function isBinaryDataIdInScope(binaryDataId: string, scope: BinaryDataScope) {
	const separatorIndex = binaryDataId.indexOf(':');
	if (separatorIndex === -1) return false;

	const mode = binaryDataId.slice(0, separatorIndex);
	const fileId = binaryDataId.slice(separatorIndex + 1);

	if (mode === 'filesystem-v2' || mode === 's3') {
		const segments = fileId.split('/');
		if (segments.length !== 6) return false;

		const [workflowsDir, workflowId, executionsDir, executionId, binaryDataDir, uuid] = segments;

		return (
			workflowsDir === 'workflows' &&
			workflowId === String(scope.workflowId) &&
			executionsDir === 'executions' &&
			isExecutionIdInScope(executionId, scope) &&
			binaryDataDir === 'binary_data' &&
			UUID_REGEX.test(uuid)
		);
	}

	if (mode === 'filesystem') {
		// legacy `{executionId}{uuid}` ids carry no workflow id, so they can only
		// be checked against a known execution id
		const executionId = fileId.match(LEGACY_FILE_ID_REGEX)?.[1];
		return scope.executionId !== undefined && executionId === scope.executionId;
	}

	return false;
}

export function assertBinaryDataIdInScope(binaryDataId: string, scope: BinaryDataScope) {
	if (!isBinaryDataIdInScope(binaryDataId, scope)) {
		throw new BinaryDataScopeError(binaryDataId, scope);
	}
}
