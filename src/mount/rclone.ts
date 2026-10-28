import fs from 'node:fs';
import path from 'node:path';
import { spawn, ChildProcess } from 'node:child_process';
import { NotSupportedError } from '../errors';


/**
 * Finds the rclone executable: $TIB_RCLONE, then PATH, then winget's link folder (Windows).
 */
export function findRclone(): string | null {
	let env = process.env.TIB_RCLONE;
	if(env && fs.existsSync(env)) {
		return env;
	}

	let exe = process.platform === 'win32' ? 'rclone.exe' : 'rclone';
	let dirs = (process.env.PATH || '').split(path.delimiter).filter((d) => d.length > 0);

	if(process.platform === 'win32' && process.env.LOCALAPPDATA) {
		// winget adds this to PATH, but already-open terminals don't see it yet
		dirs.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
	}

	for(let d of dirs) {
		let candidate = path.join(d, exe);
		if(fs.existsSync(candidate)) {
			return candidate;
		}
	}

	// winget may only add rclone's own folder to the user PATH, which running programs don't see
	if(process.platform === 'win32' && process.env.LOCALAPPDATA) {
		let found = findInWingetPackages(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages'));
		if(found) {
			return found;
		}
	}

	return null;
}

function findInWingetPackages(packagesDir: string): string | null {
	try {
		for(let pkg of fs.readdirSync(packagesDir)) {
			if(!pkg.startsWith('Rclone.Rclone_')) {
				continue;
			}

			// e.g. Rclone.Rclone_.../rclone-v1.75.1-windows-amd64/rclone.exe; newest version last
			let versions = fs.readdirSync(path.join(packagesDir, pkg)).filter((d) => d.startsWith('rclone-')).sort();
			for(let i = versions.length - 1; i >= 0; i--) {
				let candidate = path.join(packagesDir, pkg, versions[i], 'rclone.exe');
				if(fs.existsSync(candidate)) {
					return candidate;
				}
			}
		}
	}
	catch(e) {
		// No winget packages folder
	}

	return null;
}

/**
 * Accepts "R" or "R:" on Windows (returns "R:"); anything else is used as a folder path
 */
export function normalizeDriveTarget(target: string, platform: NodeJS.Platform = process.platform): string {
	if(platform === 'win32' && /^[A-Za-z]:?$/.test(target)) {
		return target[0].toUpperCase() + ':';
	}

	return target;
}


/**
 * Mounts a WebDAV URL (served by WebDavServer) as a real drive or folder using rclone:
 * WinFsp on Windows, FUSE on Linux/macOS. Unlike Windows' own WebDAV client it has no file size limit.
 */
export class RcloneMount {

	private _child: ChildProcess | null = null;
	private _onExit = () => { this._child?.kill(); };

	constructor(private _url: string, private _target: string, private _volumeName = 'Backup') {}

	get target() {
		return this._target;
	}

	async mount(timeoutMs = 30000): Promise<void> {
		let rclone = findRclone();
		if(!rclone) {
			throw new NotSupportedError(
				'Mounting as a drive needs rclone' + (process.platform === 'win32' ? ' and WinFsp' : ' and FUSE') + '. ' +
				(process.platform === 'win32' ? 'Install them with "winget install WinFsp.WinFsp" and "winget install Rclone.Rclone"' : 'See https://rclone.org/install/') +
				' (or set TIB_RCLONE to rclone\'s path). Without them, use the WebDAV address directly.'
			);
		}

		// NOTE: Only async file system calls are used on the target from here on. The drive is served
		// by this same process, so a synchronous call would block the server and hang forever.
		if(process.platform === 'win32' && await pathExists(rootOf(this._target))) {
			throw new Error('Drive ' + this._target + ' is already in use');
		}

		let args = [
			'mount', ':webdav:', this._target,
			'--webdav-url', this._url,
			'--read-only',
			// The backup never changes, so listings can be cached for as long as the mount lives
			'--dir-cache-time', '1000h',
			'--attr-timeout', '1h',
			'--volname', this._volumeName,
		];

		let child = spawn(rclone, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
		this._child = child;

		let stderr = '';
		child.stderr!.on('data', (d) => { stderr = (stderr + d.toString()).slice(-4000); });

		// Don't leave a mount behind if this process exits without unmounting
		process.on('exit', this._onExit);

		let exited = false;
		child.on('exit', () => { exited = true; });

		let started = Date.now();
		let ready = async () => process.platform === 'win32' ? pathExists(rootOf(this._target)) : isMountPoint(this._target);
		while(!(await ready())) {
			if(exited || child.exitCode !== null) {
				this.cleanup();
				throw new Error('rclone could not mount ' + this._target + ': ' + (stderr.trim() || 'exited with code ' + child.exitCode));
			}

			if(Date.now() - started > timeoutMs) {
				await this.unmount();
				throw new Error('Timed out waiting for rclone to mount ' + this._target + (stderr ? ': ' + stderr.trim() : ''));
			}

			await new Promise((r) => setTimeout(r, 250));
		}
	}

	async unmount(): Promise<void> {
		let child = this._child;
		if(!child) {
			return;
		}

		if(child.exitCode === null && child.signalCode === null) {
			await new Promise<void>((resolve) => {
				let timer = setTimeout(() => { child!.kill('SIGKILL'); resolve(); }, 10000);
				child!.once('exit', () => { clearTimeout(timer); resolve(); });
				// rclone unmounts cleanly on SIGTERM (Linux/macOS); on Windows the WinFsp drive goes away with the process
				child!.kill('SIGTERM');
			});
		}

		this.cleanup();
	}

	private cleanup() {
		this._child = null;
		process.off('exit', this._onExit);
	}
}

// "R:" alone means the current folder on drive R; "R:\" is its root
function rootOf(target: string) {
	return /^[A-Za-z]:$/.test(target) ? target + '\\' : target;
}

async function pathExists(p: string): Promise<boolean> {
	try {
		await fs.promises.access(p);
		return true;
	}
	catch(e) {
		return false;
	}
}

/**
 * On Linux/macOS a folder only becomes a mount point once rclone is ready (its device id changes)
 */
async function isMountPoint(dir: string): Promise<boolean> {
	try {
		let a = await fs.promises.stat(dir);
		let b = await fs.promises.stat(path.dirname(path.resolve(dir)));
		return a.dev !== b.dev;
	}
	catch(e) {
		return false;
	}
}
