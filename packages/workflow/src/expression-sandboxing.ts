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

const unsafeExpressionProperties = new Set([
	'getOwnPropertyDescriptor',
	'getOwnPropertyDescriptors',
	'__defineGetter__',
	'__defineSetter__',
	'__lookupGetter__',
	'__lookupSetter__',
]);

const isSafeExpressionProperty = (property: string) =>
	isSafeObjectProperty(property) && !unsafeExpressionProperties.has(property);

const assertSafeProperty = (property: string) => {
	if (!isSafeExpressionProperty(property)) {
		throw new ExpressionError(`Cannot access "${property}" due to security concerns`);
	}
};

/**
 * Returns the property name of a literal node whose value is known at compile time,
 * or `undefined` if the node has to be checked at runtime (e.g. template literals).
 */
const getStaticLiteralKey = (node: unknown): string | undefined => {
	if (
		typeof node !== 'object' ||
		node === null ||
		!('type' in node) ||
		typeof node.type !== 'string' ||
		!node.type.endsWith('Literal') ||
		node.type === 'TemplateLiteral' ||
		!('value' in node)
	) {
		return undefined;
	}
	return String(node.value);
};

const wrapInSanitizer = (dataNode: Parameters<ASTAfterHook>[1], property: unknown) =>
	b.callExpression(b.memberExpression(dataNode, sanitizerIdentifier), [
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
		property as any,
	]);

const isIdentifier = (node: unknown): node is { type: 'Identifier'; name: string } =>
	typeof node === 'object' &&
	node !== null &&
	'type' in node &&
	node.type === 'Identifier' &&
	'name' in node &&
	typeof node.name === 'string';

/**
 * Statically validates a member expression. Returns `true` when the property
 * can only be validated at runtime and must be wrapped in the sanitizer.
 */
const requiresRuntimeCheck = (node: { computed?: boolean | null; property: unknown }) => {
	if (!node.computed) {
		// This is static, so we're safe to error here
		if (!isIdentifier(node.property)) {
			const type =
				typeof node.property === 'object' && node.property !== null && 'type' in node.property
					? String(node.property.type)
					: typeof node.property;
			throw new ExpressionError(`Unknown property type ${type} while sanitising expression`);
		}

		assertSafeProperty(node.property.name);
		return false;
	}

	const staticKey = getStaticLiteralKey(node.property);
	if (staticKey !== undefined) {
		assertSafeProperty(staticKey);
		return false;
	}

	// Anything else (identifiers, template literals, calls, ...) is checked at runtime
	return true;
};

export const PrototypeSanitizer: ASTAfterHook = (ast, dataNode) => {
	astVisit(ast, {
		visitMemberExpression(path) {
			this.traverse(path);
			if (requiresRuntimeCheck(path.node)) {
				path.get('property').replace(wrapInSanitizer(dataNode, path.node.property));
			}
		},
		visitOptionalMemberExpression(path) {
			this.traverse(path);
			if (requiresRuntimeCheck(path.node)) {
				path.get('property').replace(wrapInSanitizer(dataNode, path.node.property));
			}
		},
		visitObjectPattern(path) {
			this.traverse(path);
			path.node.properties.forEach((property, index) => {
				if (property.type !== 'Property' && property.type !== 'ObjectProperty') return;

				if (property.computed) {
					const staticKey = getStaticLiteralKey(property.key);
					if (staticKey !== undefined) {
						assertSafeProperty(staticKey);
					} else {
						path
							.get('properties', index, 'key')
							.replace(wrapInSanitizer(dataNode, property.key));
					}
					return;
				}

				if (property.key.type === 'Identifier') {
					assertSafeProperty(property.key.name);
					return;
				}

				const staticKey = getStaticLiteralKey(property.key);
				if (staticKey === undefined) {
					throw new ExpressionError(
						`Unknown property type ${property.key.type} while sanitising expression`,
					);
				}
				assertSafeProperty(staticKey);
			});
		},
	});
};

/**
 * Runtime check for computed property keys. The key is coerced to a property key
 * *before* the check and the coerced value is returned, so values like
 * `['constructor']` or objects with a custom `toString` cannot bypass the check.
 */
export const sanitizer = (value: unknown): unknown => {
	if (typeof value === 'symbol' || typeof value === 'number') {
		return value;
	}

	const key = String(value);
	assertSafeProperty(key);
	return key;
};
