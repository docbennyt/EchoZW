import hashlib
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import zipfile

archive = Path(sys.argv[1])
expected = os.environ["ARTIFACT_DIGEST"].removeprefix("sha256:")
if len(expected) != 64 or hashlib.file_digest(archive.open("rb"), "sha256").hexdigest() != expected:
    raise RuntimeError("ARTIFACT_DIGEST_MISMATCH")
with zipfile.ZipFile(archive) as bundle:
    entries = bundle.infolist()
    if len(entries) > 10000 or sum(entry.file_size for entry in entries) > 100_000_000:
        raise RuntimeError("ARTIFACT_SIZE_INVALID")
    names = set()
    for entry in entries:
        path = PurePosixPath(entry.filename)
        if (
            path.is_absolute()
            or ".." in path.parts
            or "\\" in entry.orig_filename
            or entry.filename in names
            or stat.S_ISLNK(entry.external_attr >> 16)
            or not (entry.filename == "bundle/index.js" or entry.filename.startswith("dist/"))
        ):
            raise RuntimeError("ARTIFACT_PATH_INVALID")
        names.add(entry.filename)
    if "bundle/index.js" not in names or "dist/index.html" not in names:
        raise RuntimeError("ARTIFACT_CONTENT_MISSING")
    bundle.extractall("candidate")
