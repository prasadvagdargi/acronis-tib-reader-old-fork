import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { openArchive, WindowsFS, FsEntry } from '../src/index';


// Checks against a real backup, which can't be part of the repository.
// Set TIB_SAMPLE to the path of any .tib file to run these. The file is only read.
const SAMPLE = process.env.TIB_SAMPLE;

describe('real backup (TIB_SAMPLE)', { skip: SAMPLE ? false : 'set TIB_SAMPLE to a .tib file to run' }, () => {

	test('opens, lists everything and reads a sample of files', async () => {
		let a = await openArchive(SAMPLE!);
		try {
			assert.ok(a.slices.length >= 1);

			for(let s of a.slices) {
				assert.ok(s.creationTime.getTime() > 0);

				let vfs = await s.openFileSystem();
				let files: FsEntry[] = [];
				for await (let e of vfs.walk()) {
					if(e.type === 'file') {
						files.push(e);
					}
				}

				assert.ok(files.length > 0);

				// Up to 20 files spread across all sizes (but at most ~200 MB in total)
				files.sort((x, y) => x.size - y.size);
				let budget = 200 * 1024 * 1024;
				for(let i = 0; i < 20 && files.length > 0; i++) {
					let e = files[Math.floor(i * (files.length - 1) / 19)];
					if(e.size > budget) {
						continue;
					}
					budget -= e.size;

					if(vfs instanceof WindowsFS) {
						await vfs.verifyFile(e.path);
					}

					// A range read equals the same bytes read as part of a bigger read
					if(e.size > 100) {
						let whole = await vfs.read(e.path, 0, Math.min(e.size, 1024 * 1024));
						let part = await vfs.read(e.path, 50, 40);
						assert.ok(part.equals(whole.subarray(50, 90)), 'range read of ' + e.path);
					}
				}
			}
		}
		finally {
			await a.close();
		}
	});
});
