import { SnapshotFS, FsEntry } from '../fs/types';
import { NotSupportedError } from '../errors';
import { warn } from '../log';


// The parts of @cocalc/fuse-native (same API as fuse-native) used here
type Callback = (code: number, ...rest: any[]) => void;

interface FuseInstance {
	mount(cb: (err: Error | null) => void): void;
	unmount(cb: (err: Error | null) => void): void;
}

interface FuseModule {
	new(mountPoint: string, ops: { [op: string]: (...args: any[]) => void }, opts?: { [key: string]: any }): FuseInstance;
	ENOENT: number;
	ENOTDIR: number;
	EISDIR: number;
	EIO: number;
	EROFS: number;
	EBADF: number;
}

export const FUSE_PACKAGE = '@cocalc/fuse-native';

/**
 * Loads the optional native FUSE module. Throws a NotSupportedError explaining how to get it.
 */
function loadFuse(): FuseModule {
	if(process.platform === 'win32') {
		throw new NotSupportedError('Native FUSE mounting is not available on Windows. Use the default WebDAV mount instead.');
	}

	try {
		return require(FUSE_PACKAGE) as FuseModule;
	}
	catch(e: any) {
		throw new NotSupportedError(
			'Native FUSE mounting needs the optional "' + FUSE_PACKAGE + '" package (and libfuse on Linux or macFUSE on macOS). ' +
			'Install it with: npm install ' + FUSE_PACKAGE + '  (' + e.message + ')'
		);
	}
}


const WRITE_OPS = [
	'truncate', 'ftruncate', 'chown', 'chmod', 'mknod', 'setxattr', 'removexattr', 'write', 'create',
	'utimens', 'unlink', 'rename', 'link', 'symlink', 'mkdir', 'rmdir'
];

/**
 * Mounts a backup point as a read-only folder using native FUSE (Linux and macOS)
 */
export class FuseMount {

	private _fuse: FuseInstance | null = null;
	private _open = new Map<number, string>();
	private _lastFd = 0;

	constructor(private _fs: SnapshotFS, private _mountPoint: string) {}

	async mount(): Promise<void> {
		let Fuse = loadFuse();

		let uid = process.getuid ? process.getuid() : 0;
		let gid = process.getgid ? process.getgid() : 0;

		let toStat = (e: FsEntry) => ({
			mtime: e.mtime,
			atime: e.atime || e.mtime,
			ctime: e.mtime,
			size: e.size,
			nlink: e.type === 'directory' ? 2 : 1,
			// Read-only: r-x for folders, r-- for files
			mode: e.type === 'directory' ? 0o40555 : 0o100444,
			uid,
			gid
		});

		// Wraps an async handler so failures turn into EIO instead of crashing the mount
		let wrap = (fn: (...args: any[]) => Promise<void>) => (...args: any[]) => {
			let cb: Callback = args[args.length - 1];
			fn(...args).catch((err) => {
				warn('FUSE operation failed: ' + (err && err.message));
				cb(Fuse.EIO);
			});
		};

		let ops: { [op: string]: (...args: any[]) => void } = {
			getattr: wrap(async (path: string, cb: Callback) => {
				let e = await this._fs.stat(path);
				if(!e) {
					return cb(Fuse.ENOENT);
				}
				cb(0, toStat(e));
			}),

			readdir: wrap(async (path: string, cb: Callback) => {
				let kids = await this._fs.list(path);
				if(!kids) {
					return cb((await this._fs.stat(path)) ? Fuse.ENOTDIR : Fuse.ENOENT);
				}
				cb(0, kids.map((k) => k.name), kids.map(toStat));
			}),

			open: wrap(async (path: string, flags: number, cb: Callback) => {
				let e = await this._fs.stat(path);
				if(!e) {
					return cb(Fuse.ENOENT);
				}
				if(e.type === 'directory') {
					return cb(Fuse.EISDIR);
				}
				// O_WRONLY = 1, O_RDWR = 2
				if((flags & 3) !== 0) {
					return cb(Fuse.EROFS);
				}

				let fd = ++this._lastFd;
				this._open.set(fd, path);
				cb(0, fd);
			}),

			read: wrap(async (path: string, fd: number, buf: Buffer, len: number, pos: number, cb: Callback) => {
				let p = this._open.get(fd);
				if(p === undefined) {
					return cb(Fuse.EBADF);
				}

				let data = await this._fs.read(p, pos, len);
				data.copy(buf, 0, 0, data.length);
				cb(data.length);
			}),

			release: (path: string, fd: number, cb: Callback) => {
				this._open.delete(fd);
				cb(0);
			}
		};

		for(let op of WRITE_OPS) {
			ops[op] = (...args: any[]) => (args[args.length - 1] as Callback)(Fuse.EROFS);
		}

		let fuse = new Fuse(this._mountPoint, ops, { force: true, mkdir: true, displayFolder: 'Backup' });

		await new Promise<void>((resolve, reject) => {
			fuse.mount((err) => err ? reject(err) : resolve());
		});

		this._fuse = fuse;
	}

	async unmount(): Promise<void> {
		let fuse = this._fuse;
		if(!fuse) {
			return;
		}

		this._fuse = null;
		await new Promise<void>((resolve, reject) => {
			fuse.unmount((err) => err ? reject(err) : resolve());
		});
	}
}
