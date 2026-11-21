import type { MigrationContext, ReversibleMigration } from '../migration-types';

/**
 * Add an expression index matching the `ORDER BY COALESCE(startedAt, createdAt) DESC`
 * used by `ExecutionRepository.findManyByRangeQuery` for the executions list
 * (completed executions), so the newest page is read from the index instead of
 * sorting every non-deleted execution.
 *
 * Postgres only: SQLite does not pick this index without `ANALYZE` statistics.
 */
export class AddExecutionStartedOrCreatedAtIndex1763700000000 implements ReversibleMigration {
	async up({ escape, runQuery }: MigrationContext) {
		const executionEntity = escape.tableName('execution_entity');
		const indexName = escape.indexName('execution_entity_started_or_created_at');
		const startedAt = escape.columnName('startedAt');
		const createdAt = escape.columnName('createdAt');
		const deletedAt = escape.columnName('deletedAt');

		await runQuery(`
			CREATE INDEX ${indexName}
			ON ${executionEntity} ((COALESCE(${startedAt}, ${createdAt})) DESC)
			WHERE ${deletedAt} IS NULL;
		`);
	}

	async down({ escape, runQuery }: MigrationContext) {
		const indexName = escape.indexName('execution_entity_started_or_created_at');

		await runQuery(`DROP INDEX IF EXISTS ${indexName};`);
	}
}
