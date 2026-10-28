import { TreeFS, TreeNode } from '../fs/tree';
import { FormatError } from '../errors';
import { FileEntry, FileType } from './file_entry';
import { BoxType } from './box';
import MacVolume from './volume';


interface MacNodeData {
	file: FileEntry;
}

// Handle type of boxes that hold file data
const BLOB_HANDLE_TYPE = 4;

/**
 * Files and folders of one Mac backup point.
 *
 * NOTE: Untested against real files since the original samples are gone. Mirrors the logic of the old
 * (author-tested) FUSE mount.
 */
export class MacFS extends TreeFS<MacNodeData> {

	constructor(private _volume: MacVolume, files: FileEntry[], creationTime: Date) {
		super(false, creationTime);

		// The listing is a pre-order list where folders give their number of descendants.
		// The first entry is the hidden "root:" folder; its contents are the top level.
		let start = 0;
		let end = files.length;
		if(files.length > 0 && files[0].type === FileType.Directory && files[0].name === 'root:') {
			start = 1;
			end = 1 + files[0].numEntries;
		}

		this.addRange(files, start, end, this.root);
	}

	private addRange(files: FileEntry[], start: number, end: number, parent: TreeNode<MacNodeData>) {
		end = Math.min(end, files.length);

		let i = start;
		while(i < end) {
			const f = files[i];
			const isDir = f.type === FileType.Directory;

			let node = this.addChild(parent, {
				name: f.name,
				type: isDir ? 'directory' : 'file',
				size: isDir ? 0 : f.size,
				mtime: f.mtime,
				atime: f.atime
			}, isDir ? undefined : { file: f });

			if(isDir) {
				this.addRange(files, i + 1, i + 1 + f.numEntries, node);
				i += 1 + f.numEntries;
			}
			else {
				i++;
			}
		}
	}

	protected async readFile(node: TreeNode<MacNodeData>, offset: number, length: number): Promise<Buffer> {
		let file = node.data!.file;
		let end = offset + length;
		let out = Buffer.alloc(length);

		// Each data box covers the next 'size' bytes of the file
		let blockStart = 0;
		for(let h of file.handles) {
			if(h.type !== BLOB_HANDLE_TYPE) {
				continue;
			}

			let blockEnd = blockStart + h.size;
			let thisStart = blockStart;
			blockStart = blockEnd;

			if(blockEnd <= offset) {
				continue;
			}

			if(thisStart >= end) {
				break;
			}

			let box = await this._volume.readBoxHandle(h);
			if(box.type !== BoxType.Blob) {
				throw new FormatError('Expected a data box for ' + node.entry.path);
			}

			let from = Math.max(offset, thisStart);
			let to = Math.min(end, blockEnd);
			if(box.data.length < to - thisStart) {
				throw new FormatError('Data box of ' + node.entry.path + ' is shorter than expected');
			}

			box.data.copy(out, from - offset, from - thisStart, to - thisStart);
		}

		return out;
	}
}
