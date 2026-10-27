import { type ASTAfterHook, astBuilders as b, astVisit } from '@n8n/tournament';

import { ExpressionError } from './errors';
import { isSafeObjectProperty } from './utils';

export const sanitizerName = '__sanitize';
const sanitizerIdentifier = b.identifier(sanitizerName);

export const thisSanitizerName = '__sanitizeThis';
const thisSanitizerIdentifier = b.identifier(thisSanitizerName);

export const DOLLAR_SIGN_ERROR = 'Cannot access "$" without calling it as a function';

/**
 * Helper to check if an expression is a valid property access with $ as the property.
 * Returns true for obj.$ or obj.nested.$ but false for bare $ or other expression contexts.
 */
const isValidDollarPropertyAccess = (expr: unknown): boolean => {
	if (
		typeof expr !== 'object' ||
		expr === null ||
		!('type' in expr) ||
		expr.type !== 'MemberExpression' ||
		!('property' in expr) ||
		!('object' in expr)
	) {
		return false;
	}

	const property = expr.property;
	const object = expr.object;

	// $ must be the property
	const isPropertyDollar =
		typeof property === 'object' &&
		property !== null &&
		'name' in property &&
		property.name === '$';

	// $ must NOT be the object (to block $.something)
	const isObjectDollar =
		typeof object === 'object' && object !== null && 'name' in object && object.name === '$';

	// Object must be an Identifier (obj) or MemberExpression (obj.nested)
	// This excludes bare $ or $ in other expression contexts
	const isObjectValid =
		typeof object === 'object' &&
		object !== null &&
		'type' in object &&
		(object.type === 'Identifier' || object.type === 'MemberExpression');

	return isPropertyDollar && !isObjectDollar && isObjectValid;
};

/**
 * Validates that the $ identifier is only used in allowed contexts.
 * This prevents user errors like `{{ $ }}` which would return the function object itself.
 *
 * Allowed contexts:
 * - As a function call: $()
 * - As a property name: obj.$ (where $ is a valid property name in JavaScript)
 *
 * Disallowed contexts:
 * - Bare identifier: $
 * - As object in member expression: $.property
 * - In expressions: "prefix" + $, [1, 2, $], etc.
 */
export const DollarSignValidator: ASTAfterHook = (ast, _dataNode) => {
	astVisit(ast, {
		visitIdentifier(path) {
			this.traverse(path);
			const node = path.node;

			// Only check for the exact identifier '$'
			if (node.name !== '$') return;

			// Runtime type checking since path properties are typed as 'any'
			const parent: unknown = path.parent;

			// Check if parent is a path object with a 'name' property
			if (typeof parent !== 'object' || parent === null || !('name' in parent)) {
				throw new ExpressionError(DOLLAR_SIGN_ERROR);
			}

			// Allow $ when it's the callee: $()
			// parent.name === 'callee' means the parent path represents the callee field
			if (parent.name === 'callee') {
				return;
			}

			// Block when $ is the object in a MemberExpression: $.something
			// parent.name === 'object' means the parent path represents the object field
			if (parent.name === 'object') {
				throw new ExpressionError(DOLLAR_SIGN_ERROR);
			}

			// Check if $ is the property of a MemberExpression: obj.$
			// For obj.$: parent.name is 'expression' and grandparent has ExpressionStatement
			// The ExpressionStatement should contain a MemberExpression with $ as property
			if ('parent' in parent && typeof parent.parent === 'object' && parent.parent !== null) {
				const grandparent = parent.parent;
				if (
					'value' in grandparent &&
					typeof grandparent.value === 'object' &&
					grandparent.value !== null
				) {
					const gpNode = grandparent.value;
					// ExpressionStatement has an 'expression' field containing the actual expression
					if ('type' in gpNode && gpNode.type === 'ExpressionStatement' && 'expression' in gpNode) {
						// Check if this is a valid property access like obj.$
						if (isValidDollarPropertyAccess(gpNode.expression)) {
							return;
						}
					}
				}
			}

			// Disallow all other cases (bare $, $ in expressions, etc.)
			throw new ExpressionError(DOLLAR_SIGN_ERROR);
		},
	});
};

/**
 * Property names expressions must never read. On top of the prototype-pollution
 * denylist this covers the reflective built-ins that return those same values
 * without naming them (e.g. `Object.getOwnPropertyDescriptor(fn, 'constructor')`).
 */
const unsafeExpressionProperties = new Set([
	'getOwnPropertyDescriptor',
	'getOwnPropertyDescriptors',
	'setPrototypeOf',
	'defineProperty',
	'defineProperties',
	'__defineGetter__',
	'__defineSetter__',
	'__lookupGetter__',
	'__lookupSetter__',
	'prepareStackTrace',
	'mainModule',
	'binding',
	'_load',
]);

export const isSafeExpressionProperty = (property: unknown): boolean => {
	if (typeof property === 'symbol') return true;
	const name = String(property);
	return isSafeObjectProperty(name) && !unsafeExpressionProperties.has(name);
};

const securityError = (property: unknown) =>
	new ExpressionError(`Cannot access "${String(property)}" due to security concerns`);

type KeyNode = { type: string; name?: unknown; value?: unknown };

/**
 * Returns the property name if it is statically known, otherwise `undefined`.
 */
const getStaticKey = (
	key: KeyNode,
	computed: boolean | null | undefined,
): { name: unknown } | undefined => {
	if (!computed && key.type === 'Identifier') return { name: key.name };
	if (key.type === 'StringLiteral' || key.type === 'Literal' || key.type === 'NumericLiteral') {
		return { name: key.value };
	}
	return undefined;
};

export const PrototypeSanitizer: ASTAfterHook = (ast, dataNode) => {
	const wrapWithSanitizer = (node: Parameters<typeof b.callExpression>[1][number]) =>
		b.callExpression(b.memberExpression(dataNode, sanitizerIdentifier), [node]);

	astVisit(ast, {
		visitMemberExpression(path) {
			this.traverse(path);
			const node = path.node;
			if (!node.computed && node.property.type !== 'Identifier') {
				// This is static, so we're safe to error here
				throw new ExpressionError(
					`Unknown property type ${node.property.type} while sanitising expression`,
				);
			}

			const staticKey = getStaticKey(node.property, node.computed);
			if (staticKey) {
				if (!isSafeExpressionProperty(staticKey.name)) throw securityError(staticKey.name);
				return;
			}

			// Any other computed key (identifiers, template literals, calls, ...) is only known at
			// runtime, so route it through the sanitizer
			path.replace(
				b.memberExpression(
					// eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
					node.object as any,
					// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
					wrapWithSanitizer(node.property),
					true,
				),
			);
		},

		// Destructuring reads properties without a member expression: `({ constructor: c } = fn)`
		visitObjectPattern(path) {
			this.traverse(path);
			for (const property of path.node.properties) {
				if (property.type !== 'Property' && property.type !== 'ObjectProperty') continue;

				const staticKey = getStaticKey(property.key, property.computed);
				if (staticKey) {
					if (!isSafeExpressionProperty(staticKey.name)) throw securityError(staticKey.name);
				} else {
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					property.key = wrapWithSanitizer(property.key);
					property.computed = true;
				}
			}
		},

		// `with (fn) { constructor }` resolves forbidden properties as plain identifiers
		visitWithStatement() {
			throw new ExpressionError('"with" statements are not allowed due to security concerns');
		},

		// `import('child_process')` would load arbitrary modules into the n8n process
		visitImportExpression() {
			throw new ExpressionError('Dynamic imports are not allowed due to security concerns');
		},
	});
};

/**
 * Expressions are compiled in sloppy mode, so `this` inside a plain function call is the
 * host's `globalThis` (and with it the real `process`). Route every `this` inside a
 * non-arrow function through a runtime check that strips the global object.
 */
export const ThisSanitizer: ASTAfterHook = (ast, dataNode) => {
	let functionDepth = 0;

	astVisit(ast, {
		visitFunctionExpression(path) {
			functionDepth++;
			this.traverse(path);
			functionDepth--;
			return false;
		},
		visitFunctionDeclaration(path) {
			functionDepth++;
			this.traverse(path);
			functionDepth--;
			return false;
		},
		visitThisExpression(path) {
			if (functionDepth > 0) {
				path.replace(
					b.callExpression(b.memberExpression(dataNode, thisSanitizerIdentifier), [
						b.thisExpression(),
					]),
				);
			}
			return false;
		},
	});
};

export const thisSanitizer = (value: unknown): unknown =>
	value === globalThis ? undefined : value;

/**
 * Applies the engine's own ToPropertyKey exactly once (boxed symbols stay symbols).
 */
const toPropertyKey = (value: unknown): string | symbol => {
	if (typeof value === 'symbol' || typeof value === 'string') return value;
	// The engine performs ToPropertyKey on non-key values here, despite the type annotation
	return Reflect.ownKeys({ [value as PropertyKey]: 0 })[0];
};

/**
 * Runtime check for computed property keys. Coerces the key once so objects with a
 * custom `toString` cannot return a safe name here and a forbidden one on access.
 */
export const sanitizer = (value: unknown): unknown => {
	const key = toPropertyKey(value);
	if (!isSafeExpressionProperty(key)) throw securityError(key);
	return key;
};
