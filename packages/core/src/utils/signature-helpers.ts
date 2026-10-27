import crypto from 'crypto';

/**
 * Generate signature token from url and secret
 */
export function generateUrlSignature(url: string, secret: string) {
	const token = crypto.createHmac('sha256', secret).update(url).digest('hex');
	return token;
}

/**
 * Prepare url for signing
 */
export function prepareUrlForSigning(url: URL) {
	return `${url.host}${url.pathname}${url.search}`;
}

const WAITING_EXECUTION_TOKEN_SEPARATOR = '-';

/**
 * Generate the unguessable token that authorizes requests to the
 * waiting-webhook and waiting-form URLs of an execution
 */
export function generateWaitingExecutionToken(executionId: string, secret: string) {
	return crypto.createHmac('sha256', secret).update(`waiting-execution:${executionId}`).digest('hex');
}

/**
 * Build the path segment used in resume URLs, e.g. `123-<token>`
 */
export function buildWaitingExecutionPath(executionId: string, token?: string) {
	return token ? `${executionId}${WAITING_EXECUTION_TOKEN_SEPARATOR}${token}` : executionId;
}

/**
 * Split a resume URL path segment into the execution id and its token
 */
export function parseWaitingExecutionPath(path: string): { executionId: string; token?: string } {
	const separatorIndex = path.lastIndexOf(WAITING_EXECUTION_TOKEN_SEPARATOR);
	if (separatorIndex <= 0) return { executionId: path };
	return {
		executionId: path.slice(0, separatorIndex),
		token: path.slice(separatorIndex + 1),
	};
}

/**
 * Constant-time check that `token` is the waiting token for `executionId`
 */
export function isValidWaitingExecutionToken(
	executionId: string,
	token: string | undefined,
	secret: string,
) {
	if (!token) return false;
	const expected = Buffer.from(generateWaitingExecutionToken(executionId, secret));
	const actual = Buffer.from(token);
	return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
