export const MAX_REGEX_PATTERN_LENGTH = 1000;

type Quantifier = { min: number; max: number };

const BRACE_QUANTIFIER = /^\{(\d+)(,(\d*))?\}/;

function readQuantifier(source: string, index: number): { quantifier: Quantifier; end: number } | null {
	const char = source[index];
	let quantifier: Quantifier;
	let end: number;

	if (char === '*') {
		quantifier = { min: 0, max: Infinity };
		end = index + 1;
	} else if (char === '+') {
		quantifier = { min: 1, max: Infinity };
		end = index + 1;
	} else if (char === '?') {
		quantifier = { min: 0, max: 1 };
		end = index + 1;
	} else if (char === '{') {
		const match = BRACE_QUANTIFIER.exec(source.slice(index));
		if (!match) return null;
		const min = Number(match[1]);
		const max = match[2] === undefined ? min : match[3] === '' ? Infinity : Number(match[3]);
		quantifier = { min, max };
		end = index + match[0].length;
	} else {
		return null;
	}

	if (source[end] === '?') end++;

	return { quantifier, end };
}

function skipEscape(source: string, index: number): number {
	const next = source[index + 1];
	if ((next === 'u' || next === 'p' || next === 'P') && source[index + 2] === '{') {
		const close = source.indexOf('}', index + 3);
		return close === -1 ? source.length : close + 1;
	}
	if (next === 'k' && source[index + 2] === '<') {
		const close = source.indexOf('>', index + 3);
		return close === -1 ? source.length : close + 1;
	}
	return index + 2;
}

function skipCharacterClass(source: string, index: number): number {
	let i = index + 1;
	if (source[i] === '^') i++;
	if (source[i] === ']') i++;
	while (i < source.length && source[i] !== ']') {
		i = source[i] === '\\' ? i + 2 : i + 1;
	}
	return i + 1;
}

/**
 * Detects nested repetition (e.g. `(a+)+`, `(\w+\s?)*`, `(a|b+){2,}`), the
 * construct behind catastrophic backtracking in backtracking regex engines.
 * Similar to the star-height check of `safe-regex`: a group repeated more than
 * once may not contain a variable-length repetition.
 */
export function hasNestedQuantifier(source: string): boolean {
	const stack: boolean[] = [false];
	let i = 0;

	while (i < source.length) {
		const char = source[i];
		let atomHasRepetition = false;

		if (char === '(') {
			stack.push(false);
			i++;
			continue;
		} else if (char === ')') {
			atomHasRepetition = stack.length > 1 ? (stack.pop() ?? false) : false;
			i++;
		} else if (char === '\\') {
			i = skipEscape(source, i);
		} else if (char === '[') {
			i = skipCharacterClass(source, i);
		} else {
			i++;
		}

		const parsed = readQuantifier(source, i);
		if (parsed) {
			const { quantifier } = parsed;
			i = parsed.end;
			if (atomHasRepetition && quantifier.max > 1) return true;
			if (quantifier.max > 1 && quantifier.min !== quantifier.max) atomHasRepetition = true;
		}

		if (atomHasRepetition) stack[stack.length - 1] = true;
	}

	return false;
}

/**
 * Returns a reason when a user-supplied regex source should not be compiled,
 * because it is too long or prone to catastrophic backtracking (ReDoS).
 */
export function getUnsafeRegexReason(source: string): string | undefined {
	if (source.length > MAX_REGEX_PATTERN_LENGTH) {
		return `Regex pattern is longer than ${MAX_REGEX_PATTERN_LENGTH} characters`;
	}
	if (hasNestedQuantifier(source)) {
		return 'Regex pattern contains a nested quantifier (for example "(a+)+"), which can cause catastrophic backtracking';
	}
	return undefined;
}
