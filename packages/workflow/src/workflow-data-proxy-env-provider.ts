import { ExpressionError } from './errors/expression.error';

export type EnvProviderState = {
	isProcessAvailable: boolean;
	isEnvAccessBlocked: boolean;
	env: Record<string, string>;
};

const ENV_ACCESS_SETTING = 'N8N_BLOCK_ENV_ACCESS_IN_NODE';

/**
 * Env access from expressions and the Code node is blocked unless the
 * operator explicitly opts in with `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`.
 */
export function isEnvAccessBlockedByConfig(): boolean {
	if (typeof process === 'undefined') return false;
	return process.env[ENV_ACCESS_SETTING]?.trim().toLowerCase() !== 'false';
}

const N8N_OWNED_ENV_PREFIX = /^(N8N_|DB_|QUEUE_BULL_REDIS_|CREDENTIALS_OVERWRITE_)/;
const SENSITIVE_ENV_NAME = /(PASS|SECRET|TOKEN|_KEY$|_CERT|_CA$|CREDENTIALS_OVERWRITE_DATA$)/;

/**
 * Whether an env var holds one of n8n's own secrets (encryption key, DB and
 * Redis passwords, runner/JWT tokens, SMTP/SSL/license material, credential
 * overwrites, including their `_FILE` variants). These are never exposed to
 * workflows, even when env access is enabled.
 */
export function isSensitiveEnvVar(name: string): boolean {
	const normalized = name.toUpperCase().replace(/_FILE$/, '');
	return N8N_OWNED_ENV_PREFIX.test(normalized) && SENSITIVE_ENV_NAME.test(normalized);
}

export function filterSensitiveEnvVars(
	env: Record<string, string | undefined>,
): Record<string, string> {
	const filtered: Record<string, string> = {};
	for (const [name, value] of Object.entries(env)) {
		if (value === undefined || isSensitiveEnvVar(name)) continue;
		filtered[name] = value;
	}
	return filtered;
}

/**
 * Returns the env vars that workflows (expressions and Code node) may read:
 * empty when env access is blocked, otherwise `process.env` without n8n's own secrets.
 */
export function getWorkflowAccessibleEnv(): Record<string, string> {
	if (typeof process === 'undefined' || isEnvAccessBlockedByConfig()) return {};
	return filterSensitiveEnvVars(process.env);
}

/**
 * Captures a snapshot of the environment variables and configuration
 * that can be used to initialize an environment provider.
 */
export function createEnvProviderState(): EnvProviderState {
	const isProcessAvailable = typeof process !== 'undefined';
	const isEnvAccessBlocked = isEnvAccessBlockedByConfig();

	return {
		isProcessAvailable,
		isEnvAccessBlocked,
		env: getWorkflowAccessibleEnv(),
	};
}

/**
 * Creates a proxy that provides access to the environment variables
 * in the `WorkflowDataProxy`. Use the `createEnvProviderState` to
 * create the default state object that is needed for the proxy,
 * unless you need something specific.
 *
 * @example
 * createEnvProvider(
 *   runIndex,
 *   itemIndex,
 *   createEnvProviderState(),
 * )
 */
export function createEnvProvider(
	runIndex: number,
	itemIndex: number,
	providerState: EnvProviderState,
): Record<string, string> {
	return new Proxy(
		{},
		{
			has() {
				return true;
			},

			get(_, name) {
				if (name === 'isProxy') return true;

				if (!providerState.isProcessAvailable) {
					throw new ExpressionError('not accessible via UI, please run node', {
						runIndex,
						itemIndex,
					});
				}
				if (providerState.isEnvAccessBlocked) {
					throw new ExpressionError('access to env vars denied', {
						causeDetailed:
							'If you need access please contact the administrator to set the environment variable ‘N8N_BLOCK_ENV_ACCESS_IN_NODE=false‘',
						runIndex,
						itemIndex,
					});
				}

				const envVarName = name.toString();
				if (isSensitiveEnvVar(envVarName)) return undefined;

				return providerState.env[envVarName];
			},
		},
	);
}
