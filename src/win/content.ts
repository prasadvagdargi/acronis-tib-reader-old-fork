import crypto from 'node:crypto';
import { Reader } from '../reader';
import { ReadCompressedStream } from '../compression';
import { LRUCache } from '../cache';
import { FormatError } from '../errors';
import { IndexRecord, PeekRecordType, ReadRecord, RecordType } from './record';
import search from '../search';


/**
 * Metadata records stored for each listing entry (see doc/Format-Windows.md)
 */
export interface EntryMeta {
	attributes?: number; /**< Windows FILE_ATTRIBUTE_* flags */
	created?: Date;
	modified?: Date;
	index?: IndexRecord; /**< Only present for files with data */
}

// Record types that can follow an entry's FileMetaStart
const ENTRY_META_TYPES = new Set<number>([
	RecordType.Attributes, RecordType.Security, RecordType.Times, RecordType.RecordIndex
]);

/**
 * Reads the metadata records of one listing entry
 *
 * @param reader reader over the whole archive (a slice is taken, so it isn't moved)
 * @param metaOffset the entry's metaOffset from the listing
 */
export async function ReadEntryMeta(reader: Reader, metaOffset: number): Promise<EntryMeta> {
	let r = reader.slice();
	try {
		r.seek(metaOffset);

		let first = await ReadRecord(r);
		if(first.type !== RecordType.FileMetaStart) {
			throw new FormatError('Expected entry metadata at ' + metaOffset + ', found record type ' + first.type);
		}

		let meta: EntryMeta = {};
		let size = await r.length();

		// Stop at the next entry (or anything else) without decompressing it
		while(r.pos() < size && ENTRY_META_TYPES.has(await PeekRecordType(r))) {
			let rec = await ReadRecord(r);
			if(rec.type === RecordType.Attributes) {
				meta.attributes = rec.attributes;
			}
			else if(rec.type === RecordType.Times) {
				meta.created = rec.created;
				meta.modified = rec.modified;
			}
			else if(rec.type === RecordType.RecordIndex) {
				if(meta.index) {
					throw new FormatError('Entry at ' + metaOffset + ' has more than one record index');
				}
				meta.index = rec;
			}
		}

		return meta;
	}
	finally {
		await r.close();
	}
}


/**
 * Reads byte ranges of one file using its record index.
 *
 * Blocks are checked against their stored MD5 hashes as they are decompressed.
 */
export class WindowsFileContent {

	constructor(
		private _reader: Reader, /**< Reader over the whole archive */
		private _index: IndexRecord,
		private _cache: LRUCache<number, Buffer>,
		private _verify = true
	) {}

	get size() {
		return this._index.totalSize;
	}

	/**
	 * Reads [offset, offset + length), clamped to the file size
	 */
	async read(offset: number, length: number): Promise<Buffer> {
		let end = Math.min(offset + length, this.size);
		if(offset >= end) {
			return Buffer.alloc(0);
		}

		// Parts of a block that aren't stored are zeros
		let out = Buffer.alloc(end - offset);

		let handles = this._index.handles;

		// Last block starting at or before 'offset'
		let i = search(handles, offset, (h, v) => h.startOffset <= v ? -1 : 1, true);
		if(i < 0) {
			return out;
		}
		if(handles[i].startOffset > offset) {
			i--;
		}
		i = Math.max(i, 0);

		for(; i < handles.length && handles[i].startOffset < end; i++) {
			let h = handles[i];
			let blockEnd = i + 1 < handles.length ? handles[i + 1].startOffset : this.size;

			let data = await this.loadBlock(i);
			if(h.startOffset + data.length > blockEnd) {
				throw new FormatError('Block at ' + h.startOffset + ' is larger than its slot in the file');
			}

			let from = Math.max(offset, h.startOffset);
			let to = Math.min(end, h.startOffset + data.length);
			if(to > from) {
				data.copy(out, from - offset, from - h.startOffset, to - h.startOffset);
			}
		}

		return out;
	}

	/**
	 * Checks every block of the file against its MD5. Returns the number of blocks checked.
	 */
	async verify(): Promise<number> {
		for(let i = 0; i < this._index.handles.length; i++) {
			await this.loadBlock(i, true);
		}

		return this._index.handles.length;
	}

	private loadBlock(i: number, skipCache = false): Promise<Buffer> {
		let h = this._index.handles[i];

		let load = async () => {
			let r = this._reader.slice();
			try {
				r.seek(h.recordOffset);

				let type = await r.readUint8();
				if(type !== RecordType.Blob) {
					throw new FormatError('Expected a data block at ' + h.recordOffset + ', found record type ' + type);
				}

				let data = await ReadCompressedStream(r, -1);

				if(this._verify || skipCache) {
					let hash = crypto.createHash('md5').update(data).digest();
					if(!hash.equals(h.hash)) {
						throw new FormatError('Checksum mismatch in data block at ' + h.recordOffset + ' (file offset ' + h.startOffset + ')');
					}
				}

				return data;
			}
			finally {
				await r.close();
			}
		};

		return skipCache ? load() : this._cache.getOrLoad(h.recordOffset, load);
	}
}
