import {
	createTestMigrationContext,
	initDbUpToMigration,
	runSingleMigration,
	undoLastSingleMigration,
	type TestMigrationContext,
} from '@n8n/backend-test-utils';
import { DbConnection } from '@n8n/db';
import { Container } from '@n8n/di';
import { DataSource } from '@n8n/typeorm';

const MIGRATION_NAME = 'AddExecutionStartedOrCreatedAtIndex1763700000000';

// The migration is registered for Postgres only, so on other databases these tests are no-ops.
const isPostgres = process.env.DB_TYPE === 'postgresdb';

describe('AddExecutionStartedOrCreatedAtIndex Migration', () => {
	let dataSource: DataSource;
	let context: TestMigrationContext;

	beforeAll(async () => {
		if (!isPostgres) return;

		const dbConnection = Container.get(DbConnection);
		await dbConnection.init();

		dataSource = Container.get(DataSource);

		await initDbUpToMigration(MIGRATION_NAME);
		context = createTestMigrationContext(dataSource);
	});

	afterAll(async () => {
		if (!isPostgres) return;

		await Container.get(DbConnection).close();
	});

	const indexName = () => `IDX_${context.tablePrefix}execution_entity_started_or_created_at`;

	async function indexExists(): Promise<boolean> {
		const rows: unknown[] = await context.queryRunner.query(
			'SELECT 1 FROM pg_indexes WHERE indexname = $1',
			[indexName()],
		);
		return rows.length === 1;
	}

	it('creates the index on up and drops it on down', async () => {
		if (!isPostgres) return;

		expect(await indexExists()).toBe(false);

		await runSingleMigration(MIGRATION_NAME);
		context = createTestMigrationContext(dataSource);
		expect(await indexExists()).toBe(true);

		await undoLastSingleMigration();
		context = createTestMigrationContext(dataSource);
		expect(await indexExists()).toBe(false);
	});

	it('is used by the executions list ordering', async () => {
		if (!isPostgres) return;

		await runSingleMigration(MIGRATION_NAME);
		context = createTestMigrationContext(dataSource);

		const table = context.escape.tableName('execution_entity');
		await context.queryRunner.query('SET enable_seqscan = off');
		const plan: Array<Record<string, string>> = await context.queryRunner.query(
			`EXPLAIN SELECT "execution"."id" FROM ${table} "execution"
			WHERE "execution"."deletedAt" IS NULL
			ORDER BY COALESCE("execution"."startedAt", "execution"."createdAt") DESC LIMIT 50`,
		);

		await context.queryRunner.query('RESET enable_seqscan');

		expect(plan.map((row) => row['QUERY PLAN']).join('\n')).toContain(indexName());
	});
});
