import adler32 from 'adler-32';
import xml2js from 'xml2js';
import { Reader } from './reader';
import { FormatError } from './errors';
import { warn } from './log';


export function ComputeAdler32(data: Buffer): number {
	// adler32.buf returns a signed number. Convert it to unsigned.
	return adler32.buf(data) >>> 0;
}


export async function CheckAllZeros(reader: Reader, count: number): Promise<boolean> {
	let bytes = await reader.readBytes(count);
	for(let i = 0; i < bytes.length; i++) {
		if(bytes[i] !== 0) {
			return false;
		}
	}

	return true;
}


export async function ParseXML(str: string): Promise<any> {
	return await xml2js.parseStringPromise(str);
}

/**
 * Checks the keys of a parsed XML object.
 *
 * Unknown keys only produce a warning, so newer True Image versions that add fields can still be read.
 * Missing keys throw, unless 'allOptional' is set.
 */
export function AssertKeys(obj: any, targetKeys: string[], allOptional?: boolean, context = 'object') {
	if(obj === null || typeof(obj) !== 'object') {
		throw new FormatError('Expected an object for ' + context);
	}

	let curKeys = Object.keys(obj);

	let unknown = curKeys.filter((k) => targetKeys.indexOf(k) < 0);
	let missing = targetKeys.filter((k) => curKeys.indexOf(k) < 0);

	if(unknown.length > 0) {
		warn('Unknown keys in ' + context + ': ' + JSON.stringify(unknown));
	}

	if(missing.length > 0 && !allOptional) {
		throw new FormatError('Missing keys in ' + context + ': ' + JSON.stringify(missing));
	}
}


const UUID_REGEX = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

/**
 * Warns (doesn't throw) if a string doesn't look like a UUID, since it doesn't stop us reading the backup
 */
export function AssertValidUUID(str: string) {
	if(typeof(str) !== 'string' || !UUID_REGEX.test(str)) {
		warn('Not a valid uuid: ' + str);
	}
}

export function AssertValidNumber(str: string) {
	if(typeof(str) !== 'string' || !(/^[0-9]+$/).test(str)) {
		throw new FormatError('Not a valid number: ' + str);
	}
}
