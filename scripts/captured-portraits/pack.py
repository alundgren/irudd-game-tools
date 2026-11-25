"""Combine the sparse cage solve and lid field with the corresponding skin and iris."""

from pathlib import Path
import base64, json, zlib
import numpy as np
from inputs import CACHE as src, FRAMES

mat, geom, rims, irises = [
    json.loads((src / f"captured-{k}.json").read_bytes())
    for k in ["family-data", "geometry", "lids", "irises"]
]


def unpack(blob, fmt):
    return np.frombuffer(zlib.decompress(base64.b64decode(blob)), fmt)


def pack(a):
    return base64.b64encode(zlib.compress(a.tobytes(), 9)).decode()


import sys

sys.path.insert(0, str(Path.cwd() / "scripts"))
import rocketbox_face_surface as native

out = {}
for id, entry in mat.items():
    axis = "scan" + id[3:]
    delta = np.zeros((65536, 3), "i4")
    for layer in [geom[axis], rims[axis]]:
        ix = unpack(layer["ids"], "<u2")
        delta[ix] += unpack(layer["shift"], "<i2").reshape(-1, 3)
    frame = FRAMES[entry["source"]]
    cage = native.evaluate(frame)
    body = native.meta["bodyVertices"]
    top = cage[:body, 1].max()
    crown = np.clip((top - 0.028 - cage[:body, 1]) / 0.025, 0, 1)
    delta[:body] = np.round(delta[:body] * (crown * crown * (3 - 2 * crown))[:, None])
    protected = np.ones(len(delta), bool)
    protected[:body] = False
    for group in native.meta["eyeGroups"]:
        protected[group] = False
    delta[protected] = 0
    ids = np.flatnonzero(delta.any(1))
    assert abs(delta).max() < 32767
    out[axis] = {
        **entry,
        "ids": pack(ids.astype("<u2")),
        "delta": pack(delta[ids].astype("<i2")),
        "iris": irises[id],
    }
Path(sys.argv[1]).write_text(json.dumps(out, separators=(",", ":")) + "\n")
