export type EntryType = 'file' | 'directory';

/**
 * A file or folder inside one backup point (slice)
 */
export interface FsEntry {
	name: string;
	path: string; /**< Absolute path with '/' separators; the root is '/' */
	type: EntryType;
	size: number; /**< Bytes for files, 0 for folders */
	mtime: Date; /**< Last modified */
	atime?: Date; /**< Last accessed, when the format stores it */
}

/**
 * Read-only view of the files in one backup point. Used by the CLI, extraction and the mounts.
 */
export interface SnapshotFS {
	/** Information about one path, or undefined if it doesn't exist */
	stat(path: string): Promise<FsEntry | undefined>;

	/** Children of a folder, or undefined if the path isn't a folder */
	list(path: string): Promise<FsEntry[] | undefined>;

	/**
	 * Reads up to 'length' bytes of a file starting at 'offset'.
	 * Returns fewer bytes only at the end of the file.
	 */
	read(path: string, offset: number, length: number): Promise<Buffer>;

	/** Every entry under 'path' (default: everything), parents before children */
	walk(path?: string): AsyncIterable<FsEntry>;
}
