import { ExpressionError } from '../src/errors/expression.error';
import {
	createEnvProvider,
	createEnvProviderState,
	filterSensitiveEnvVars,
	getWorkflowAccessibleEnv,
	isEnvAccessBlockedByConfig,
	isSensitiveEnvVar,
} from '../src/workflow-data-proxy-env-provider';

const SENSITIVE_ENV_VARS = {
	N8N_ENCRYPTION_KEY: 'encryption-key',
	N8N_ENCRYPTION_KEY_FILE: '/run/secrets/encryption-key',
	DB_POSTGRESDB_PASSWORD: 'pg-password',
	DB_POSTGRESDB_PASSWORD_FILE: '/run/secrets/pg-password',
	DB_POSTGRESDB_SSL_KEY: 'pg-ssl-key',
	DB_POSTGRESDB_SSL_CA: 'pg-ssl-ca',
	DB_MYSQLDB_PASSWORD: 'mysql-password',
	QUEUE_BULL_REDIS_PASSWORD: 'redis-password',
	N8N_RUNNERS_AUTH_TOKEN: 'runner-token',
	N8N_USER_MANAGEMENT_JWT_SECRET: 'jwt-secret',
	N8N_SMTP_PASS: 'smtp-password',
	N8N_SMTP_OAUTH_PRIVATE_KEY: 'smtp-private-key',
	N8N_LICENSE_ACTIVATION_KEY: 'license-key',
	N8N_LICENSE_CERT: 'license-cert',
	N8N_SSL_KEY: 'ssl-key',
	N8N_EXTERNAL_STORAGE_S3_ACCESS_SECRET: 's3-secret',
	CREDENTIALS_OVERWRITE_DATA: '{"githubApi":{"accessToken":"x"}}',
	CREDENTIALS_OVERWRITE_ENDPOINT_AUTH_TOKEN: 'overwrite-token',
	CREDENTIALS_OVERWRITE_ENDPOINT: 'send-credentials',
};

const NON_SENSITIVE_ENV_VARS = {
	MY_API_URL: 'https://example.com',
	MY_SERVICE_API_KEY: 'user-provided-key',
	N8N_PORT: '5678',
	N8N_REDIS_KEY_PREFIX: 'n8n',
	DB_TYPE: 'postgresdb',
};

describe('workflow-data-proxy-env-provider', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv, ...SENSITIVE_ENV_VARS, ...NON_SENSITIVE_ENV_VARS };
		delete process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE;
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe('isEnvAccessBlockedByConfig', () => {
		it('should block env access when N8N_BLOCK_ENV_ACCESS_IN_NODE is not set', () => {
			expect(isEnvAccessBlockedByConfig()).toBe(true);
		});

		it.each(['', 'true', '1', 'yes', 'no'])(
			'should block env access when N8N_BLOCK_ENV_ACCESS_IN_NODE is "%s"',
			(value) => {
				process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE = value;
				expect(isEnvAccessBlockedByConfig()).toBe(true);
			},
		);

		it.each(['false', 'FALSE', ' false '])(
			'should allow env access when N8N_BLOCK_ENV_ACCESS_IN_NODE is "%s"',
			(value) => {
				process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE = value;
				expect(isEnvAccessBlockedByConfig()).toBe(false);
			},
		);
	});

	describe('isSensitiveEnvVar', () => {
		it.each(Object.keys(SENSITIVE_ENV_VARS))('should treat %s as sensitive', (name) => {
			expect(isSensitiveEnvVar(name)).toBe(true);
		});

		it.each(Object.keys(NON_SENSITIVE_ENV_VARS))('should not treat %s as sensitive', (name) => {
			expect(isSensitiveEnvVar(name)).toBe(false);
		});
	});

	describe('filterSensitiveEnvVars', () => {
		it('should drop sensitive and undefined env vars', () => {
			expect(
				filterSensitiveEnvVars({
					...SENSITIVE_ENV_VARS,
					...NON_SENSITIVE_ENV_VARS,
					UNSET: undefined,
				}),
			).toEqual(NON_SENSITIVE_ENV_VARS);
		});
	});

	describe('getWorkflowAccessibleEnv', () => {
		it('should return no env vars by default', () => {
			expect(getWorkflowAccessibleEnv()).toEqual({});
		});

		it('should never return sensitive env vars when env access is allowed', () => {
			process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE = 'false';

			const env = getWorkflowAccessibleEnv();

			expect(env).toMatchObject(NON_SENSITIVE_ENV_VARS);
			for (const name of Object.keys(SENSITIVE_ENV_VARS)) {
				expect(env).not.toHaveProperty(name);
			}
		});

		it('should return a copy, not process.env itself', () => {
			process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE = 'false';
			expect(getWorkflowAccessibleEnv()).not.toBe(process.env);
		});
	});

	describe('createEnvProviderState', () => {
		it('should block env access by default', () => {
			expect(createEnvProviderState()).toEqual({
				isProcessAvailable: true,
				isEnvAccessBlocked: true,
				env: {},
			});
		});

		it('should block env access when N8N_BLOCK_ENV_ACCESS_IN_NODE is set to "true"', () => {
			process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE = 'true';

			expect(createEnvProviderState()).toEqual({
				isProcessAvailable: true,
				isEnvAccessBlocked: true,
				env: {},
			});
		});

		it('should expose non-sensitive env vars only when N8N_BLOCK_ENV_ACCESS_IN_NODE is "false"', () => {
			process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE = 'false';

			const state = createEnvProviderState();

			expect(state.isProcessAvailable).toBe(true);
			expect(state.isEnvAccessBlocked).toBe(false);
			expect(state.env).toMatchObject(NON_SENSITIVE_ENV_VARS);
			for (const name of Object.keys(SENSITIVE_ENV_VARS)) {
				expect(state.env).not.toHaveProperty(name);
			}
		});

		it('should handle process not being available', () => {
			const originalProcess = global.process;
			try {
				// @ts-expect-error process is read-only
				global.process = undefined;

				expect(createEnvProviderState()).toEqual({
					isProcessAvailable: false,
					isEnvAccessBlocked: false,
					env: {},
				});
			} finally {
				global.process = originalProcess;
			}
		});
	});

	describe('createEnvProvider', () => {
		it('should return true when checking for a property using "has"', () => {
			const proxy = createEnvProvider(0, 0, createEnvProviderState());
			expect('someProperty' in proxy).toBe(true);
		});

		it('should return the value from process.env if access is allowed', () => {
			process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE = 'false';
			process.env.TEST_ENV_VAR = 'test_value';
			const proxy = createEnvProvider(0, 0, createEnvProviderState());
			expect(proxy.TEST_ENV_VAR).toBe('test_value');
		});

		it('should not return sensitive env vars even if access is allowed', () => {
			process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE = 'false';
			const proxy = createEnvProvider(0, 0, createEnvProviderState());

			expect(proxy.N8N_ENCRYPTION_KEY).toBeUndefined();
			expect(proxy.DB_POSTGRESDB_PASSWORD).toBeUndefined();
			expect(proxy.N8N_RUNNERS_AUTH_TOKEN).toBeUndefined();
		});

		it('should not return sensitive env vars from a provider state that contains them', () => {
			const proxy = createEnvProvider(0, 0, {
				isProcessAvailable: true,
				isEnvAccessBlocked: false,
				env: { N8N_ENCRYPTION_KEY: 'encryption-key', MY_API_URL: 'https://example.com' },
			});

			expect(proxy.N8N_ENCRYPTION_KEY).toBeUndefined();
			expect(proxy.MY_API_URL).toBe('https://example.com');
		});

		it('should throw ExpressionError when process is unavailable', () => {
			vi.useFakeTimers({ now: new Date() });

			const originalProcess = global.process;
			try {
				// @ts-expect-error process is read-only
				global.process = undefined;
				const proxy = createEnvProvider(1, 1, createEnvProviderState());

				expect(() => proxy.someEnvVar).toThrowError(
					new ExpressionError('not accessible via UI, please run node', {
						runIndex: 1,
						itemIndex: 1,
					}),
				);
			} finally {
				global.process = originalProcess;
				vi.useRealTimers();
			}
		});

		it.each([undefined, 'true'])(
			'should throw ExpressionError when N8N_BLOCK_ENV_ACCESS_IN_NODE is %s',
			(value) => {
				vi.useFakeTimers({ now: new Date() });

				try {
					if (value !== undefined) process.env.N8N_BLOCK_ENV_ACCESS_IN_NODE = value;
					const proxy = createEnvProvider(1, 1, createEnvProviderState());

					expect(() => proxy.N8N_ENCRYPTION_KEY).toThrowError(
						new ExpressionError('access to env vars denied', {
							causeDetailed:
								'If you need access please contact the administrator to set the environment variable ‘N8N_BLOCK_ENV_ACCESS_IN_NODE=false‘',
							runIndex: 1,
							itemIndex: 1,
						}),
					);
				} finally {
					vi.useRealTimers();
				}
			},
		);
	});
});
