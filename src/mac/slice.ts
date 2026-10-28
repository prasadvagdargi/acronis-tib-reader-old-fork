import Slice from '../slice';
import { MetaDataBox } from './box';
import MacVolume from './volume';
import { SliceConfig } from '../slice';
import { MacFS } from './fs';


export default class MacSlice extends Slice {

	// A reference to the box for this slice
	box: MetaDataBox;
	config: SliceConfig = {};

	public constructor(volumes: MacVolume[], parent: MacSlice|null, box: MetaDataBox) {
		super(volumes, parent);
		this.box = box;
	}

	public get creationTime() {
		return this.box.sliceCreationTime;
	}

	public get id() {
		return this.box.sliceId;
	}

	public async openFileSystem() {
		return new MacFS(this.volumes[0] as MacVolume, this.box.files, this.creationTime);
	}

	// The volume (closed by the archive) holds all of the open resources
	public async close() {
	}
}
