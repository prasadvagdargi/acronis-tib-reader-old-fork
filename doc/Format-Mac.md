Mac .tib format notes
=====================

What the parser in `src/mac/` assumes, collected from its code and comments. Written by the original
author against True Image 2019 for Mac samples, which are no longer available, so **none of this has
been re-checked against real files** since. All integers are little-endian.


Files
-----
- `NAME.tib`: data records (file contents and per-file metadata boxes).
- `NAME.tib.metadata`: the list of backup points (slices) and their file listings.

Both are append-only: an incremental backup appends to the same two files, so one `.tib` holds every slice.


Volume header (`NAME.tib`)
--------------------------
Same 32+ byte header as Windows (`src/volume.ts`), with header length `0x24`, version `1`, block size
`4096` and sequence `1`. Data records start at `3 * blockSize` (offset 12288); offsets stored in the
metadata are relative to that point.


Records (both files)
--------------------
```
4   header: 1 byte flags (0x98 or 0x68 in .tib; 0x88 compressed / 0x80 unknown in .metadata), uint24 size
... zlib stream, then zero padding
4   trailer: 0x78, uint24 size (must equal the header's size)
```
A record ends on a block boundary (4096 in `.tib`, 128 in `.metadata`).
The decompressed data is a *chunk*: a uint32 size followed by boxes.

In `.metadata`, each record is preceded by a 16-byte header starting `77 14`.


Boxes
-----
```
1   magic (0xB0 in .tib; differs in .metadata)
3   uint24 size of the rest of the box (0 = empty box)
2   uint16 type
... body
```

| Type | Name | Body |
|------|------|------|
| `0x01C0` | Container | 7 bytes |
| `0x04C0` | Blob | 3 unknown bytes, then file data |
| `0x05C0` | StatTime | 3 bytes, uint64 ctime, uint64 unknown (usually 0) |
| `0x06C0` | StatUser | 11 bytes, uint32 uid, uint32 gid |
| `0x07C0` | Attributes (xattrs) | 3 bytes, then repeated: uint16 key size, uint64 value size, key, value |
| `0x0040` | MetaData (one per slice, in `.metadata`) | see below |
| `0x0070` | MetaIndex (in `.metadata`) | not parsed |


MetaData box (one backup point)
-------------------------------
```
3    uint24 inner size
53   unknown
16   slice id
8    creation time (ms since 1970)
...  unknown; the parser searches for the UTF-16 XML start "FF FE 3C 00 3F 00 78 00 6D 00 6C 00"
2    uint16 XML size in bytes (just before the XML)
...  XML configuration (MachineId, IncludePath, ...)
...  a "vector" of 52 bytes (or 8 bytes if its first byte is 0)
...  file entries until 3 bytes before the end
```

File entries form a pre-order list: each folder gives the number of all entries below it, and the first
entry is the hidden root folder named `root:`.

```
4    uint32 prefix size, then that many bytes
4    uint32 size of the whole entry including children (used to skip it)
...  8 bytes, or (if the byte 5 bytes ahead is 0x40) 10 bytes + uint16 n + 6 bytes + n UTF-16 units + 4 bytes
2    uint16 bytes from here to the end of the file name
2    uint16 file name length (UTF-16 units)
2    unknown
1    type: 0 file, 128 folder, 131 root
3    unknown
8    size (files)
8    unknown
8    mtime (ms)
8    atime (ms)
4    usually FF FF FF FF
...  UTF-16 file name
...  folders: uint32 number of descendants at +45; skip 41 (root) or 85 (folder). Files: skip 35
4    uint32 size of the box handle list, then the handles (files only)
4    end-of-entry bytes (FF FF FF FF; sometimes missing)
```

Box handles (where a file's boxes live in `NAME.tib`):
```
repeated:
  4  uint32 box type (4 = Blob holding file data)
  4  uint32 length of the following handle list
  repeated: uint64 record_start, uint32 start (offset in the decompressed chunk), uint32 size, uint32 record_size
  4  usually 0
```
A file's data is the concatenation of its Blob boxes, each covering `size` bytes. The box is found at
`start - 5` inside the decompressed chunk, which suggests `start` is counted from a different point
than assumed.


Not known yet
-------------
- Whether a later slice's MetaData box lists every file or only the changed ones.
- How permissions (mode bits) are stored; uid/gid and xattrs are parsed but not used by the mounts.
- Encryption.
