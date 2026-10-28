import { ReadCompressedStream } from '../compression';
import { ReadRecord, ReadChunkHeader, ReadAllBoxes } from './record';
import { Box } from './box';
import { Reader, BufferReader } from '../reader';
import { CheckAllZeros } from '../utils';
import { warn } from '../log';
import { FormatError } from '../errors';


export interface MacVolumeMetaFile {
	boxes: Box[];
}

export async function ParseMacVolumeMetaFile(reader: Reader): Promise<MacVolumeMetaFile> {

	reader.seek(0);
	let size = await reader.length();

	let allBoxes: Box[] = [];

	let blockSize = 128;

	while(reader.pos() < size) {
		let metaHeader = Buffer.from(await reader.readBytes(16));

		if(metaHeader[0] !== 0x77 || metaHeader[1] !== 0x14) {
			warn('Strange looking meta header: ' + metaHeader.toString('hex'));
		}


		let record = await ReadRecord(reader, blockSize);
		reader.seek(record.inner_start);

		if(record.flags === 0x88) {
			let chunkData = await ReadCompressedStream(
				reader, record.inner_end - record.inner_start
			);

			if(!(await CheckAllZeros(reader, record.inner_end - reader.pos()))) {
				warn('Detected unknown data in padding after compressed stream');
			}

			let chunkReader = new BufferReader(chunkData);

			let chunk = await ReadChunkHeader(chunkReader);
			
			let boxes = await ReadAllBoxes(chunkReader, chunk);

			allBoxes.push.apply(allBoxes, boxes);
		}
		else if(record.flags === 0x80) {
			// Usually is the first record and i don't know what it means
		}
		else {
			warn('Unknown metadata record flags: 0x' + record.flags.toString(16));
		}

		reader.seek(record.end);
	}

	if(reader.pos() !== size) {
		throw new FormatError('Did not correctly consume entire metafile');
	}


	return { boxes: allBoxes };
}
