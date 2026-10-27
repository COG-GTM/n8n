import { type ASTAfterHook, astBuilders as b, astVisit } from '@n8n/tournament';

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
 * Property names that expose accessors or descriptors of arbitrary objects, which would
 * otherwise let an expression reach `Function.prototype.constructor` using only string
 * arguments, e.g. `Object.getOwnPropertyDescriptor(fnProto, 'constructor').value`.
 */
const unsafeSandboxProperties = new Set([
	'getOwnPropertyDescriptor',
	'getOwnPropertyDescriptors',
	'__lookupGetter__',
	'__lookupSetter__',
	'__defineGetter__',
	'__defineSetter__',
]);

const isSafeSandboxProperty = (property: string) =>
	isSafeObjectProperty(property) && !unsafeSandboxProperties.has(property);

const assertSafeSandboxProperty = (property: string) => {
	if (!isSafeSandboxProperty(property)) {
		throw new ExpressionError(`Cannot access "${property}" due to security concerns`);
	}
};

type LiteralLike = { type: string; value?: unknown };

type ExpressionNode = Parameters<typeof b.expressionStatement>[0];

const isStringLiteral = (node: LiteralLike): node is { type: string; value: string } =>
	node.type === 'StringLiteral' || (node.type === 'Literal' && typeof node.value === 'string');

const isNumericLiteral = (node: LiteralLike) =>
	node.type === 'NumericLiteral' || (node.type === 'Literal' && typeof node.value === 'number');

export const PrototypeSanitizer: ASTAfterHook = (ast, dataNode) => {
	const wrapInSanitizer = (node: ExpressionNode) =>
		b.callExpression(b.memberExpression(dataNode, sanitizerIdentifier), [node]);

	const sanitizeMemberExpression = (node: {
		computed?: boolean | null;
		property: ExpressionNode;
	}) => {
		if (!node.computed) {
			// This is static, so we're safe to error here
			if (node.property.type !== 'Identifier' || typeof node.property.name !== 'string') {
				throw new ExpressionError(
					`Unknown property type ${node.property.type} while sanitising expression`,
				);
			}

			assertSafeSandboxProperty(node.property.name);
		} else if (isStringLiteral(node.property)) {
			// Check any static strings against our forbidden list
			assertSafeSandboxProperty(node.property.value);
		} else if (!isNumericLiteral(node.property)) {
			// Anything else (identifiers, calls, template literals, arrays, ...) is only
			// known at runtime, so we need to wrap it
			node.property = wrapInSanitizer(node.property);
		}
	};

	astVisit(ast, {
		visitMemberExpression(path) {
			this.traverse(path);
			sanitizeMemberExpression(path.node);
		},
		visitOptionalMemberExpression(path) {
			this.traverse(path);
			sanitizeMemberExpression(path.node);
		},
		visitObjectPattern(path) {
			this.traverse(path);
			// Destructuring (`const { constructor: c } = fn`) reads properties without a
			// MemberExpression, so its keys need the same checks
			for (const property of path.node.properties) {
				if (property.type !== 'Property' && property.type !== 'ObjectProperty') continue;

				const key: LiteralLike & { name?: unknown } = property.key;
				if (!property.computed) {
					if (key.type === 'Identifier' && typeof key.name === 'string') {
						assertSafeSandboxProperty(key.name);
					} else if (isStringLiteral(key)) {
						assertSafeSandboxProperty(key.value);
					} else if (!isNumericLiteral(key)) {
						throw new ExpressionError(
							`Unknown property type ${key.type} while sanitising expression`,
						);
					}
				} else if (isStringLiteral(key)) {
					assertSafeSandboxProperty(key.value);
				} else if (!isNumericLiteral(key)) {
					property.key = wrapInSanitizer(property.key);
				}
			}
		},
	});
};

/**
 * Coerces a value to a property key exactly like a property access would (ToPropertyKey),
 * including objects whose `toString` / `Symbol.toPrimitive` return a symbol.
 */
const propertyKeyResolver = new Proxy<Record<PropertyKey, string | symbol>>(
	{},
	{ get: (_target, key) => key },
);

/**
 * Runtime check for computed property keys. The key is coerced exactly once, the same way
 * a property access would coerce it, and the coerced key is returned. This prevents
 * non-string keys (e.g. `['constructor']` or objects with a custom `toString`) from passing
 * the check and being turned into a forbidden name afterwards.
 */
export const sanitizer = (value: unknown): string | symbol => {
	// Any value is a valid computed key at runtime; the proxy performs the coercion
	const key = propertyKeyResolver[value as PropertyKey];
	if (typeof key === 'string') {
		assertSafeSandboxProperty(key);
	}
	return key;
};
