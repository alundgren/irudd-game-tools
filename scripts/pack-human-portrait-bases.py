"""Combine the facial modifiers of CC0-authored MakeHuman characters on the workshop cage.

python scripts/pack-human-portrait-bases.py SOURCE_DIRECTORY MPFB_TARGETS character-view/human-portrait-bases.json
Use the .mhm file and checksum listed for each node in the packed credits. Keep source downloads local.
"""
import base64
import gzip
import hashlib
import json
import sys
import zlib
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree

STUDIES = {
    "portraitSiyanda": 519, "portraitHideko": 866, "portraitTom": 1758,
    "portraitCorine": 1759, "portraitEveryman": 1760,
    "portraitDivorcee": 1996, "portraitViking": 2622,
}
FACIAL_GROUPS = {"head", "eyebrows", "eyes", "mouth", "cheek", "chin", "nose", "forehead", "ears"}


def facial_targets(recipe, targets):
    for line in recipe.splitlines():
        words = line.split()
        if len(words) != 3 or words[0] != "modifier":
            continue
        name = words[1]
        if name.split("/")[0] not in FACIAL_GROUPS or name.startswith(
            ("head/head-trans-", "head/head-angle-", "head/head-age-", "head/head-fat-")
        ):
            continue
        value = float(words[2])
        if not value:
            continue
        if "|" in name:
            low, high = name.split("|")
            name = low if value < 0 else low.rsplit("-", 1)[0] + "-" + high
            value = abs(value)
        path = targets / (name + ".target.gz")
        if path.exists():
            yield path, value


def pack(source, targets, out):
    human = json.loads((out.parent / "human-data.json").read_bytes())
    sources = json.loads((source / "sources.json").read_bytes())
    ids = np.frombuffer(zlib.decompress(base64.b64decode(human["packet"]["ids"])), "<u2")
    base = np.frombuffer(zlib.decompress(base64.b64decode(human["packet"]["base"])), "<f4").reshape(-1, 3)
    skin = base[:human["meta"]["bodyVertices"]]
    head = np.flatnonzero(skin[:, 1] > .55)
    pitch = .012
    origin = np.array([-.120, .528, -.072])
    shape = (21, 31, 24)
    grid = np.moveaxis(np.indices(shape), 0, -1).reshape(-1, 3) * pitch + origin
    dist, near = cKDTree(skin[head]).query(grid, k=48)
    weights = np.exp(-(dist**2 - dist[:, :1]**2) / (2 * .009**2))
    weights /= weights.sum(axis=1, keepdims=True)
    attenuation = np.clip(1 - (dist[:, 0] - .015) / .030, 0, 1)
    # Ease to a zero boundary so offsets are continuous beyond the sampled volume.
    edge = np.indices(shape)
    edge = np.minimum(edge, np.array(shape)[:, None, None, None] - 1 - edge).min(axis=0)
    attenuation *= np.clip(edge.ravel()/2, 0, 1)
    anchor = base[len(ids) + human["meta"]["names"].index("head")]
    layout = dict(origin=origin.tolist(), shape=shape, pitch=pitch, anchor=anchor.tolist())
    packet, credits = {}, {}
    for key, node in STUDIES.items():
        credit = sources[str(node)]
        raw = (source / f"{node}.mhm").read_bytes()
        if credit["license"] != "CC0" or hashlib.sha256(raw).hexdigest() != credit["sha256"]:
            raise ValueError(f"Source mismatch for {node}")
        full = np.zeros((65536, 3))
        mods = list(facial_targets(raw.decode("utf-8-sig"), targets))
        if len(mods) < 8:
            raise ValueError(f"Insufficient facial modifiers on {node}")
        for path, gain in mods:
            with gzip.open(path, "rb") as data:
                changes = np.loadtxt(data, comments="#", ndmin=2)
            full[changes[:, 0].astype(int)] += changes[:, 1:] * gain
        # One continuous vector field for skin, lip rims, eyes and nearby helpers.
        # A point's motion depends on where it is on the edited head.
        samples = full[ids[head[near]]] * .1
        field = np.einsum("ij,ijk->ik", weights, samples).reshape((*shape, 3))
        field = gaussian_filter(field, (.75, .75, .75, 0)) * attenuation.reshape((*shape, 1))
        delta = np.rint(field / .000002).astype("<i2")
        packet["m:" + key] = base64.b64encode(zlib.compress(delta.tobytes(), 9)).decode()
        credits[key] = {**credit, "modifiers": len(mods)}
        print(key, len(mods), "modifiers,", round(np.linalg.norm(full[ids],axis=1).max()*100,1), "mm peak")
    out.write_text(json.dumps({"credits": credits, "layout": layout, "packet": packet}, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    pack(*map(Path, sys.argv[1:]))
