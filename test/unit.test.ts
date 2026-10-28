import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import search from '../src/search';
import { AssertKeys, ComputeAdler32 } from '../src/utils';
import { BufferReader, ConcatenatedReader, FileReader, readUint64LE } from '../src/reader';
import { ReadCompressedStream } from '../src/compression';
import { LRUCache } from '../src/cache';
import { FormatError } from '../src/errors';
import { setWarningHandler } from '../src/log';
import { safeFileName } from '../src/fs/extract';
import { splitPath } from '../src/fs/tree';
import { parseRange } from '../src/mount/webdav';
import { normalizeDriveTarget } from '../src/mount/rclone';
import { tempDir } from './helpers/windows-fixture';


describe('search', () => {
	let arr = [1, 3, 5, 7, 9];

	test('finds exact matches', () => {
		for(let i = 0; i < arr.length; i++) {
			assert.equal(search(arr, arr[i]), i);
		}
	});

	test('returns -1 for missing values, including past the end', () => {
		assert.equal(search(arr, 4), -1);
		assert.equal(search(arr, 0), -1);
		// Used to return 5 (out of range)
		assert.equal(search(arr, 100), -1);
		assert.equal(search([], 1), -1);
	});

	test('approximate mode clamps to a valid index', () => {
		assert.equal(search(arr, 100, null, true), arr.length - 1);
		assert.equal(search(arr, 4, null, true), 2);
		assert.equal(search([], 1, null, true), -1);
	});
});


describe('AssertKeys', () => {
	test('warns about unknown keys instead of failing', () => {
		let warnings: string[] = [];
		setWarningHandler((m) => warnings.push(m));
		try {
			AssertKeys({ a: 1, b: 2, extra: 3 }, ['a', 'b']);
		}
		finally {
			setWarningHandler(undefined);
		}
		assert.equal(warnings.length, 1);
		assert.match(warnings[0], /extra/);
	});

	test('throws for missing keys unless all are optional', () => {
		assert.throws(() => AssertKeys({ a: 1 }, ['a', 'z']), FormatError);
		// Used to throw when the missing key sorted after every present key
		AssertKeys({ a: 1 }, ['a', 'z'], true);
		AssertKeys({ IncludePath: [] }, ['IncludePath', 'MachineId'], true);
	});
});


test('Adler-32 matches a known value', () => {
	assert.equal(ComputeAdler32(Buffer.from('Wikipedia')), 0x11E60398);
});


describe('64-bit reads', () => {
	test('reads values up to 2^53 exactly', () => {
		let b = Buffer.alloc(8);
		b.writeBigUInt64LE(BigInt(Number.MAX_SAFE_INTEGER));
		assert.equal(readUint64LE(b, 0), Number.MAX_SAFE_INTEGER);
	});

	test('throws instead of silently losing precision', () => {
		let b = Buffer.alloc(8);
		b.writeBigUInt64LE(1n << 60n);
		assert.throws(() => readUint64LE(b, 0), RangeError);
	});
});


describe('BufferReader', () => {
	test('reads little-endian integers and refuses to read past the end', async () => {
		let r = new BufferReader(Buffer.from('0102030405060708', 'hex'));
		assert.equal(await r.readUint16(), 0x0201);
		assert.equal(await r.readUint24(), 0x050403);
		await assert.rejects(r.readBytes(10), RangeError);
	});

	test('slices are bounds-checked', () => {
		let r = new BufferReader(Buffer.alloc(10));
		assert.throws(() => r.slice(5, 20), RangeError);
		assert.throws(() => r.slice(-1), RangeError);
		assert.equal(r.slice(2, 4) instanceof BufferReader, true);
	});
});


describe('FileReader', () => {
	let dir = tempDir();
	let file = path.join(dir, 'data.bin');
	fs.writeFileSync(file, Buffer.from('0123456789'));

	test('slices share the file handle until everything is closed', async () => {
		let r = await FileReader.Create(file);
		let s = r.slice(2, 6);
		await r.close();
		await r.close(); // harmless

		s.seek(0);
		assert.equal((await s.readBytes(4)).toString(), '2345');
		await assert.rejects(s.readBytes(1), RangeError);

		await s.close();
		await assert.rejects(s.readBytes(1), /closed/);
	});

	test('rejects out-of-range slices and huge reads', async () => {
		let r = await FileReader.Create(file);
		try {
			assert.throws(() => r.slice(0, 11), RangeError);
			assert.throws(() => r.slice(6, 5), RangeError);
			await assert.rejects(r.readBytes(1024 * 1024 * 1024), RangeError);
		}
		finally {
			await r.close();
		}

		// On Windows this fails if a handle leaked
		fs.rmSync(dir, { recursive: true });
	});
});


describe('ConcatenatedReader', () => {
	test('reads across reader boundaries', async () => {
		let c = await ConcatenatedReader.Create([
			new BufferReader(Buffer.from('abc')), new BufferReader(Buffer.from('defg')), new BufferReader(Buffer.from('h'))
		]);
		assert.equal(await c.length(), 8);
		c.seek(1);
		assert.equal((await c.readBytes(6)).toString(), 'bcdefg');
		assert.equal(c.pos(), 7);
	});

	test('reads past the end fail cleanly', async () => {
		let c = await ConcatenatedReader.Create([ new BufferReader(Buffer.from('abc')) ]);
		c.seek(2);
		await assert.rejects(c.readBytes(5), RangeError);
		c.seek(10);
		await assert.rejects(c.readBytes(1), RangeError);
	});
});


describe('ReadCompressedStream', () => {
	let data = crypto.randomBytes(200 * 1024); // incompressible, so the stream is bigger than the first window

	test('known length: positions the reader right after the stream, before padding', async () => {
		let comp = zlib.deflateSync(Buffer.from('hello'.repeat(100)));
		let r = new BufferReader(Buffer.concat([ comp, Buffer.alloc(13) ]));
		let out = await ReadCompressedStream(r, comp.length + 13);
		assert.equal(out.toString(), 'hello'.repeat(100));
		assert.equal(r.pos(), comp.length);
	});

	test('unknown length: finds the end of the stream with data after it', async () => {
		let comp = zlib.deflateRawSync(data);
		let r = new BufferReader(Buffer.concat([ Buffer.from([7]), comp, Buffer.from('NEXT') ]));
		r.seek(1);
		let out = await ReadCompressedStream(r, -1, true);
		assert.ok(out.equals(data));
		assert.equal((await r.readBytes(4)).toString(), 'NEXT');
	});

	test('limits the decompressed size', async () => {
		let comp = zlib.deflateSync(Buffer.alloc(1024 * 1024));
		await assert.rejects(ReadCompressedStream(new BufferReader(comp), comp.length, false, 1000), FormatError);
	});

	test('reports corrupt and truncated streams as FormatError', async () => {
		await assert.rejects(ReadCompressedStream(new BufferReader(Buffer.from('not zlib at all')), -1), FormatError);
		let comp = zlib.deflateSync(data);
		await assert.rejects(ReadCompressedStream(new BufferReader(comp.subarray(0, 1000)), -1), FormatError);
	});
});


describe('LRUCache', () => {
	test('evicts the least recently used entries by size', () => {
		let c = new LRUCache<string, Buffer>(10, (b) => b.length);
		c.set('a', Buffer.alloc(4));
		c.set('b', Buffer.alloc(4));
		c.get('a');
		c.set('c', Buffer.alloc(4));
		assert.ok(c.get('a'));
		assert.equal(c.get('b'), undefined);
		assert.ok(c.get('c'));
		assert.ok(c.totalBytes <= 10);
	});

	test('shares concurrent loads and does not cache failures', async () => {
		let c = new LRUCache<string, Buffer>(100, (b) => b.length);
		let loads = 0;
		let load = async () => { loads++; await new Promise((r) => setTimeout(r, 10)); return Buffer.alloc(1); };
		await Promise.all([ c.getOrLoad('k', load), c.getOrLoad('k', load), c.getOrLoad('k', load) ]);
		assert.equal(loads, 1);

		await assert.rejects(c.getOrLoad('bad', async () => { throw new Error('boom'); }));
		assert.equal((await c.getOrLoad('bad', async () => Buffer.alloc(2))).length, 2);
	});
});


describe('paths and names', () => {
	test('splitPath rejects . and ..', () => {
		assert.deepEqual(splitPath('/a//b/'), ['a', 'b']);
		assert.deepEqual(splitPath('a\\b'), ['a', 'b']);
		assert.throws(() => splitPath('/a/../b'));
		assert.throws(() => splitPath('./a'));
	});

	test('safeFileName makes names safe on each OS', () => {
		assert.equal(safeFileName('..', 'linux'), '_..');
		assert.equal(safeFileName('.', 'linux'), '_.');
		assert.equal(safeFileName('..', 'win32'), '__');
		assert.equal(safeFileName(''), '_');
		assert.equal(safeFileName('a/b', 'linux'), 'a_b');
		assert.equal(safeFileName('a:b', 'linux'), 'a:b');
		assert.equal(safeFileName('a:b?.txt', 'win32'), 'a_b_.txt');
		assert.equal(safeFileName('CON', 'win32'), '_CON');
		assert.equal(safeFileName('nul.txt', 'win32'), '_nul.txt');
		assert.equal(safeFileName('trailing. ', 'win32'), 'trailing__');
	});
});


test('drive targets: letters on Windows, folders elsewhere', () => {
	assert.equal(normalizeDriveTarget('r', 'win32'), 'R:');
	assert.equal(normalizeDriveTarget('R:', 'win32'), 'R:');
	assert.equal(normalizeDriveTarget('C:\\mnt\\backup', 'win32'), 'C:\\mnt\\backup');
	assert.equal(normalizeDriveTarget('r', 'linux'), 'r');
	assert.equal(normalizeDriveTarget('/mnt/backup', 'darwin'), '/mnt/backup');
});


describe('HTTP range parsing', () => {
	test('handles the usual forms', () => {
		assert.deepEqual(parseRange('bytes=0-9', 100), [0, 10]);
		assert.deepEqual(parseRange('bytes=90-', 100), [90, 100]);
		assert.deepEqual(parseRange('bytes=-10', 100), [90, 100]);
		assert.deepEqual(parseRange('bytes=50-500', 100), [50, 100]);
		assert.equal(parseRange(undefined, 100), null);
		assert.equal(parseRange('bytes=0-1,5-6', 100), null);
	});

	test('rejects unsatisfiable ranges', () => {
		assert.equal(parseRange('bytes=100-', 100), 'invalid');
		assert.equal(parseRange('bytes=5-2', 100), 'invalid');
		assert.equal(parseRange('bytes=-', 100), 'invalid');
	});
});
