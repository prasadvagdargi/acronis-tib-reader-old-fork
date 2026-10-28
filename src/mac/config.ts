import { SliceConfig } from '../slice';
import { ParseXML, AssertKeys, AssertValidUUID } from '../utils';
import { FormatError, check } from '../errors';


export async function ParseConfigXML(str: string): Promise<SliceConfig> {

	let obj = await ParseXML(str);

	AssertKeys(obj, ['MetaInfo']);
	obj = obj['MetaInfo'];

	// TODO: Some other parameters are optional?
	AssertKeys(obj, ['IncludePath', 'MachineId'], true);

	if(!obj['MachineId']) {
		throw new FormatError('Missing machine id');
	}

	let incs: string[]|undefined;
	
	if(obj['IncludePath']) {
		check(obj['IncludePath'] instanceof Array, 'IncludePath must be a list');
		for(var p of obj['IncludePath']) {
			check(typeof(p) === 'string', 'IncludePath entries must be text');
		}

		incs = obj['IncludePath'];
	}


	check(obj['MachineId'] instanceof Array && obj['MachineId'].length === 1, 'Expected one MachineId');
	let machineId = obj['MachineId'][0];
	check(typeof(machineId) === 'string' && machineId[0] === '"' && machineId[machineId.length - 1] === '"', 'MachineId must be quoted');
	machineId = machineId.slice(1, machineId.length - 1);
	AssertValidUUID(machineId);

	return {
		machine_id: machineId,
		includePaths: incs
	};
}