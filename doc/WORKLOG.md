Work log
========

Step-by-step notes on the `modernize-and-fixes` branch, newest last. The open items live in `TODO.md`.


2026-10-27: review
------------------
- Read the whole code base (~2,700 lines of TypeScript, untouched since November 2018).
- Found 8 bugs, a missing entry point/CLI, no tests, an abandoned native FUSE dependency,
  Node 10-era tooling and unsafe handling of untrusted files. Full list is in `TODO.md`.


2026-10-27: decisions
---------------------
- **Test data.** The original sample bucket (`gs://acronis-tib/samples`) returns 403 for every file.
  The only real backup available is a 55 GB Windows file-level backup (True Image 25.4) on the
  maintainer's machine. It is opened **read-only** and never copied, moved or committed.
  Tests that need it run only when the `TIB_SAMPLE` environment variable points at it.
- **Mounting.** `fuse-bindings` is abandoned and needs native compilation. Windows mounting is a
  requirement, so the mount is rebuilt as:
  1. a built-in read-only WebDAV server (pure JavaScript; Windows maps it as a drive, macOS and Linux
     mount it natively), and
  2. an optional native FUSE mount on Linux/macOS through `@cocalc/fuse-native`, loaded only if the user
     installs it, because it has no OS restriction and would try (and fail) to compile on Windows.
- **Unknown format areas** (sector-by-sector, encryption, Mac owners/permissions) fail with clear
  `NotSupportedError`s and are documented rather than guessed.
- **Git.** Work happens on `modernize-and-fixes`, in small commits pushed to `origin` as they land.
  Commits use the GitHub noreply address because the account's email is private (GitHub rejected
  the first push with GH007).


2026-10-27: steps done
----------------------
1. Fixed the five worst bugs (commit "Fix five bugs found in review").
2. Installed Node 24.22.1 LTS (portable, user folder, checksum verified).
3. Rewrote the readers, decompression and search (commit "Rewrite low-level readers...").
   - zlib's one-shot API reports exactly how many compressed bytes it used, even with data after the
     stream, so stream ends are found without the old flush loop.
4. Moved to npm, TypeScript 7 strict, Node 22+ (commit "Move to npm, TypeScript 7...").
   The old FUSE code was removed in this step and comes back as the new mount.
5. Opened the real Windows backup with the parser: it opens in ~75 ms, reads the config and all
   9,212 listing entries. Reverse-engineered how file data is linked (see `Format-Windows.md`).
6. Windows file reading, shared file-system view, block cache, resource cleanup.
   Checked against the real backup (read-only):
   - 8,538 files and 675 folders; total size matches the listing exactly (56,672,748,844 bytes)
   - 4,211 blocks from 40 files spread across all sizes match their stored MD5s (~48 MB/s)
   - random-offset reads equal sequential reads; reads past the end are clamped
   - an extracted 25 MB zip passes its own CRC checks for all 66 entries; extracted JPEGs decode
   - backup time read from the config record (2024-06-22 00:30:07 UTC) matches the file's write time
   Extracted copies were written to a temporary folder and deleted afterwards.
7. `tib` CLI, safe extraction, WebDAV mount and optional FUSE mount. Checked on the real backup:
   - `info`, `ls -l`, `verify --quick` work; wrong usage exits 2, errors exit 1
   - extracting `/G/Movies` (546 files) gives exact sizes and modified times; a second run refuses to
     overwrite; `cat` output equals the extracted file
   - WebDAV: OPTIONS, PROPFIND, ranged GET, 416 for bad ranges, 403 for writes, 400 for `..` paths
   - **Windows drive**: `net use T: http://127.0.0.1:8642/` started the WebClient service and mapped
     the backup; Windows listed folders with correct dates and copied a file identical to `cat`
   - Windows' WebDAV client refuses files over 50 MB by default (`FileSizeLimitInBytes` = 50000000 on
     this machine; a 108 MB copy failed). Documented the registry fix and the WinFsp + rclone route;
     both need admin rights so they weren't applied.
   - Files were first advertised as read-only; Windows kept that flag on copies, so they're now shown
     with the normal archive attribute (the server still refuses all writes).
   - Drive roots have no stored time; they now show the backup time instead of 1970.
8. Tests and CI (53 tests, built-in `node:test`, no extra dependencies):
   - `test/helpers/windows-fixture.ts` writes valid synthetic Windows backups from scratch (header
     checksum, blocks with MD5 index, metadata records, config, listing, trailer, footer, optional
     split into volumes). Covers the multi-volume bug, missing volumes, corrupted blocks, encrypted and
     sector-by-sector refusals, and non-backup files.
   - Every test that opens files deletes its temp folder afterwards; on Windows that fails if a file
     handle leaked, so the suite doubles as a leak check.
   - Mac logic is tested with a stub volume (tree building; reads at every offset across blocks,
     the case the old FUSE bug broke).
   - CLI tested by running it (exit codes, extract/overwrite, verify catching a corrupted block).
   - `TIB_SAMPLE=<file>` runs an extra test against a real backup; passes on the 55 GB sample.
   - GitHub Actions: Linux, macOS, Windows x Node 22, 24.
