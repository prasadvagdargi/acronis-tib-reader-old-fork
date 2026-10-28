import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { extract, safeFileName } from '../src/fs/extract';
import { WebDavServer } from '../src/mount/webdav';
import { MemoryFS } from './helpers/memory-fs';
import { tempDir } from './helpers/windows-fixture';


function sampleFS() {
	return new MemoryFS([
		{ path: '/top.txt', data: Buffer.from('top'), mtime: new Date('2021-01-01T00:00:00Z') },
		{ path: '/Docs', mtime: new Date('2022-02-02T00:00:00Z') },
		{ path: '/Docs/Café notes.txt', data: Buffer.from('accents'), mtime: new Date('2023-03-03T00:00:00Z') },
		{ path: '/Docs/a?b.txt', data: Buffer.from('odd name') },
		{ path: '/Docs/big.bin', data: Buffer.alloc(3 * 1024 * 1024 + 7, 0x41) },
		{ path: '/Docs/Sub/deep.txt', data: Buffer.from('deep') },
	]);
}


describe('extract', () => {
	test('copies a folder with contents and modified times', async () => {
		let dest = tempDir();
		let res = await extract(sampleFS(), '/Docs', dest, { chunkSize: 1024 * 1024 });

		assert.deepEqual(res, { files: 4, directories: 1, bytes: 7 + 8 + 3 * 1024 * 1024 + 7 + 4 });
		assert.equal(fs.readFileSync(path.join(dest, 'Café notes.txt'), 'utf8'), 'accents');
		assert.equal(fs.readFileSync(path.join(dest, safeFileName('a?b.txt')), 'utf8'), 'odd name');
		assert.equal(fs.readFileSync(path.join(dest, 'Sub', 'deep.txt'), 'utf8'), 'deep');
		assert.equal(fs.statSync(path.join(dest, 'big.bin')).size, 3 * 1024 * 1024 + 7);
		assert.equal(fs.statSync(path.join(dest, 'Café notes.txt')).mtime.toISOString(), '2023-03-03T00:00:00.000Z');

		fs.rmSync(dest, { recursive: true });
	});

	test('extracts a single file into the destination', async () => {
		let dest = tempDir();
		await extract(sampleFS(), '/top.txt', dest);
		assert.deepEqual(fs.readdirSync(dest), ['top.txt']);
		fs.rmSync(dest, { recursive: true });
	});

	test('does not overwrite unless asked', async () => {
		let dest = tempDir();
		fs.writeFileSync(path.join(dest, 'top.txt'), 'mine');

		await assert.rejects(extract(sampleFS(), '/top.txt', dest), /already exists/);
		assert.equal(fs.readFileSync(path.join(dest, 'top.txt'), 'utf8'), 'mine');

		await extract(sampleFS(), '/top.txt', dest, { overwrite: true });
		assert.equal(fs.readFileSync(path.join(dest, 'top.txt'), 'utf8'), 'top');
		fs.rmSync(dest, { recursive: true });
	});

	test('fails for paths that are not in the backup', async () => {
		await assert.rejects(extract(sampleFS(), '/nope', tempDir()), /No such file/);
	});
});


describe('WebDAV server', () => {
	let server: WebDavServer;
	let base = '';

	before(async () => {
		server = new WebDavServer(sampleFS());
		let addr = await server.listen(0);
		base = 'http://127.0.0.1:' + addr.port;
	});

	after(async () => {
		await server.close();
	});

	test('OPTIONS advertises WebDAV', async () => {
		let r = await fetch(base + '/', { method: 'OPTIONS' });
		assert.equal(r.status, 200);
		assert.equal(r.headers.get('dav'), '1, 2');
	});

	test('PROPFIND lists a folder with encoded names', async () => {
		let r = await fetch(base + '/Docs/', { method: 'PROPFIND', headers: { Depth: '1' } });
		assert.equal(r.status, 207);
		let xml = await r.text();
		assert.match(xml, /<D:href>\/Docs\/<\/D:href>/);
		assert.match(xml, /<D:href>\/Docs\/Caf%C3%A9%20notes\.txt<\/D:href>/);
		assert.match(xml, /<D:href>\/Docs\/Sub\/<\/D:href>/);
		assert.match(xml, /<D:getcontentlength>7<\/D:getcontentlength>/);

		let r0 = await fetch(base + '/Docs/', { method: 'PROPFIND', headers: { Depth: '0' } });
		assert.equal((await r0.text()).match(/<D:response>/g)!.length, 1);
	});

	test('GET returns whole files and ranges', async () => {
		let r = await fetch(base + '/Docs/Caf%C3%A9%20notes.txt');
		assert.equal(r.status, 200);
		assert.equal(await r.text(), 'accents');

		let rr = await fetch(base + '/Docs/big.bin', { headers: { Range: 'bytes=10-19' } });
		assert.equal(rr.status, 206);
		assert.equal(rr.headers.get('content-range'), 'bytes 10-19/' + (3 * 1024 * 1024 + 7));
		assert.equal(await rr.text(), 'AAAAAAAAAA');

		let big = await fetch(base + '/Docs/big.bin');
		assert.equal((await big.arrayBuffer()).byteLength, 3 * 1024 * 1024 + 7);

		let bad = await fetch(base + '/top.txt', { headers: { Range: 'bytes=50-' } });
		assert.equal(bad.status, 416);
	});

	test('HEAD returns the size without a body', async () => {
		let r = await fetch(base + '/top.txt', { method: 'HEAD' });
		assert.equal(r.headers.get('content-length'), '3');
	});

	test('is read-only and rejects bad paths', async () => {
		assert.equal((await fetch(base + '/top.txt', { method: 'PUT', body: 'x' })).status, 403);
		assert.equal((await fetch(base + '/top.txt', { method: 'DELETE' })).status, 403);
		assert.equal((await fetch(base + '/missing')).status, 404);
		assert.equal((await fetch(base + '/Docs/..%2F..%2Fsecret')).status, 400);
	});

	test('hands out locks so Windows can open files', async () => {
		let r = await fetch(base + '/top.txt', { method: 'LOCK', body: '<lockinfo/>' });
		assert.equal(r.status, 200);
		assert.match(r.headers.get('lock-token')!, /^<opaquelocktoken:/);
		assert.equal((await fetch(base + '/top.txt', { method: 'UNLOCK' })).status, 204);
	});

	test('folders open as a simple web page', async () => {
		let r = await fetch(base + '/Docs/');
		assert.match(r.headers.get('content-type')!, /text\/html/);
		assert.match(await r.text(), /Caf%C3%A9%20notes\.txt/);
	});
});
