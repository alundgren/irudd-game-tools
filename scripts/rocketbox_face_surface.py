"""Native adult head in the evaluator's unscaled coordinates, rebuilt from human-data.json."""

import base64, json, zlib
from pathlib import Path
import numpy as np

SRC = Path(__file__).resolve().parents[1] / "character-view"
human = json.loads((SRC / "human-data.json").read_bytes())
meta, packet = human["meta"], human["packet"]
_cache = {}


def unpack(key, dtype):
    if key not in _cache:
        _cache[key] = np.frombuffer(
            zlib.decompress(base64.b64decode(packet[key])), dtype
        )
    return _cache[key]


def evaluate(frame=0.0, age=0.0):
    """Cage vertices (skin, helpers, joints) before the stature scale. Families at equal shares."""
    v = unpack("base", "<f4").astype(np.float64).reshape(-1, 3).copy()
    for sex, s in (("female", (1 - frame) / 2), ("male", (1 + frame) / 2)):
        for stage, a in (("young", 1 - age), ("old", age)):
            if not s or not a:
                continue
            for fam in ("african", "asian", "caucasian"):
                v += unpack(f"m:{fam}-{sex}-{stage}", "<i2").reshape(-1, 3) * (
                    0.0001 * s * a / 3
                )
    soft, off, near = (
        unpack("softIds", "<u2"),
        unpack("softOffsets", "<u4"),
        unpack("softNeighbours", "<u2"),
    )
    w, mix = unpack("softWeights", "<f4"), unpack("softMix", "<f4")
    row = np.repeat(np.arange(len(soft)), np.diff(off))
    for _ in range(3):
        prev = v.copy()
        s = np.zeros((len(soft), 3))
        np.add.at(s, row, prev[near] * w[:, None])
        v[soft] += (s - prev[soft]) * mix[:, None] * 0.76
    for p in meta["patches"]:
        v[p["inner"]] = np.array(p["matrix"]) @ v[p["ring"]]
    return v


def smooth(v):
    off, refs, fac = (
        unpack("subOffsets", "<u4"),
        unpack("subRefs", "<u2"),
        unpack("subFactors", "<f4"),
    )
    out = np.zeros((len(off) - 1, 3))
    np.add.at(
        out, np.repeat(np.arange(len(off) - 1), np.diff(off)), v[refs] * fac[:, None]
    )
    return out


def smooth_topology():
    """Triangles of the smoothed skin and one UV pair per triangle corner (0..1, v up)."""
    idx = unpack("subIndices", "<u4").reshape(-1, 3)
    uv = unpack("subUV", "<u2").reshape(-1, 2) / 65535
    return idx, uv[unpack("subFaceUV", "<u4").reshape(-1, 3)]


RECT = (1494, 763, 2035, 1354)


def chart(uv):
    """Texture pair -> the upright 512 chart skin.py marks its landmarks in."""
    xx = uv[..., 0] * 2048 - RECT[0]
    yy = (1 - uv[..., 1]) * 2048 - RECT[1]
    return np.stack([(1 - yy / 591) * 512, xx / 541 * 512], -1)


head_joint = len(unpack("ids", "<u2")) + meta["names"].index("head")
