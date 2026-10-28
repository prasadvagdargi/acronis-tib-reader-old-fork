/**
 * Non-fatal problems found while parsing (unknown flags, suspicious headers, etc.) are reported here.
 * By default they go to stderr. Library users can collect or silence them with setWarningHandler().
 */
export type WarningHandler = (message: string) => void;

const defaultHandler: WarningHandler = (message) => {
	console.warn('warning: ' + message);
};

let handler: WarningHandler = defaultHandler;

/**
 * Replaces the warning handler. Pass null to silence warnings, or undefined to restore the default.
 */
export function setWarningHandler(h: WarningHandler | null | undefined) {
	if(h === null) {
		handler = () => {};
	}
	else {
		handler = h || defaultHandler;
	}
}

export function warn(message: string) {
	handler(message);
}
