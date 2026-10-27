import { ConflictError } from '@/errors/response-errors/conflict.error';

/**
 * Thrown when resuming an execution that is no longer `new` or `waiting`,
 * e.g. because a concurrent request or the wait tracker already resumed it.
 */
export class ExecutionAlreadyResumedError extends ConflictError {
	constructor(executionId: string) {
		super(`The execution "${executionId}" is running already.`);
	}
}
