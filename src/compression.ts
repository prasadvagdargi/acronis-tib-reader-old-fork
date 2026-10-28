import zlib from 'node:zlib';
import { Reader } from './reader';
import { FormatError } from './errors';

/**
 * Largest decompressed size we accept for one stream. Protects against corrupt or malicious
 * files that decompress to huge amounts of data ("zip bombs").
 */
export const MAX_DECOMPRESSED_SIZE = 256 * 1024 * 1024;

// First read size when the compressed length isn't known. Grows 4x each time the stream doesn't fit.
const INITIAL_WINDOW = 64 * 1024;
const MAX_WINDOW = 256 * 1024 * 1024;


interface InflateResult {
	buffer: Buffer;
	engine: { bytesWritten: number };
}

function inflate(data: Buffer, raw: boolean, maxOutputLength: number): InflateResult {
	let opts = { info: true, maxOutputLength } as const;
	let res = raw ? zlib.inflateRawSync(data, opts) : zlib.inflateSync(data, opts);
	return res as unknown as InflateResult;
}

function isTruncatedError(e: any) {
	return e && e.code === 'Z_BUF_ERROR';
}


/**
 * Reads a zlib (or raw deflate) stream starting at the reader's current position.
 *
 * On return the reader is positioned immediately after the end of the compressed stream, even if
 * 'length' included padding after it.
 *
 * @param length number of bytes that contain the stream, or -1 if unknown (the end is then found by decompressing)
 * @param raw if true, a raw deflate stream is read instead of a zlib stream with header and checksum
 * @param maxOutputLength limit on the decompressed size
 */
export async function ReadCompressedStream(
	reader: Reader, length: number, raw = false, maxOutputLength = MAX_DECOMPRESSED_SIZE
): Promise<Buffer> {

	let start = reader.pos();

	if(length >= 0) {
		let data = await reader.readBytes(length);

		let res: InflateResult;
		try {
			res = inflate(data, raw, maxOutputLength);
		}
		catch(e: any) {
			throw new FormatError('Failed to decompress stream at ' + start + ': ' + e.message);
		}

		reader.seek(start + res.engine.bytesWritten);
		return res.buffer;
	}

	// Unknown length: decompress a growing window until the whole stream fits in it
	let available = (await reader.length()) - start;
	let window = Math.min(INITIAL_WINDOW, available);

	while(true) {
		reader.seek(start);
		let data = await reader.readBytes(window);

		try {
			let res = inflate(data, raw, maxOutputLength);
			reader.seek(start + res.engine.bytesWritten);
			return res.buffer;
		}
		catch(e: any) {
			if(!isTruncatedError(e)) {
				throw new FormatError('Failed to decompress stream at ' + start + ': ' + e.message);
			}

			if(window >= available || window >= MAX_WINDOW) {
				throw new FormatError('Compressed stream at ' + start + ' never ends');
			}

			window = Math.min(window * 4, available, MAX_WINDOW);
		}
	}
}
