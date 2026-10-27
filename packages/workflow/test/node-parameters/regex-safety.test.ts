import {
	MAX_REGEX_PATTERN_LENGTH,
	getUnsafeRegexReason,
	hasNestedQuantifier,
} from '../../src/node-parameters/regex-safety';

describe('regex-safety', () => {
	describe('hasNestedQuantifier', () => {
		it.each([
			'^(a+)+$',
			'(a*)*',
			'(\\w+\\s?)+$',
			'(a|b+){2,}',
			'((ab)*c)+',
			'(?:x+x+)+y',
			'(a+){10}',
			'([a-z]+)*$',
			'(.*a){20}',
			'(\\d+,)*',
		])('flags %s', (pattern) => {
			expect(hasNestedQuantifier(pattern)).toBe(true);
		});

		it.each([
			'first',
			'.*',
			'[0-9]',
			'^fo{2}$',
			'(\\d{3})+',
			'(ab)+',
			'(a|b)*c',
			'(a+)?b',
			'a{2,5}b*',
			'[(+)]+',
			'\\(a+\\)+',
			'\\u{1F600}+',
			'(?<year>\\d{4})-(?<month>\\d{2})',
			'^(?:https?://)?[^/]+',
			'^[\\w+=,.@-]+$',
			'arn:aws:sns:[0-9a-zA-Z\\-_]+:[0-9]+:[0-9a-zA-Z\\-_]+',
		])('allows %s', (pattern) => {
			expect(hasNestedQuantifier(pattern)).toBe(false);
		});
	});

	describe('getUnsafeRegexReason', () => {
		it('rejects patterns longer than the limit', () => {
			expect(getUnsafeRegexReason('a'.repeat(MAX_REGEX_PATTERN_LENGTH + 1))).toContain(
				`${MAX_REGEX_PATTERN_LENGTH} characters`,
			);
			expect(getUnsafeRegexReason('a'.repeat(MAX_REGEX_PATTERN_LENGTH))).toBeUndefined();
		});

		it('rejects nested quantifiers', () => {
			expect(getUnsafeRegexReason('^(a+)+$')).toContain('nested quantifier');
		});

		it('accepts ordinary patterns', () => {
			expect(getUnsafeRegexReason('^[A-Z]{2}-\\d+$')).toBeUndefined();
		});
	});
});
