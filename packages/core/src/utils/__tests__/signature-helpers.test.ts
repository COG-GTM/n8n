import {
	buildWaitingExecutionPath,
	generateUrlSignature,
	generateWaitingExecutionToken,
	isValidWaitingExecutionToken,
	parseWaitingExecutionPath,
} from '../signature-helpers';

describe('signature-helpers', () => {
	const secret = 'test-secret';
	const baseUrl = 'http://localhost:5678';

	describe('generateUrlSignature', () => {
		it('should generate a signature token', () => {
			const url = `${baseUrl}/webhook/abc`;
			const token = generateUrlSignature(url, secret);
			expect(token).toBe('fe7f1e4c11f875b2d24681e0b28d0bfed6d66381af5b0ab9633da2202a895243');
		});

		it('should generate a different token for a different url', () => {
			const url = `${baseUrl}/webhook/def`;
			const token = generateUrlSignature(url, secret);
			expect(token).toBe('ab8e72e7a0e47689596a6550283cbef9e2797b7370b0d6d99c89ee7c2394ea8f');
		});

		it('should generate a different token for a different secret', () => {
			const url = `${baseUrl}/webhook/abc`;
			const token = generateUrlSignature(url, 'different-secret');
			expect(token).toBe('84a99b6950e12ffcf1fcf8e0fc0986c0c8a46df331932efd79b17e0c11801bd2');
		});
	});

	describe('waiting execution token', () => {
		it('should generate a token that depends on the execution id and secret', () => {
			const token = generateWaitingExecutionToken('1', secret);
			expect(token).toMatch(/^[a-f0-9]{64}$/);
			expect(generateWaitingExecutionToken('2', secret)).not.toBe(token);
			expect(generateWaitingExecutionToken('1', 'different-secret')).not.toBe(token);
		});

		it('should build and parse the waiting path', () => {
			const token = generateWaitingExecutionToken('42', secret);
			const path = buildWaitingExecutionPath('42', token);
			expect(path).toBe(`42-${token}`);
			expect(parseWaitingExecutionPath(path)).toEqual({ executionId: '42', token });
		});

		it('should parse a path without a token', () => {
			expect(buildWaitingExecutionPath('42')).toBe('42');
			expect(parseWaitingExecutionPath('42')).toEqual({ executionId: '42' });
		});

		it('should only accept the token of the same execution', () => {
			const token = generateWaitingExecutionToken('1', secret);
			expect(isValidWaitingExecutionToken('1', token, secret)).toBe(true);
			expect(isValidWaitingExecutionToken('2', token, secret)).toBe(false);
			expect(isValidWaitingExecutionToken('1', undefined, secret)).toBe(false);
			expect(isValidWaitingExecutionToken('1', '', secret)).toBe(false);
			expect(isValidWaitingExecutionToken('1', 'abc', secret)).toBe(false);
		});
	});
});
