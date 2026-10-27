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

		it.each([
			['template literal', '{{ Math.max[`constructor`] }}'],
			['template literal with expression', '{{ Math.max[`cons${"tructor"}`] }}'],
			['template literal __proto__', '{{ ({})[`__proto__`] }}'],
			['array key', "{{ Math.max[['constructor']] }}"],
			['nested array key', "{{ Math.max[[['constructor']]] }}"],
			['object with toString', "{{ Math.max[{ toString() { return 'constructor' } }] }}"],
			['optional chaining', '{{ Math.max?.[`constructor`] }}'],
			['destructuring', '{{ (({ constructor }) => constructor)(Math.max) }}'],
			['destructuring with string key', "{{ (({ 'constructor': c }) => c)(Math.max) }}"],
			['destructuring with computed key', '{{ (({ [`constructor`]: c }) => c)(Math.max) }}'],
			[
				'assignment destructuring',
				'{{ (() => { let c; ({ constructor: c } = Math.max); return c })() }}',
			],
			[
				'assignment destructuring with template key',
				'{{ (() => { let c; ({ [`constructor`]: c } = Math.max); return c })() }}',
			],
			[
				'getOwnPropertyDescriptor',
				"{{ Object.getOwnPropertyDescriptor(Math.max, 'name') }}",
			],
			['__lookupGetter__', "{{ ({}).__lookupGetter__('__proto__') }}"],
		])('should not allow access via %s', (_, expression) => {
			expect(() => {
				tournament.execute(expression, { __sanitize: sanitizer, Math, Object });
			}).toThrowError(errorRegex);
		});

		it('should not execute code through the Function constructor', () => {
			const testFn = vi.fn();
			Object.assign(global, { testFn });

			for (const expression of [
				"{{ Math.max[`constructor`]('testFn()')() }}",
				"{{ Math.max[['constructor']]('testFn()')() }}",
				"{{ Math.max[{ toString() { return 'constructor' } }]('testFn()')() }}",
			]) {
				expect(() => {
					tournament.execute(expression, { __sanitize: sanitizer, Math });
				}).toThrowError(errorRegex);
			}

			expect(testFn).not.toHaveBeenCalled();
		});

		it('should still allow safe computed property access', () => {
			const data = { __sanitize: sanitizer, obj: { a: 1, b: [10, 20] }, key: 'a' };
			expect(tournament.execute('{{ obj[key] }}', data)).toBe(1);
			expect(tournament.execute('{{ obj[`a`] }}', data)).toBe(1);
			expect(tournament.execute('{{ obj.b[1] }}', data)).toBe(20);
			expect(tournament.execute('{{ obj.b[0 + 1] }}', data)).toBe(20);
			expect(tournament.execute("{{ obj[['a']] }}", data)).toBe(1);
			expect(tournament.execute('{{ (({ a }) => a)(obj) }}', data)).toBe(1);
			expect(tournament.execute('{{ ({ [key]: 2 }).a }}', data)).toBe(2);
			expect(
				tournament.execute('{{ obj.b[Object(Symbol.iterator)]().next().value }}', {
					...data,
					Object,
					Symbol,
				}),
			).toBe(10);
		});

		it('should not allow access to constructor', () => {
			expect(() => {
				tournament.execute('{{ Number["cons" + (() => "truc")() + "tor"] }}', {
					__sanitize: sanitizer,
					Number,
				});
			}).toThrowError(errorRegex);
		});
	});
});
