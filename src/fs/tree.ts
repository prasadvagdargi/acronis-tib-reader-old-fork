import { FsEntry, SnapshotFS } from './types';
import { warn } from '../log';


export interface TreeNode<T> {
	entry: FsEntry;
	data?: T; /**< Format-specific information needed to read the file */
	children?: Map<string, TreeNode<T>>;
	childrenLower?: Map<string, TreeNode<T>>; /**< Case-insensitive lookups (Windows) */
}

/**
 * Splits a path into its parts, ignoring empty parts and accepting both '/' and '\'.
 * Throws on '.' or '..' parts so paths can't escape the root.
 */
export function splitPath(path: string): string[] {
	let parts = path.split(/[\\/]+/).filter((p) => p.length > 0);
	for(let p of parts) {
		if(p === '.' || p === '..') {
			throw new Error('Relative path parts are not allowed: ' + path);
		}
	}

	return parts;
}

export function joinPath(parent: string, name: string) {
	return parent === '/' ? '/' + name : parent + '/' + name;
}


/**
 * In-memory directory tree built from a backup's file listing. Subclasses only implement reading file data.
 */
export abstract class TreeFS<T> implements SnapshotFS {

	protected root: TreeNode<T>;

	constructor(protected caseInsensitive: boolean, rootTime: Date) {
		this.root = this.makeDir('', '/', rootTime);
	}

	private makeDir(name: string, path: string, mtime: Date): TreeNode<T> {
		let node: TreeNode<T> = {
			entry: { name, path, type: 'directory', size: 0, mtime },
			children: new Map()
		};

		if(this.caseInsensitive) {
			node.childrenLower = new Map();
		}

		return node;
	}

	/**
	 * Adds an entry under 'parent'. Missing folders aren't created here; use ensureDir.
	 */
	protected addChild(parent: TreeNode<T>, entry: Omit<FsEntry, 'path'>, data?: T): TreeNode<T> {
		if(!parent.children) {
			throw new Error('Cannot add a child to a file: ' + parent.entry.path);
		}

		let path = joinPath(parent.entry.path, entry.name);

		let node: TreeNode<T>;
		if(entry.type === 'directory') {
			node = this.makeDir(entry.name, path, entry.mtime);
			node.entry.atime = entry.atime;
		}
		else {
			node = { entry: { ...entry, path }, data };
		}

		let existing = parent.children.get(entry.name);
		if(existing) {
			// A folder listed after something created it implicitly: keep its children, update its info
			if(existing.children && node.children) {
				existing.entry.mtime = entry.mtime;
				existing.entry.atime = entry.atime;
				return existing;
			}

			warn('Duplicate entry in backup listing: ' + path);
		}

		parent.children.set(entry.name, node);
		if(parent.childrenLower) {
			parent.childrenLower.set(entry.name.toLowerCase(), node);
		}

		return node;
	}

	/**
	 * Finds or creates the folder at the given parts (used when an entry's parents aren't listed)
	 */
	protected ensureDir(parts: string[], mtime: Date): TreeNode<T> {
		let node = this.root;
		for(let p of parts) {
			let next = node.children!.get(p);
			if(!next) {
				next = this.addChild(node, { name: p, type: 'directory', size: 0, mtime });
			}
			else if(!next.children) {
				throw new Error('Path goes through a file: ' + next.entry.path);
			}

			node = next;
		}

		return node;
	}

	protected lookup(path: string): TreeNode<T> | undefined {
		let node: TreeNode<T> | undefined = this.root;
		for(let p of splitPath(path)) {
			if(!node.children) {
				return undefined;
			}

			let next: TreeNode<T> | undefined = node.children.get(p);
			if(!next && node.childrenLower) {
				next = node.childrenLower.get(p.toLowerCase());
			}

			if(!next) {
				return undefined;
			}

			node = next;
		}

		return node;
	}

	async stat(path: string) {
		let node = this.lookup(path);
		return node ? { ...node.entry } : undefined;
	}

	async list(path: string) {
		let node = this.lookup(path);
		if(!node || !node.children) {
			return undefined;
		}

		return Array.from(node.children.values()).map((c) => ({ ...c.entry }));
	}

	async read(path: string, offset: number, length: number): Promise<Buffer> {
		let node = this.lookup(path);
		if(!node) {
			throw new Error('No such file: ' + path);
		}

		if(node.children) {
			throw new Error('Is a folder: ' + path);
		}

		if(!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) {
			throw new RangeError('Invalid read range');
		}

		let end = Math.min(offset + length, node.entry.size);
		if(offset >= end) {
			return Buffer.alloc(0);
		}

		return this.readFile(node, offset, end - offset);
	}

	async *walk(path: string = '/'): AsyncIterable<FsEntry> {
		let start = this.lookup(path);
		if(!start) {
			throw new Error('No such file or folder: ' + path);
		}

		let stack: TreeNode<T>[] = [ start ];
		while(stack.length > 0) {
			let node = stack.pop()!;
			yield { ...node.entry };

			if(node.children) {
				// Reverse so children come out in their listed order
				let kids = Array.from(node.children.values());
				for(let i = kids.length - 1; i >= 0; i--) {
					stack.push(kids[i]);
				}
			}
		}
	}

	/**
	 * Reads [offset, offset + length) of a file. The range is already clamped to the file size.
	 */
	protected abstract readFile(node: TreeNode<T>, offset: number, length: number): Promise<Buffer>;
}
