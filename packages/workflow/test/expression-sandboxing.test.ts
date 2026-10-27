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

		it('should not allow reflection helpers that leak forbidden values', () => {
			const data = { __sanitize: sanitizer, Object, parseInt };
			for (const expr of [
				"{{ Object.getOwnPropertyDescriptor(Object, 'getPrototypeOf') }}",
				"{{ Object.getOwnPropertyDescriptor(Object, 'prototype').value }}",
				"{{ Object['getOwnPropertyDescriptors'](parseInt) }}",
				'{{ Object.defineProperty({}, "a", {}) }}',
				'{{ Object.setPrototypeOf({}, null) }}',
				'{{ ({}).__lookupGetter__("a") }}',
				'{{ ({}).__defineGetter__("a", () => 1) }}',
			]) {
				expect(() => tournament.execute(expr, data)).toThrowError(errorRegex);
			}
		});

		it('should not allow destructuring forbidden properties', () => {
			const data = { __sanitize: sanitizer, parseInt };
			for (const expr of [
				'{{ (({ constructor: c }) => c)(parseInt) }}',
				'{{ (({ constructor }) => constructor)(parseInt) }}',
				"{{ (({ 'constructor': c }) => c)(parseInt) }}",
				"{{ (({ ['constructor']: c }) => c)(parseInt) }}",
				"{{ (({ ['constr' + 'uctor']: c }) => c)(parseInt) }}",
				'{{ (({ [`constructor`]: c }) => c)(parseInt) }}',
				'{{ (() => { const { constructor: c } = parseInt; return c; })() }}',
				'{{ (({ a: { constructor: c } }) => c)({ a: parseInt }) }}',
			]) {
				expect(() => tournament.execute(expr, data)).toThrowError(errorRegex);
			}
		});

		it('should still allow safe destructuring', () => {
			const expr =
				"{{ (({ a, ['b']: b, [`c`]: c, 0: d }) => a + b + c + d)({ a: 1, b: 2, c: 3, 0: 4 }) }}";
			expect(tournament.execute(expr, { __sanitize: sanitizer })).toBe(10);
		});

		it('should not allow "with" statements', () => {
			expect(() =>
				tournament.execute('{{ (() => { with (parseInt) { return 1; } })() }}', {
					__sanitize: sanitizer,
					parseInt,
				}),
			).toThrowError('"with" statements are not allowed due to security concerns');
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

		it('should not allow access to constructor via template literals', () => {
			const data = { __sanitize: sanitizer, parseInt };
			expect(() => tournament.execute('{{ parseInt[`constructor`] }}', data)).toThrowError(
				errorRegex,
			);
			expect(() =>
				// eslint-disable-next-line n8n-local-rules/no-interpolation-in-regular-string
				tournament.execute('{{ parseInt[`constr${"uctor"}`] }}', data),
			).toThrowError(errorRegex);
		});

		it('should not allow access to forbidden properties via non-string keys', () => {
			const data = { __sanitize: sanitizer, parseInt };
			expect(() => tournament.execute("{{ parseInt[['constructor']] }}", data)).toThrowError(
				errorRegex,
			);
			expect(() =>
				tournament.execute("{{ parseInt[{ toString: () => 'constructor' }] }}", data),
			).toThrowError(errorRegex);
		});

		it('should still allow safe computed access', () => {
			const data = { __sanitize: sanitizer, obj: { a: 1, 0: 'zero' }, arr: [5, 6] };
			expect(tournament.execute('{{ obj[`a`] }}', data)).toBe(1);
			expect(tournament.execute('{{ obj[0] }}', data)).toBe('zero');
			expect(tournament.execute('{{ arr[1] }}', data)).toBe(6);
			expect(tournament.execute('{{ arr[arr.length - 1] }}', data)).toBe(6);
		});
	});
});
