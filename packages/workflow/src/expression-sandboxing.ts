import { type ASTAfterHook, astBuilders as b, astVisit } from '@n8n/tournament';
import type { ExpressionKind } from 'ast-types/gen/kinds';

import { ExpressionError } from './errors';
import { isSafeObjectProperty } from './utils';

export const sanitizerName = '__sanitize';
const sanitizerIdentifier = b.identifier(sanitizerName);

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
 * Property names that must never be reachable from an expression. On top of the
 * generic prototype-pollution denylist, this blocks reflection helpers that hand
 * back forbidden values (e.g. `constructor`, `getPrototypeOf`) without naming them
 * in a member access.
 */
const unsafeExpressionProperties = new Set([
	'getOwnPropertyDescriptor',
	'getOwnPropertyDescriptors',
	'defineProperty',
	'defineProperties',
	'setPrototypeOf',
	'__defineGetter__',
	'__defineSetter__',
	'__lookupGetter__',
	'__lookupSetter__',
]);

export const isSafeExpressionProperty = (property: string): boolean =>
	isSafeObjectProperty(property) && !unsafeExpressionProperties.has(property);

const securityError = (property: string) =>
	new ExpressionError(`Cannot access "${property}" due to security concerns`);

const isLiteralNode = (node: { type: string }) =>
	node.type === 'Literal' ||
	node.type === 'StringLiteral' ||
	node.type === 'NumericLiteral' ||
	node.type === 'BooleanLiteral' ||
	node.type === 'NullLiteral';

/**
 * Statically checks a property key node. Returns `true` when the key is a
 * plain string/number/boolean/null literal that has been verified as safe,
 * and `false` when it has to be checked at runtime instead.
 */
const checkStaticKey = (key: { type: string; value?: unknown }): boolean => {
	if (!isLiteralNode(key) || ('regex' in key && key.regex) || ('bigint' in key && key.bigint)) {
		return false;
	}
	if (typeof key.value === 'string' && !isSafeExpressionProperty(key.value)) {
		throw securityError(key.value);
	}
	return true;
};

export const PrototypeSanitizer: ASTAfterHook = (ast, dataNode) => {
	const wrapWithSanitizer = (node: ExpressionKind) =>
		b.callExpression(b.memberExpression(dataNode, sanitizerIdentifier), [node]);

	astVisit(ast, {
		visitMemberExpression(path) {
			this.traverse(path);
			const node = path.node;
			if (!node.computed) {
				// This is static, so we're safe to error here
				if (node.property.type !== 'Identifier') {
					throw new ExpressionError(
						`Unknown property type ${node.property.type} while sanitising expression`,
					);
				}

				if (!isSafeExpressionProperty(node.property.name)) {
					throw securityError(node.property.name);
				}
			} else if (!checkStaticKey(node.property)) {
				// Anything that isn't a plain literal (identifiers, template literals,
				// concatenations, ...) is checked at runtime
				path.replace(
					b.memberExpression(
						// eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
						node.object as any,
						wrapWithSanitizer(node.property),
						true,
					),
				);
			}
		},

		visitObjectPattern(path) {
			this.traverse(path);
			// Destructuring (`({ constructor: c }) => c`) reads properties without a
			// member expression, so its keys need the same checks
			for (const property of path.node.properties) {
				if (property.type !== 'Property' && property.type !== 'ObjectProperty') continue;

				if (!property.computed) {
					if (property.key.type === 'Identifier') {
						if (!isSafeExpressionProperty(property.key.name)) {
							throw securityError(property.key.name);
						}
					} else if (!checkStaticKey(property.key)) {
						throw new ExpressionError(
							`Unknown property type ${property.key.type} while sanitising expression`,
						);
					}
				} else if (!checkStaticKey(property.key)) {
					property.key = wrapWithSanitizer(property.key);
				}
			}
		},

		visitWithStatement() {
			throw new ExpressionError('"with" statements are not allowed due to security concerns');
		},
	});
};

/**
 * Converts a value to the property key JavaScript would use for it (ToPropertyKey),
 * invoking any `toString`/`Symbol.toPrimitive` exactly once.
 */
const toPropertyKey = (value: unknown): string | symbol | number => {
	if (typeof value === 'string' || typeof value === 'symbol' || typeof value === 'number') {
		return value;
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return Reflect.ownKeys({ [value as any]: undefined })[0];
};

export const sanitizer = (value: unknown): unknown => {
	// Check the coerced key so that values such as `['constructor']` or objects
	// with a custom `toString` cannot bypass the check
	const key = toPropertyKey(value);
	if (typeof key === 'string' && !isSafeExpressionProperty(key)) {
		throw securityError(key);
	}
	return key;
};
