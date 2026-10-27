import { mock } from 'jest-mock-extended';
import { Settings } from 'luxon';
import type { IExecuteFunctions } from 'n8n-workflow';

import { parseDate } from '../../V2/GenericFunctions';

describe('DateTime V2 parseDate', () => {
	const originalDefaultZone = Settings.defaultZone;

	afterEach(() => {
		Settings.defaultZone = originalDefaultZone;
	});

	it('should interpret custom-formatted input in the workflow timezone', () => {
		Settings.defaultZone = 'UTC';
		const context = mock<IExecuteFunctions>();
		context.getTimezone.mockReturnValue('America/New_York');

		const parsed = parseDate.call(context, '2026-01-01 09:00', {
			timezone: 'America/New_York',
			fromFormat: 'yyyy-MM-dd HH:mm',
		});

		expect(parsed.zoneName).toBe('America/New_York');
		expect(parsed.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-01-01 09:00');
	});
});
