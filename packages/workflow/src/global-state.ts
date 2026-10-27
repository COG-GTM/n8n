import { IANAZone } from 'luxon';

import { deepCopy } from './utils';

export interface GlobalState {
	defaultTimezone: string;
}

let globalState: GlobalState = { defaultTimezone: 'America/New_York' };

export function setGlobalState(state: GlobalState) {
	globalState = state;
}

export function getGlobalState() {
	return deepCopy(globalState);
}

export function isValidTimezone(timezone: unknown): timezone is string {
	return typeof timezone === 'string' && IANAZone.isValidZone(timezone);
}

/**
 * Returns the given timezone if it is a valid IANA zone, otherwise the instance default timezone.
 */
export function resolveTimezone(timezone?: string): string {
	return isValidTimezone(timezone) ? timezone : globalState.defaultTimezone;
}
