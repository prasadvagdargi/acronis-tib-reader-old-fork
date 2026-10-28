/**
 * The file doesn't match what we know about the .tib format (corrupt, truncated or an unknown variant)
 */
export class FormatError extends Error {
	override name = 'FormatError';
}

/**
 * The file looks valid, but uses a part of the format this library can't read yet
 */
export class NotSupportedError extends Error {
	override name = 'NotSupportedError';
}
