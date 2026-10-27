import { BinaryDataScopeError } from '../../errors/binary-data-scope.error';
import { assertBinaryDataIdInScope, isBinaryDataIdInScope } from '../scope';

describe('binary data scope', () => {
	const workflowId = 'wf123';
	const executionId = '42';
	const uuid = '0f9f6a7e-1c2b-4d3e-9f80-123456789abc';
	const fileId = (wf: string, exec: string) =>
		`workflows/${wf}/executions/${exec}/binary_data/${uuid}`;

	describe('isBinaryDataIdInScope', () => {
		test.each(['filesystem-v2', 's3'])(
			'should accept %s ids of the same workflow and execution',
			(mode) => {
				expect(
					isBinaryDataIdInScope(`${mode}:${fileId(workflowId, executionId)}`, {
						workflowId,
						executionId,
					}),
				).toBe(true);
			},
		);

		test('should accept ids stored under the temp execution id', () => {
			expect(
				isBinaryDataIdInScope(`filesystem-v2:${fileId(workflowId, 'temp')}`, {
					workflowId,
					executionId,
				}),
			).toBe(true);
		});

		test('should reject all ids when the execution id is unknown', () => {
			const scope = { workflowId, executionId: undefined };

			expect(isBinaryDataIdInScope(`s3:${fileId(workflowId, '7')}`, scope)).toBe(false);
			expect(isBinaryDataIdInScope(`s3:${fileId(workflowId, 'temp')}`, scope)).toBe(false);
		});

		test.each(['filesystem-v2', 's3'])('should reject %s ids of another workflow', (mode) => {
			expect(
				isBinaryDataIdInScope(`${mode}:${fileId('otherWf', executionId)}`, {
					workflowId,
					executionId,
				}),
			).toBe(false);
		});

		test('should reject ids of another execution of the same workflow', () => {
			expect(
				isBinaryDataIdInScope(`filesystem-v2:${fileId(workflowId, '43')}`, {
					workflowId,
					executionId,
				}),
			).toBe(false);
		});

		const executionDir = `workflows/${workflowId}/executions/${executionId}`;

		test.each([
			[
				'path traversal',
				`${executionDir}/binary_data/../../../otherWf/executions/1/binary_data/${uuid}`,
			],
			[
				'traversal in execution segment',
				`workflows/${workflowId}/executions/../binary_data/${uuid}`,
			],
			['extra segments', `${fileId(workflowId, executionId)}/extra`],
			['non-uuid file name', `${executionDir}/binary_data/secret`],
			['wrong directory', `${executionDir}/other/${uuid}`],
			['arbitrary bucket key', 'some/other/key'],
		])('should reject %s', (_, id) => {
			expect(isBinaryDataIdInScope(`s3:${id}`, { workflowId, executionId })).toBe(false);
			expect(isBinaryDataIdInScope(`filesystem-v2:${id}`, { workflowId, executionId })).toBe(
				false,
			);
		});

		test('should reject ids without a mode or with an unknown mode', () => {
			const scope = { workflowId, executionId };

			expect(isBinaryDataIdInScope(fileId(workflowId, executionId), scope)).toBe(false);
			expect(isBinaryDataIdInScope(`database:${fileId(workflowId, executionId)}`, scope)).toBe(
				false,
			);
		});

		test('should accept legacy filesystem ids only for the known execution', () => {
			const legacyId = `filesystem:${executionId}${uuid}`;

			expect(isBinaryDataIdInScope(legacyId, { workflowId, executionId })).toBe(true);
			expect(isBinaryDataIdInScope(legacyId, { workflowId, executionId: '43' })).toBe(false);
			expect(isBinaryDataIdInScope(legacyId, { workflowId, executionId: undefined })).toBe(false);
		});
	});

	describe('assertBinaryDataIdInScope', () => {
		test('should not throw for ids in scope', () => {
			expect(() =>
				assertBinaryDataIdInScope(`filesystem-v2:${fileId(workflowId, executionId)}`, {
					workflowId,
					executionId,
				}),
			).not.toThrow();
		});

		test('should throw BinaryDataScopeError for ids out of scope', () => {
			expect(() =>
				assertBinaryDataIdInScope(`filesystem-v2:${fileId('otherWf', executionId)}`, {
					workflowId,
					executionId,
				}),
			).toThrow(BinaryDataScopeError);
		});
	});
});
