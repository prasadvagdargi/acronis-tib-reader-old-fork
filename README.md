Acronis TIB Backup Format Reader
================================

Read, verify, extract and mount Acronis True Image backup files (`.tib` and `.tib.metadata`)
without True Image. Backup files are only ever opened read-only.

The format is undocumented; everything here is reverse-engineered. See `doc/` for the format notes,
the work log and the to-do list.


Status
------

| Backup type | List files | Read / extract files | Verify | Tested on real files |
|---|---|---|---|---|
| Windows, file/folder backup (True Image 2015 and later) | Yes | Yes, with per-block MD5 checks | Yes | Yes: True Image 25.4 (2024), 55 GB |
| Windows, split over several `.tib` files | Should work | Should work | Should work | No sample yet |
| Windows, incremental chain | Should work | Should work | Should work | No sample yet |
| Mac (all versions) | Should work | Should work | Should work | No (original samples are gone) |
| Windows sector-by-sector (disk image) | No: clear "not supported" error | | | |
| Encrypted backups | No: clear "not supported" error | | | |
| Windows True Image 2014 and older | Unknown | | | |


Requirements
------------
- Node.js 22 or newer


Install and build
-----------------
```bash
npm install
```
```bash
npm run build
```
```bash
npm test
```


Library usage
-------------
```ts
import { openArchive } from 'acronis-tib';

const archive = await openArchive('D:/Backups/MyBackup_full_b1_s1_v1.tib');
try {
	const slice = archive.getSlice();          // latest backup point; getSlice(1) is the oldest
	console.log(slice.creationTime, slice.config);

	const fs = await slice.openFileSystem();
	console.log(await fs.list('/'));           // one folder per backed up drive, e.g. "G"
	const bytes = await fs.read('/G/notes.txt', 0, 1024);
}
finally {
	await archive.close();
}
```

`openArchive` accepts any file of a backup: for Windows, any `NAME_full_b1_s1_v1.tib`-style file
(the other files of the chain must be in the same folder); for Mac, `NAME.tib` or `NAME.tib.metadata`.

Problems that don't stop reading (unknown flags, odd headers) are reported as warnings on stderr.
Use `setWarningHandler()` to collect or silence them. Errors are thrown as `FormatError` (damaged or
unknown data) or `NotSupportedError` (valid but unsupported, e.g. encrypted backups).


Versions
--------

The objective is to support all versions of the file format. The Mac and Windows versions produce quite
different file formats (likely why True Image does not allow cross-OS archive viewing).

Judging by the backwards compatibility information at https://kb.acronis.com/tib, these variants exist
(numbers are True Image version years):
1. Windows `<= 2012`
2. Windows `>= 2013 and <= 2014`
3. Windows `>= 2015 to present` (supported; True Image 25.x confirmed)
4. Mac OS `all years`


Terminology
-----------

Following the True Image documentation (https://kb.acronis.com/content/1772):

1. `Archive`
	- A complete chain/group composed of all backup files over time for a single configuration
	- Composed of `Slice`s
2. `Slice`
	- A single point in time (one full or incremental backup run)
	- Composed of `Volume`s (usually just 1 unless the backup is split into smaller parts)
	- NOTE: In Mac backups, multiple slices may reference the same volume
3. `Volume`
	- A single `.tib` file


License
-------
MIT (see `LICENSE`). Originally written by Dennis Shtatnov.
