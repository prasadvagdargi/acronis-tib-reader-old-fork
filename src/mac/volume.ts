import Volume, { VolumeVersion, VolumeHeader } from '../volume';
import { Box, BoxHandle, ReadBox } from './box';
import { ReadRecord, ReadChunkHeader, ReadAllBoxes } from './record';
import { ReadCompressedStream } from '../compression';
import { BufferReader, Reader } from '../reader';
import { CheckAllZeros } from '../utils';
import { FormatError } from '../errors';
import { warn } from '../log';
import { createBlockCache } from '../cache';


/**
 * Represents the single .tib file stored for MacOS
 */
export default class MacVolume extends Volume {

	public static async OpenImpl(fileName: string, reader: Reader, header: VolumeHeader) {
		return new MacVolume(fileName, reader, header);
	}

	// Decompressed records, by offset
	private _cache = createBlockCache<number>();

	/**
	 * Gets the starting offset of actual records in this file
	 * Most offsets referenced in the metadata file will be relative to this offset
	 */
	startOffset() {
		return this.header.blockSize * 3;
	}

	/**
	 * Decompresses the record holding a box (cached, since a record holds many boxes)
	 */
	private readRecordData(handle: BoxHandle): Promise<Buffer> {
		return this._cache.getOrLoad(handle.record_start, async () => {
			let reader = this.reader.slice();
			try {
				reader.seek(this.startOffset() + handle.record_start);

				let record = await ReadRecord(reader, this.header.blockSize);

				if(record.end - record.start !== handle.record_size) {
					throw new FormatError('Handle record size mismatch with file');
				}

				reader.seek(record.inner_start);

				return await ReadCompressedStream(reader, record.inner_end - record.inner_start);
			}
			finally {
				await reader.close();
			}
		});
	}

	async readBoxHandle(handle: BoxHandle): Promise<Box> {

		let chunkReader = new BufferReader(await this.readRecordData(handle));

		// TODO: We could use the header for safety bounding the compressed stream?
		await ReadChunkHeader(chunkReader);

		// TODO: Needing 5 here suggests the handle offsets are counted from a different point than assumed
		chunkReader.seek(handle.start - 5);

		// TODO: Check the box type against handle.type
		return ReadBox(chunkReader);
	}

	/**
	 * Reads every single record/box in the file from the beginning to the end
	 * NOTE: Not advisable for large archives as this will store it all in memory
	 *
	 * This is mostly intented for verifying an entire file from beginning to end
	 */
	async readAll(): Promise<Box[]> {

		let reader = this.reader.slice();
		try {
			reader.seek(this.startOffset());

			let size = await reader.length();

			if(size % this.header.blockSize !== 0) {
				warn('File not aligned to block multiples');
			}

			let allBoxes: Box[] = [];

			while(reader.pos() < size) {

				let record = await ReadRecord(reader, this.header.blockSize);

				reader.seek(record.inner_start);

				let chunkData = await ReadCompressedStream(
					reader, record.inner_end - record.inner_start,
				);

				if(!(await CheckAllZeros(reader, record.inner_end - reader.pos()))) {
					warn('Detected unknown data in padding after compressed stream');
				}

				let chunkReader = new BufferReader(chunkData);

				let chunk = await ReadChunkHeader(chunkReader);

				let boxes = await ReadAllBoxes(chunkReader, chunk);
				allBoxes.push(...boxes);

				reader.seek(record.end);
			}

			if(reader.pos() !== size) {
				throw new FormatError('Over/underrun of file');
			}

			return allBoxes;
		}
		finally {
			await reader.close();
		}
	}

	override close() {
		this._cache.clear();
		return super.close();
	}
}

Volume.AddType(VolumeVersion.Mac, MacVolume.OpenImpl);
