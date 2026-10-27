import { Tournament } from '@n8n/tournament';

import {
	DollarSignValidator,
	PrototypeSanitizer,
	sanitizer,
	DOLLAR_SIGN_ERROR,
} from '../src/expression-sandboxing';

const tournament = new Tournament(
	(e) => {
		throw e;
	},
	undefined,
	undefined,
	{
		before: [],
		after: [PrototypeSanitizer, DollarSignValidator],
	},
);

const errorRegex = /^Cannot access ".*" due to security concerns$/;

describe('PrototypeSanitizer', () => {
	describe('Static analysis', () => {
		it('should not allow access to __proto__', () => {
			expect(() => {
				tournament.execute('{{ ({}).__proto__.__proto__ }}', {});
			}).toThrowError(errorRegex);

			expect(() => {
				tournament.execute('{{ ({})["__proto__"]["__proto__"] }}', {});
			}).toThrowError(errorRegex);
		});

		it('should not allow access to prototype', () => {
			expect(() => {
				tournament.execute('{{ Number.prototype }}', { Number });
			}).toThrowError(errorRegex);

			expect(() => {
				tournament.execute('{{ Number["prototype"] }}', { Number });
			}).toThrowError(errorRegex);
		});

		it('should not allow access to constructor', () => {
			expect(() => {
				tournament.execute('{{ Number.constructor }}', {
					__sanitize: sanitizer,
					Number,
				});
			}).toThrowError(errorRegex);

			expect(() => {
				tournament.execute('{{ Number["constructor"] }}', {
					__sanitize: sanitizer,
					Number,
				});
			}).toThrowError(errorRegex);
		});

		describe('Dollar sign identifier handling', () => {
			it('should not allow bare $ identifier', () => {
				expect(() => {
					tournament.execute('{{ $ }}', { $: () => 'test' });
				}).toThrowError(DOLLAR_SIGN_ERROR);

				expect(() => {
					tournament.execute('{{$}}', { $: () => 'test' });
				}).toThrowError(DOLLAR_SIGN_ERROR);
			});

			it('should not allow $ in expressions', () => {
				expect(() => {
					tournament.execute('{{ "prefix" + $ }}', { $: () => 'test' });
				}).toThrowError(DOLLAR_SIGN_ERROR);

				expect(() => {
					tournament.execute('{{ $ + "suffix" }}', { $: () => 'test' });
				}).toThrowError(DOLLAR_SIGN_ERROR);

				expect(() => {
					tournament.execute('{{ 1 + $ }}', { $: () => 'test' });
				}).toThrowError(DOLLAR_SIGN_ERROR);

				expect(() => {
					tournament.execute('{{ [1, 2, $] }}', { $: () => 'test' });
				}).toThrowError(DOLLAR_SIGN_ERROR);

				expect(() => {
					tournament.execute('{{ {value: $} }}', { $: () => 'test' });
				}).toThrowError(DOLLAR_SIGN_ERROR);
			});

			it('should not allow $ with property access', () => {
				expect(() => {
					tournament.execute('{{ $.something }}', { $: { something: 'value' } });
				}).toThrowError(DOLLAR_SIGN_ERROR);

				expect(() => {
					tournament.execute('{{ $["property"] }}', { $: { property: 'value' } });
				}).toThrowError(DOLLAR_SIGN_ERROR);
			});

			it('should allow $ as function call', () => {
				const mockFunction = () => 'result';
				expect(() => {
					tournament.execute('{{ $() }}', { $: mockFunction });
				}).not.toThrow();

				expect(() => {
					tournament.execute('{{ $("node_name") }}', { $: mockFunction });
				}).not.toThrow();

				expect(() => {
					tournament.execute('{{ $().someMethod() }}', { $: () => ({ someMethod: () => 'test' }) });
				}).not.toThrow();
			});

			it('should allow $ in strings', () => {
				expect(() => {
					tournament.execute('{{ "test$test" }}', {});
				}).not.toThrow();

				expect(() => {
					tournament.execute("{{ 'price: $100' }}", {});
				}).not.toThrow();

				expect(() => {
					// eslint-disable-next-line n8n-local-rules/no-interpolation-in-regular-string
					tournament.execute('{{ `template ${100}$` }}', {});
				}).not.toThrow();
			});

			it('should allow $ as part of variable names', () => {
				expect(() => {
					tournament.execute('{{ $json }}', { $json: { test: 'value' } });
				}).not.toThrow();

				expect(() => {
					tournament.execute('{{ price$ }}', { price$: 100 });
				}).not.toThrow();

				expect(() => {
					tournament.execute('{{ my$var }}', { my$var: 'test' });
				}).not.toThrow();

				expect(() => {
					tournament.execute('{{ _$_ }}', { _$_: 'underscore' });
				}).not.toThrow();
			});

			it('should allow $ as a property name', () => {
				// $ is a valid property name in JavaScript, so obj.$ should be allowed
				expect(() => {
					tournament.execute('{{ obj.$ }}', { obj: { $: 'value' } });
				}).not.toThrow();

				expect(() => {
					tournament.execute('{{ data["$"] }}', { data: { $: 'value' } });
				}).not.toThrow();

				expect(() => {
					const obj = { nested: { $: 'deep' } };
					tournament.execute('{{ obj.nested.$ }}', { obj });
				}).not.toThrow();
			});

			it('should allow $ in conditional expressions with function calls', () => {
				const mockFunction = () => 'result';

				expect(() => {
					tournament.execute('{{ true ? $() : "fallback" }}', { $: mockFunction });
				}).not.toThrow();

				expect(() => {
					tournament.execute('{{ $() || "default" }}', { $: mockFunction });
				}).not.toThrow();

				expect(() => {
					tournament.execute('{{ $() && "continue" }}', { $: mockFunction });
				}).not.toThrow();
			});

			it('should not allow $ in conditional expressions without function calls', () => {
				expect(() => {
					tournament.execute('{{ true ? $ : "fallback" }}', { $: () => 'test' });
				}).toThrowError(DOLLAR_SIGN_ERROR);

				expect(() => {
					tournament.execute('{{ $ || "default" }}', { $: () => 'test' });
				}).toThrowError(DOLLAR_SIGN_ERROR);

				expect(() => {
					tournament.execute('{{ $ && "continue" }}', { $: () => 'test' });
				}).toThrowError(DOLLAR_SIGN_ERROR);
			});
		});
	});

	describe('Runtime', () => {
		it('should not allow access to __proto__', () => {
			expect(() => {
				tournament.execute('{{ ({})["__" + (() => "proto")() + "__"] }}', {
					__sanitize: sanitizer,
				});
			}).toThrowError(errorRegex);
		});

		it('should not allow access to prototype', () => {
			expect(() => {
				tournament.execute('{{ Number["pro" + (() => "toty")() + "pe"] }}', {
					__sanitize: sanitizer,
					Number,
				});
			}).toThrowError(errorRegex);
		});

		it('should not allow access to constructor', () => {
			expect(() => {
				tournament.execute('{{ Number["cons" + (() => "truc")() + "tor"] }}', {
					__sanitize: sanitizer,
					Number,
				});
			}).toThrowError(errorRegex);
		});

		describe('non-string and template literal keys', () => {
			const data = { __sanitize: sanitizer, Math };

			it.each([
				'{{ Math.max[`constructor`] }}',
				'{{ Math.max[`constr${"uctor"}`] }}',
				"{{ Math.max[['constructor']] }}",
				"{{ Math.max[[['constructor']]] }}",
				"{{ Math.max[{ toString() { return 'constructor' } }] }}",
				"{{ Math.max[{ [Symbol.toPrimitive]() { return 'constructor' } }] }}",
				'{{ ({})[`__proto__`] }}',
				"{{ ({})[['__proto__']] }}",
				'{{ Math.max[`constructor`]("return 1")() }}',
				"{{ Math.max?.[['constructor']] }}",
			])('should block %s', (expression) => {
				expect(() => tournament.execute(expression, data)).toThrowError(errorRegex);
			});

			it('should coerce the key only once', () => {
				const expression = `{{ (() => {
					let calls = 0;
					const key = { toString: () => (calls++ === 0 ? 'a' : 'constructor') };
					return ({ a: 1 })[key];
				})() }}`;
				expect(tournament.execute(expression, data)).toBe(1);
			});

			it('should still allow safe computed keys', () => {
				expect(tournament.execute('{{ ({ a: 1 })[`a`] }}', data)).toBe(1);
				expect(tournament.execute("{{ ({ a: 1 })[['a']] }}", data)).toBe(1);
				expect(tournament.execute('{{ [1, 2, 3][1] }}', data)).toBe(2);
				expect(tournament.execute('{{ [1, 2, 3][1 + 1] }}', data)).toBe(3);
				expect(
					tournament.execute('{{ (() => { const s = Symbol("s"); return { [s]: 4 }[s] })() }}', data),
				).toBe(4);
			});
		});

		describe('descriptor and accessor helpers', () => {
			const data = { __sanitize: sanitizer, Math, Object };

			it.each([
				"{{ Object.getOwnPropertyDescriptor(Object.getOwnPropertyDescriptor(Object, 'prototype').value, '__proto__').get.call(Math.max) }}",
				'{{ Object.getOwnPropertyDescriptors(Math.max) }}',
				"{{ Object['getOwnPropertyDescriptor'] }}",
				"{{ Object['getOwnProperty' + 'Descriptor'] }}",
				"{{ ({}).__lookupGetter__('__proto__') }}",
				"{{ ({})['__lookup' + 'Getter__']('__proto__') }}",
				"{{ ({}).__lookupSetter__('__proto__') }}",
			])('should block %s', (expression) => {
				expect(() => tournament.execute(expression, data)).toThrowError(errorRegex);
			});
		});

		describe('destructuring', () => {
			const data = { __sanitize: sanitizer, Math, Object };

			it.each([
				'{{ (() => { const { constructor: c } = Math.max; return c })() }}',
				'{{ (() => { const { constructor } = Math.max; return constructor })() }}',
				"{{ (() => { const { 'constructor': c } = Math.max; return c })() }}",
				"{{ (() => { const { ['constructor']: c } = Math.max; return c })() }}",
				'{{ (() => { const { [`constructor`]: c } = Math.max; return c })() }}',
				"{{ (() => { const { [['constructor']]: c } = Math.max; return c })() }}",
				'{{ (() => { const { __proto__: p } = Math.max; return p })() }}',
				"{{ (() => { let c; ({ constructor: c } = Math.max); return c })() }}",
				'{{ (({ constructor: c }) => c)(Math.max) }}',
				'{{ (() => { const { getOwnPropertyDescriptor: g } = Object; return g })() }}',
			])('should block %s', (expression) => {
				expect(() => tournament.execute(expression, data)).toThrowError(errorRegex);
			});

			it('should still allow safe destructuring', () => {
				const restExpression =
					'{{ (() => { const { a, b: c, ...rest } = { a: 1, b: 2, d: 3 }; return a + c + rest.d })() }}';
				const computedExpression =
					"{{ (() => { const k = 'a'; const { [k]: v } = { a: 5 }; return v })() }}";

				expect(tournament.execute(restExpression, data)).toBe(6);
				expect(tournament.execute(computedExpression, data)).toBe(5);
			});
		});
	});
});
