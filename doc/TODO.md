To-do list
==========

Tracks the work on the `modernize-and-fixes` branch. Each item comes from the October 2026 code review
(see `WORKLOG.md` for what was done and why). Tick items as they land and keep this file in each commit
that changes it.

Legend: `[x]` done, `[ ]` to do, `[~]` partly done / blocked (reason given)


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
- [ ] `tib` command-line tool (`info`, `ls`, `cat`, `extract`, `verify`, `mount`)
- [ ] GitHub Actions CI on Linux, macOS and Windows (Node 22 and 24)


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
- [ ] Extraction must sanitize names (no `..`, no characters invalid on the target OS)
- [ ] Replace `assert` calls in the Mac parser with `FormatError`s


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
- [ ] WebDAV server mount: works on Windows (map network drive), macOS and Linux with no native code
- [ ] Optional native FUSE mount on Linux/macOS via `@cocalc/fuse-native` (loaded only if installed)
- [ ] Unmount cleanly on Ctrl+C; no per-read logging; configurable mount point and port


7. Performance
-------------
- [x] No more quadratic buffer concatenation or 4 KB flush loop
- [x] Cache recently decompressed blocks (64 MB LRU per slice/volume), shared between concurrent reads


8. Tests
--------
- [ ] Unit tests: readers, search, AssertKeys, compression, 64-bit reads, cache, tree
- [ ] Synthetic Windows archive fixture (incl. multi-volume) and Mac fixture
- [ ] Integration tests against a real backup when `TIB_SAMPLE` points at one (skipped otherwise)


9. Documentation
----------------
- [x] Work log and this to-do list
- [~] README: status, install, library usage done; CLI and mounting sections to come
- [x] Windows format notes (`Format-Windows.md`)
- [ ] Mac format notes (offsets out of code comments)
- [ ] Fix `/opt/archive` vs `/opt/acronis` mismatch in `samples/README.md`
- [ ] `samples/extract_data.bat`: copy the finished backups like the Mac script does
