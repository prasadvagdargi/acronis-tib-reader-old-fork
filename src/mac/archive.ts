import fs from 'node:fs';
import path from 'node:path';
import Archive from '../archive';
import Volume, { VolumeVersion } from '../volume';
import MacVolume from './volume';
import { MacVolumeMetaFile, ParseMacVolumeMetaFile } from './meta';
import { FileReader } from '../reader';
import MacSlice from './slice';
import { BoxType } from './box';
import { ParseConfigXML } from './config';
import { FormatError } from '../errors';
import { warn } from '../log';


export class MacArchive extends Archive {

	static async OpenImpl(initialVolume: Volume) {
		if(!(initialVolume instanceof MacVolume)) {
			throw new Error('Called with wrong volume type');
		}

		// In this mode, we will have multiple slices represented by a single volume
		let metaFileName = initialVolume.fileName + '.metadata';

		if(!fs.existsSync(metaFileName)) {
			throw new FormatError('Missing metadata file: ' + metaFileName);
		}

		let reader = await FileReader.Create(metaFileName);
		let meta: MacVolumeMetaFile;
		try {
			meta = await ParseMacVolumeMetaFile(reader);
		}
		finally {
			await reader.close();
		}

		let name = path.basename(initialVolume.fileName, '.tib');

		let slices: MacSlice[] = [];

		for(let b of meta.boxes) {
			if(b.type === BoxType.MetaData) {
				let s = new MacSlice(
					[initialVolume],
					slices[slices.length - 1] || null,
					b
				);

				try {
					s.config = await ParseConfigXML(b.xml);
				}
				catch(e: any) {
					warn('Could not parse the configuration of backup point ' + (slices.length + 1) + ': ' + e.message);
				}

				slices.push(s);
			}
		}

		return new MacArchive(name, [initialVolume], slices, meta);
	}


	public metaFile: MacVolumeMetaFile;

	constructor(name: string, volumes: Volume[], slices: MacSlice[], meta: MacVolumeMetaFile) {
		super(name, slices, volumes);
		this.metaFile = meta;
	}

}

Archive.AddType(VolumeVersion.Mac, MacArchive.OpenImpl);
