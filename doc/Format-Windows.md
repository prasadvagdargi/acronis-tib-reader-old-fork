Windows .tib format notes (True Image 2015 and later)
=====================================================

Reverse-engineered findings. Offsets are byte offsets; all integers are little-endian.
"Verified" means checked against a real True Image 25.4 file-level backup (October 2026).


Volume file layout
------------------
```
[32-byte header] [slice data ...] [zero padding] [48-byte footer]
```
- Header: magic `CE 24 B9 A2`, header length `0x20`, version `0` (Windows), 12 bytes of random
  archive/slice/volume keys, sequence number (starts at 1), Adler-32 of the header, block size `32`. Verified.
- Footer: last 32 bytes are the header byte-reversed. 8 bytes before that is the slice size (bytes of
  slice data counted from after the header, summed over every volume of the slice). Verified.
- The file length is a multiple of the block size (32). Verified.


Slice trailer
-------------
The last 4 bytes of the slice data identify its kind:
- `2C 8A E1 94`: file-level backup. The 8 bytes before them are the offset of the metadata
  (config records, then the listing). Verified.
- `2B 8A E1 94`: sector-by-sector disk backup. Not supported yet (no sample).


Records
-------
Slice data is a sequence of records. Each starts with a 1-byte type followed by a compressed stream.

| Type | Name | Compression | Notes |
|------|------|-------------|-------|
| 109 | Blob | zlib | File data, up to 256 KiB (262,144 bytes) decompressed. Trailing zeros of a file are not stored. Verified |
| 110 | BlobSuffix | zlib | Empty; follows the last blob of each file. Verified |
| 102 | FileMetaStart | raw deflate + 4 bytes | 5 zero bytes; first record of every entry's metadata. Verified |
| 1 | Attributes | raw deflate + 4 bytes | uint32 Windows file attributes (`0x10` folder, `0x20` archive, `0x02` hidden, `0x04` system, `0x01` read-only). Verified |
| 2 | Security | raw deflate + 4 bytes | Windows security descriptor (self-relative). Folders only, it seems |
| 108 | RecordIndex | zlib | Where a file's blocks are; see below. Files only. Verified |
| 5 | Times | raw deflate + 4 bytes | Two uint64 timestamps in ms since 1970; the second is the modified time shown in the listing. Verified |
| 101 | Config | raw deflate + 4 bytes | Key/value XML (product info, task id, computer id, compression, encryption). Verified |
| 103 | Listing | raw deflate + 4 bytes | Every file and folder in the slice. Verified |
| 104 | EndTrailer | none | Marks the end of the metadata |

The 4 bytes after raw deflate streams look like a checksum (not Adler-32 of the data; still unknown).

The metadata of an entry is: `102`, `1`, then `2` (folders) or `108` (files), then `5`.
File data blobs are written before the metadata that points at them.


RecordIndex (type 108)
----------------------
```
0   8   magic 01 02 00 10 01 00 00 00
8   8   total file size
16  4   number of handles N
20  32*N handles:
        8  offset of this block inside the file
        8  offset of the Blob record, from the start of the archive (after the header)
        16 MD5 hash (of the decompressed block; to be confirmed)
...     a security descriptor follows (same layout as record type 2)
```


Listing (type 103)
------------------
```
uint32  number of entries
entries:
  uint32  path length in UTF-16 units, including the trailing NUL
  utf16   full path, e.g. "G:/Android/data", NUL-terminated
  uint32  size of the rest of this entry in 2-byte units
  uint32  name length (no NUL)
  utf16   name
  uint32  length of the "names" block in UTF-16 units
  utf16   name again with NUL, then 0x0002 and zero padding (purpose unknown)
  uint64  modified time, ms since 1970 (0 for the drive root)
  uint32  unknown (looks like a hash)
  uint64  size in bytes
  uint64  size again (difference unknown)
  uint64  offset of the entry's FileMetaStart record (from the start of the archive)
  uint32  kind: 0x83 drive root, 0x80 folder (to be confirmed), 0 file
  uint64  offset of the FileMetaStart record again
  uint32  1
  uint32  unknown, same for every entry (volume id?)
  18      zero bytes
```
