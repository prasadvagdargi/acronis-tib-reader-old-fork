import fs from 'node:fs';
import path from 'node:path';
import { FsEntry, SnapshotFS } from './types';
import { splitPath } from './tree';


const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Makes a name from a backup safe to use as a single file name on this OS.
 * Names from a backup are untrusted: they must not contain separators or be '.'/'..'.
 */
export function safeFileName(name: string, platform: NodeJS.Platform = process.platform): string {
	let out = name.replace(/[\u0000-\u001f/]/g, '_');

	if(platform === 'win32') {
		out = out.replace(/[<>:"\\|?*]/g, '_');

		// Windows drops trailing dots and spaces
		out = out.replace(/[. ]+$/, (m) => '_'.repeat(m.length));

		if(WINDOWS_RESERVED.test(out)) {
			out = '_' + out;
		}
	}

	if(out === '' || out === '.' || out === '..') {
		out = '_' + out;
	}

	return out;
}


export interface ExtractOptions {
	/** Replace files that already exist (default: fail instead) */
	overwrite?: boolean;
	/** Called before each file or folder is written */
	onEntry?: (entry: FsEntry, destPath: string) => void;
	/** Bytes read from the backup at a time (default 4 MiB) */
	chunkSize?: number;
}

export interface ExtractResult {
	files: number;
	directories: number;
	bytes: number;
}


/**
 * Copies a file or folder out of a backup.
 *
 * A folder's contents are written into 'destDir'; a single file is written as 'destDir/<name>'.
 * Modification times are restored. Nothing outside 'destDir' is ever written.
 */
export async function extract(snapshot: SnapshotFS, fromPath: string, destDir: string, opts: ExtractOptions = {}): Promise<ExtractResult> {
	let top = await snapshot.stat(fromPath);
	if(!top) {
		throw new Error('No such file or folder in the backup: ' + fromPath);
	}

	let chunkSize = opts.chunkSize || 4 * 1024 * 1024;
	let root = path.resolve(destDir);
	await fs.promises.mkdir(root, { recursive: true });

	let baseParts = splitPath(top.path);
	let result: ExtractResult = { files: 0, directories: 0, bytes: 0 };

	// Folder times are set last, since writing their contents changes them
	let dirTimes: Array<{ dest: string; entry: FsEntry }> = [];

	for await (let entry of snapshot.walk(fromPath)) {
		let rel: string[];
		if(top.type === 'file') {
			rel = [ entry.name ];
		}
		else {
			rel = splitPath(entry.path).slice(baseParts.length);
		}

		let dest = path.join(root, ...rel.map((p) => safeFileName(p)));

		// Defence in depth: never write outside the destination
		if(dest !== root && !dest.startsWith(root + path.sep)) {
			throw new Error('Refusing to write outside the destination: ' + dest);
		}

		if(opts.onEntry) {
			opts.onEntry(entry, dest);
		}

		if(entry.type === 'directory') {
			await fs.promises.mkdir(dest, { recursive: true });

			// The destination folder itself keeps its own times
			if(rel.length > 0) {
				dirTimes.push({ dest, entry });
				result.directories++;
			}
			continue;
		}

		let handle: fs.promises.FileHandle;
		try {
			handle = await fs.promises.open(dest, opts.overwrite ? 'w' : 'wx');
		}
		catch(e: any) {
			if(e.code === 'EEXIST') {
				throw new Error('File already exists (use overwrite to replace it): ' + dest);
			}
			throw e;
		}

		try {
			for(let off = 0; off < entry.size; off += chunkSize) {
				let buf = await snapshot.read(entry.path, off, Math.min(chunkSize, entry.size - off));
				await handle.write(buf, 0, buf.length);
				result.bytes += buf.length;
			}
		}
		finally {
			await handle.close();
		}

		await fs.promises.utimes(dest, entry.atime || entry.mtime, entry.mtime);
		result.files++;
	}

	for(let i = dirTimes.length - 1; i >= 0; i--) {
		let { dest, entry } = dirTimes[i];
		await fs.promises.utimes(dest, entry.atime || entry.mtime, entry.mtime);
	}

	return result;
}
