import { Tournament } from '@n8n/tournament';

import {
	DollarSignValidator,
	PrototypeSanitizer,
	ThisSanitizer,
	sanitizer,
	thisSanitizer,
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
		after: [PrototypeSanitizer, ThisSanitizer, DollarSignValidator],
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

	describe('Sandbox escapes', () => {
		const data = { __sanitize: sanitizer, __sanitizeThis: thisSanitizer, Object, parseInt, Number };
		const run = (expr: string) => () => tournament.execute(expr, data);

		it.each([
			"{{ Object.getOwnPropertyDescriptor(Object, 'getPrototypeOf') }}",
			"{{ Object.getOwnPropertyDescriptor(Object, 'prototype').value }}",
			'{{ Object.getOwnPropertyDescriptors(parseInt) }}',
			'{{ Object.setPrototypeOf({}, null) }}',
			"{{ Object.defineProperty({}, 'a', {}) }}",
			"{{ ({}).__lookupGetter__('__proto__') }}",
			"{{ ({})['__defineGetter__'] }}",
			"{{ Object['getOwnPropertyDescriptor'] }}",
		])('should block reflective built-ins: %s', (expr) => {
			expect(run(expr)).toThrowError(errorRegex);
		});

		it('should block the reported Function constructor escape', () => {
			expect(
				run(
					"{{ Object.getOwnPropertyDescriptor(Object.getOwnPropertyDescriptor(Object,'getPrototypeOf').value(parseInt),'constructor').value('return 1')() }}",
				),
			).toThrowError(errorRegex);
		});

		it.each([
			'{{ parseInt[`constructor`] }}',
			'{{ parseInt[`constructor`](`return 1`)() }}',
			'{{ parseInt[`cons${"truc"}tor`] }}',
			'{{ Number[`prototype`] }}',
			'{{ ({})[`__proto__`] }}',
		])('should sanitize template literal keys: %s', (expr) => {
			expect(run(expr)).toThrowError(errorRegex);
		});

		it('should coerce computed keys once before checking them', () => {
			expect(run("{{ parseInt[{ toString: () => 'constructor' }] }}")).toThrowError(errorRegex);
			expect(run("{{ parseInt[['constructor']] }}")).toThrowError(errorRegex);

			let calls = 0;
			const key = {
				toString: () => (calls++ === 0 ? 'name' : 'constructor'),
			};
			expect(tournament.execute('{{ parseInt[key] }}', { ...data, key })).toBe('parseInt');
		});

		it.each([
			'{{ (({ constructor }) => constructor)(parseInt) }}',
			"{{ (({ 'constructor': c }) => c)(parseInt) }}",
			"{{ (({ ['constructor']: c }) => c)(parseInt) }}",
			'{{ (({ [`constructor`]: c }) => c)(parseInt) }}',
			"{{ (({ ['cons' + 'tructor']: c }) => c)(parseInt) }}",
			'{{ (({ getOwnPropertyDescriptor: g }) => g)(Object) }}',
			'{{ (() => { const { constructor: c } = parseInt; return c; })() }}',
		])('should block destructuring of forbidden properties: %s', (expr) => {
			expect(run(expr)).toThrowError(errorRegex);
		});

		it('should block with statements', () => {
			expect(run('{{ (function () { with (parseInt) { return constructor; } })() }}')).toThrowError(
				/"with" statements are not allowed/,
			);
		});

		it('should block dynamic imports', () => {
			expect(run("{{ import('child_process') }}")).toThrowError(/Dynamic imports are not allowed/);
		});

		it('should not leak globalThis through `this` in plain function calls', () => {
			expect(tournament.execute('{{ (function () { return this; })() }}', data)).toBeUndefined();
			expect(
				tournament.execute('{{ [1].map(function () { return this; })[0] }}', data),
			).toBeUndefined();
			expect(run('{{ (function () { return this.process; })() }}')).toThrowError(TypeError);
			expect(
				tournament.execute('{{ (function () { return this.x; }).call({ x: 3 }) }}', data),
			).toBe(3);
			expect(tournament.execute('{{ ({ x: 2, f() { return this.x; } }).f() }}', data)).toBe(2);
		});

		it('should still allow safe computed and destructured access', () => {
			expect(tournament.execute('{{ ({ a: 1 })[`a`] }}', data)).toBe(1);
			expect(tournament.execute('{{ [1, 2, 3][1] }}', data)).toBe(2);
			expect(tournament.execute("{{ (({ a, ['b']: c }) => a + c)({ a: 1, b: 2 }) }}", data)).toBe(
				3,
			);
			expect(tournament.execute("{{ Object.keys({ a: 1 }).join('') }}", data)).toBe('a');
			expect(tournament.execute('{{ Object.entries({ a: 1 })[0][1] }}', data)).toBe(1);
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
	});
});
