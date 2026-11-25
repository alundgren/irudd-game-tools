"""Pack local CC0 head sculpts expressed on MakeHuman's hm08 cage.

Usage: python scripts/pack-human-face-sculpt.py SOURCE_DIR character-view/human-face-sculpt-data.json
SOURCE_DIR contains sources.json (node, author, license, hash and URL) and NODE.target files.
The output contains movements in tenths of a millimetre, indexed only on skin.
"""
import base64
import hashlib
import json
import sys
import zlib
from pathlib import Path

import numpy as np
from scipy.sparse import coo_matrix

SCULPTS = {
    "lidDefinition": [(852, .72), (613, .26)],
    "earDefinition": [(1588, .64), (612, .24)],
    "alarCrease": [(1594, .94)],
    "orbitCreases": [(2246, .65), (2249, .54), (2251, .48)],
    "foreheadCreases": [(2252, .62), (2242, .72)],
    "mouthCreases": [(2255, .61), (2256, .59)],
}


def pack(sources, destination):
    src, dst = Path(sources), Path(destination)
    human = json.loads((dst.parent / "human-data.json").read_bytes())
    source_ids = np.frombuffer(zlib.decompress(base64.b64decode(human["packet"]["ids"])), dtype="<u2")
    ids = source_ids[:human["meta"]["bodyVertices"]]
    # Average nearby displacements on the native cage. Cartilage references
    # use different ear and lid proportions; the fine peaks otherwise turn
    # small triangles over at the helix and the inside of the upper lid.
    faces = np.frombuffer(zlib.decompress(base64.b64decode(human["packet"]["indices"])), dtype="<u2")[:3*human["meta"]["bodyTriangles"]].reshape(-1,3)
    pairs = np.sort(np.concatenate([faces[:,[0,1]],faces[:,[1,2]],faces[:,[2,0]]]),axis=1)
    i,j = np.unique(pairs,axis=0).T
    adjacency = coo_matrix((np.ones(2*len(i)),(np.r_[i,j],np.r_[j,i])),shape=(len(ids),len(ids))).tocsr()
    degree = np.maximum(1, np.asarray(adjacency.sum(axis=1)))
    library = json.loads((src / "sources.json").read_bytes())
    records = {}
    credits = {}
    for axis, parts in SCULPTS.items():
        total = np.zeros((65536, 3))
        for node, gain in parts:
            entry = library[str(node)]
            raw = (src / (str(node) + ".target")).read_bytes()
            if entry["license"] != "CC0" or hashlib.sha256(raw).hexdigest() != entry["sha256"]:
                raise ValueError("Check source " + str(node))
            credits[str(node)] = entry
            changes = np.loadtxt(raw.splitlines(), ndmin=2)
            # MakeHuman targets are in decimetres.
            total[changes[:, 0].astype(int)] += changes[:, 1:4] * gain * 1000
        delta = total[ids]
        if axis in {"earDefinition","lidDefinition"}:
            active = np.any(delta,axis=1)
            for _ in range(3):
                delta = .44*delta + .56*(adjacency @ delta)/degree
                delta[~active] = 0
            delta *= .33 if axis == "earDefinition" else .68
        if axis in {"mouthCreases","earDefinition"}:
            rest = np.frombuffer(zlib.decompress(base64.b64decode(human["packet"]["base"])),dtype="<f4").reshape(-1,3)[:len(ids)].copy()
            rest[:,0] = np.abs(rest[:,0])
        if axis == "earDefinition":
            # Shape the raised helix and outer bowl, leaving the folded
            # attachment to the skull seated on the wearer's own ear.
            centre = rest[5751]
            radius = np.linalg.norm((rest-centre)/[.011,.014,.011],axis=1)
            fade = np.clip((radius-.75)/.68,0,1)
            delta *= (fade*fade*(3-2*fade))[:,None]
        if axis == "mouthCreases":
            # The nasolabial and marionette folds frame each mouth corner.
            # End them before the delicate inner and outer lip rims meet.
            distance = np.linalg.norm(rest - rest[431],axis=1)
            fade = np.clip((distance - .008)/.009,0,1)
            delta *= (fade*fade*(3-2*fade))[:,None]
        delta = np.rint(delta).astype(int)
        active = np.flatnonzero(np.any(delta, axis=1))
        records[axis] = np.column_stack([active, delta[active]]).ravel().tolist()
    dst.write_text(json.dumps({"sources":credits, "controls":records}, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    pack(*sys.argv[1:])
