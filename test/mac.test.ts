import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { MacFS } from '../src/mac/fs';
import { FileEntry, FileType } from '../src/mac/file_entry';
import { BoxHandle, BoxType } from '../src/mac/box';
import MacVolume from '../src/mac/volume';


// Mac parsing can't be tested against real files (the samples are gone), so this checks the tree
// building and block maths against a stub volume.

const t = new Date('2020-01-01T00:00:00Z');

function blob(record_start: number, size: number): BoxHandle {
	return { type: 4, record_start, record_size: 4096, start: 0, size };
}

function dir(name: string, numEntries: number): FileEntry {
	return { type: FileType.Directory, name, numEntries, size: 0, start: 0, end: 0, extent: 0, atime: t, mtime: t, handles: [] };
}

function file(name: string, handles: BoxHandle[]): FileEntry {
	let size = handles.filter((h) => h.type === 4).reduce((n, h) => n + h.size, 0);
	return { type: FileType.Regular, name, size, start: 0, end: 0, extent: 0, atime: t, mtime: t, handles };
}

describe('Mac file system view', () => {
	// Block contents by record_start
	let blocks = new Map<number, Buffer>([
		[ 1, Buffer.from('0123') ],
		[ 2, Buffer.from('456789') ],
		[ 3, Buffer.from('abc') ],
		[ 4, Buffer.from('hello') ],
	]);

	let reads = 0;
	let volume = {
		async readBoxHandle(h: BoxHandle) {
			reads++;
			return { type: BoxType.Blob, start: 0, end: 0, data: blocks.get(h.record_start)! };
		}
	} as unknown as MacVolume;

	// Pre-order list; folders count all of their descendants
	let files: FileEntry[] = [
		dir('root:', 5),
		dir('docs', 3),
		file('a.txt', [ blob(1, 4), blob(2, 6) ]),
		dir('empty', 0),
		file('b.txt', [ { type: 5, record_start: 9, record_size: 0, start: 0, size: 19 }, blob(3, 3) ]),
		file('top.txt', [ blob(4, 5) ]),
	];

	let vfs = new MacFS(volume, files, t);

	test('builds the folder tree from the flattened listing', async () => {
		assert.deepEqual((await vfs.list('/'))!.map((e) => e.name), ['docs', 'top.txt']);
		assert.deepEqual((await vfs.list('/docs'))!.map((e) => e.name), ['a.txt', 'empty', 'b.txt']);
		assert.deepEqual(await vfs.list('/docs/empty'), []);
		assert.equal((await vfs.stat('/docs/a.txt'))!.size, 10);
	});

	test('reads at every offset, including reads that start in a later block', async () => {
		let expected = '0123456789';
		for(let off = 0; off <= 10; off++) {
			for(let len = 0; len <= 11 - off; len++) {
				let got = (await vfs.read('/docs/a.txt', off, len)).toString();
				assert.equal(got, expected.slice(off, off + len), 'offset ' + off + ' length ' + len);
			}
		}
	});

	test('skips non-data handles and stops reading after the requested range', async () => {
		assert.equal((await vfs.read('/docs/b.txt', 0, 10)).toString(), 'abc');

		reads = 0;
		await vfs.read('/docs/a.txt', 0, 2);
		assert.equal(reads, 1);
	});
});
