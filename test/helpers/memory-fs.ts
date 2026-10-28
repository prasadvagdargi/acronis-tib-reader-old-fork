import { TreeFS, TreeNode, splitPath } from '../../src/fs/tree';

export interface MemoryFile {
	path: string;
	data?: Buffer; /**< Omit for a folder */
	mtime?: Date;
}

/**
 * In-memory SnapshotFS for testing extraction and the mounts
 */
export class MemoryFS extends TreeFS<Buffer> {
	reads = 0;

	constructor(files: MemoryFile[]) {
		super(false, new Date('2020-01-01T00:00:00Z'));

		for(let f of files) {
			let parts = splitPath(f.path);
			let mtime = f.mtime || new Date('2020-01-01T00:00:00Z');
			let parent = this.ensureDir(parts.slice(0, -1), mtime);
			let isDir = f.data === undefined;

			this.addChild(parent, {
				name: parts[parts.length - 1],
				type: isDir ? 'directory' : 'file',
				size: isDir ? 0 : f.data!.length,
				mtime
			}, f.data);
		}
	}

	protected async readFile(node: TreeNode<Buffer>, offset: number, length: number) {
		this.reads++;
		return Buffer.from(node.data!.subarray(offset, offset + length));
	}
}
