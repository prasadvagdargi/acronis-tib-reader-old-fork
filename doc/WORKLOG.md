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
