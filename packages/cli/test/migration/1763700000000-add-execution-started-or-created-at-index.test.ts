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

		await context.queryRunner.release();
		await Container.get(DbConnection).close();
	});

	const indexName = () => `IDX_${context.tablePrefix}execution_entity_started_or_created_at`;

	// Uses the data source's pool rather than the context's query runner, so no connection is
	// held while the migration helpers acquire their own.
	async function indexExists(): Promise<boolean> {
		const rows: unknown[] = await dataSource.query(
			'SELECT 1 FROM pg_indexes WHERE indexname = $1',
			[indexName()],
		);
		return rows.length === 1;
	}

	it('creates the index on up and drops it on down', async () => {
		if (!isPostgres) return;

		expect(await indexExists()).toBe(false);

		await runSingleMigration(MIGRATION_NAME);
		expect(await indexExists()).toBe(true);

		await undoLastSingleMigration();
		expect(await indexExists()).toBe(false);
	});

	it('is used by the executions list query', async () => {
		if (!isPostgres) return;

		await runSingleMigration(MIGRATION_NAME);

		try {
			const execution = context.escape.tableName('execution_entity');
			const workflow = context.escape.tableName('workflow_entity');
			const planRows: Array<Record<string, string>> = await dataSource.transaction(
				async (manager) => {
					// The test tables are empty, so make the planner cost them like large ones.
					await manager.query('SET LOCAL enable_seqscan = off');
					return await manager.query(
						`EXPLAIN SELECT "execution"."id", "workflow"."name" FROM ${execution} "execution"
						INNER JOIN ${workflow} "workflow" ON "workflow"."id" = "execution"."workflowId"
						WHERE "execution"."workflowId" IN ($1, $2) AND "execution"."deletedAt" IS NULL
						ORDER BY COALESCE("execution"."startedAt", "execution"."createdAt") DESC LIMIT 50`,
						['wf-1', 'wf-2'],
					);
				},
			);

			const plan = planRows.map((row) => Object.values(row).join('')).join('\n');
			expect(plan).toContain(indexName());
			expect(plan).not.toContain('Sort');
		} finally {
			await undoLastSingleMigration();
		}
	});
});
