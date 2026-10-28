To-do list
==========

Tracks the work on the `modernize-and-fixes` branch. Each item comes from the October 2026 code review
(see `WORKLOG.md` for what was done and why). Tick items as they land and keep this file in each commit
that changes it.

Legend: `[x]` done, `[ ]` to do, `[~]` partly done / blocked (reason given)


Next steps (in priority order)
------------------------------
1. **Merge**: open a pull request from `modernize-and-fixes` into `master` and review it.
2. **Windows drive without the 50 MB limit**: install WinFsp + rclone and test
   `rclone mount :webdav: Z: --webdav-url http://127.0.0.1:8642/ --read-only` against `tib mount`;
   document exact steps (needs an administrator for the WinFsp driver).
3. **More real samples**: an incremental chain, a backup split into several files, an encrypted one and a
   sector-by-sector one (True Image for Windows), plus any Mac backup. Run `TIB_SAMPLE=<file> npm test`
   and `tib verify` on each, then fix what breaks and record findings in the format notes.
4. **Native FUSE**: test `tib mount --fuse` on Linux and macOS with `@cocalc/fuse-native`.
5. **Windows attributes in mounts**: show hidden/system flags and creation times (needs a per-entry
   metadata read, so cache it).
6. **Synthetic Mac fixture** following `Format-Mac.md`, so the Mac parser has end-to-end tests.
7. **Sector-by-sector support** once a sample exists (expose the disk image as one file, readable by
   standard tools).


1. Bugs found in review
-----------------------
- [x] `Archive.Open` closed the volume the archive still uses (broke Mac file reads)
- [x] FUSE read checked `pos < pos + size` instead of `position < pos + size`
- [x] Windows slices split over several volumes failed with "Gap in slice numbering"
- [x] Sector-by-sector trailer read the 2nd offset with the wrong length; now fails with a clear error
- [x] `readFooter` closed the volume's reader instead of its own slice
- [x] `search()` returned an out-of-range index
- [x] `AssertKeys` ignored `allOptional` for trailing keys; unknown XML keys now warn instead of failing
- [x] 64-bit values silently truncated to 48 bits
- [x] Windows listing strings kept a trailing NUL and the "short name" included extra bytes
- [x] Windows listing couldn't tell folders from empty files (uses the `kind` field now)


2. Toolchain and packaging
--------------------------
- [x] npm instead of yarn; remove `yarn-error.log`
- [x] TypeScript 7, `strict`, Node 22+ (`engines`)
- [x] Drop `fs-extra`, `tslib`; upgrade `xml2js` to 0.6.2 (CVE-2023-0842)
- [x] Remove abandoned `fuse-bindings`
- [x] `.gitattributes` so line endings stay LF on every OS
- [x] `src/index.ts` public entry point that registers both formats
- [x] `tib` command-line tool (`info`, `ls`, `cat`, `extract`, `verify`, `mount`)
- [x] GitHub Actions CI on Linux, macOS and Windows (Node 22 and 24)


3. Safety and robustness
------------------------
- [x] Bounds checks on every reader; reads bigger than 256 MB refused
- [x] Decompressed size limit (256 MB per stream)
- [x] File handles opened read-only and reference counted; double close is harmless
- [x] Close every reader/volume on error paths (`WindowsArchive.OpenImpl`, `MacArchive.OpenImpl`, `readBoxHandle`, `readAll`)
- [x] `Archive.close()` also closes slice readers
- [x] Config XML problems become warnings, not fatal errors
- [x] Replace remaining `console.warn` calls with `log.warn`
- [x] Encrypted Windows backups fail with a clear `NotSupportedError`
- [x] Extraction sanitizes names (no `..`, no characters invalid on the target OS) and never writes outside the destination
- [x] Replace `assert` calls in the parsers with `FormatError`s


4. Windows format
-----------------
- [x] Read file contents (blob records via the per-file record index); every block checked against its MD5
- [x] Folder detection, real names, modified times from the listing
- [~] Attributes and creation time: available through `WindowsFS.entryMeta()`, not yet shown by mounts
- [x] Slice id and creation time (from the config record)
- [~] Sector-by-sector disk backups: clear "not supported" error only (no sample to reverse-engineer)
- [~] Backups split across several `.tib` files: loop fixed, untested (no sample)
- [~] Incremental chains: code path exists, untested (no sample)


5. Mac format
-------------
- [x] Pick which backup point (slice) to view (`archive.getSlice(n)`); default is the latest
- [~] Owners/permissions/xattrs from `StatUser`/`Attributes` boxes: documented, not applied (no sample)
- [~] Real-file testing impossible: sample bucket `gs://acronis-tib` now returns 403


6. Mounting
-----------
- [x] Shared read-only file-system view over a slice (both formats): `slice.openFileSystem()`
- [x] WebDAV server mount: works on Windows (map network drive), macOS and Linux with no native code
- [~] Windows' WebDAV client limits files to 50 MB by default: documented fixes (registry, or WinFsp + rclone); needs admin, so not applied
- [ ] Try the WinFsp + rclone route and document exact steps
- [~] Optional native FUSE mount on Linux/macOS via `@cocalc/fuse-native` (loaded only if installed); untested, no Linux/macOS machine here
- [x] Unmount cleanly on Ctrl+C; no per-read logging; configurable mount point and port


7. Performance
-------------
- [x] No more quadratic buffer concatenation or 4 KB flush loop
- [x] Cache recently decompressed blocks (64 MB LRU per slice/volume), shared between concurrent reads


8. Tests
--------
- [x] Unit tests: readers, search, AssertKeys, compression, 64-bit reads, cache, paths, ranges
- [x] Synthetic Windows backups (single, split, corrupted, encrypted, sector-by-sector) built by `test/helpers/windows-fixture.ts`; Mac tree/read logic tested with a stub volume
- [ ] Synthetic Mac `.tib`/`.tib.metadata` builder (needs the Mac layout written up first)
- [x] Integration test against a real backup when `TIB_SAMPLE` points at one (skipped otherwise)
- [x] CLI tested end to end (exit codes, extract, verify on a corrupted backup)
- [x] WebDAV server tested over HTTP; extraction tested with tricky names


9. Documentation
----------------
- [x] Work log and this to-do list
- [x] README: status, install, CLI, mounting on each OS, library usage
- [x] Windows format notes (`Format-Windows.md`)
- [x] Mac format notes (`Format-Mac.md`, from the code; unverified)
- [x] Fix `/opt/archive` vs `/opt/acronis` mismatch in `samples/README.md`
- [x] `samples/extract_data.bat`: copies the finished backups like the Mac script does (untested: needs True Image)
