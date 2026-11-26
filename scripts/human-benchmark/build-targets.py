"""Build the benchmark's adult target meshes from the official Momentum Human Rig.

From the repository root:
    python scripts/human-benchmark/build-targets.py CACHE [--select] [--out FOLDER]

CACHE holds assets.zip of MHR v1.0.1 (or the extracted mhr_model.pt). The
seeded draw, the selection rule and the pose solve below choose six identities.
Their coefficients, proportions and poses are then kept in target-identities.json
beside this script, a local file Git ignores, and later runs rebuild the same
bodies from it without selecting again. --select repeats the selection and
rewrites that file. Meshes and their manifest go to examples/human-targets/
(or FOLDER), which Git ignores too. Requires numpy, scipy and torch (CPU).
"""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import torch

from hb_mesh import write_glb
from hb_mhr import PROPORTIONS, REGIONS, RELEASE, RELEASE_SHA256, Rig

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "examples" / "human-targets"
IDENTITIES = Path(__file__).with_name("target-identities.json")
RECORDED = ("id", "group", "role", "candidate", "poolSize", "identity", "proportions", "pose", "poseCheck")
SEED = 20261123
CANDIDATES = 400
COPYRIGHT = ("Derived from the Momentum Human Rig (MHR) v1.0.1, Copyright (c) Meta Platforms, Inc. "
             "and affiliates. Licensed under the Apache License 2.0. Modified: one sampled identity, "
             "posed, converted to metres and exported without rig, blend shapes or textures.")
GROUPS = {"f": ("female-typical build", lambda c: c >= 1.0), "m": ("male-typical build", lambda c: c <= -0.4)}
ROLES = ["development", "held out", "held out"]


def draw():
    """The official demo's identity distribution, with proportions inside 60% of their limits."""
    g = torch.Generator().manual_seed(SEED)
    identity = 0.8 * torch.randn(CANDIDATES, 45, generator=g)
    limits = torch.tensor(list(PROPORTIONS.values()))
    proportions = (torch.rand(CANDIDATES, len(PROPORTIONS), generator=g) * 2 - 1) * 0.6 * limits
    return identity, proportions


def select(rig):
    identity, proportions = draw()
    keys = list(PROPORTIONS)
    stature = []
    for i in range(CANDIDATES):
        with torch.no_grad():
            v, _ = rig._run(identity[i:i + 1], rig.parameters(dict(zip(keys, proportions[i].tolist()))), False)
        stature.append(float(v[:, 1].max() - v[:, 1].min()))
    stature = np.array(stature)
    mass, build = identity[:, 0].numpy(), identity[:, 1].numpy()
    chosen = []
    for prefix, (label, test) in GROUPS.items():
        pool = np.flatnonzero(test(build))
        feature = np.column_stack([stature[pool], mass[pool]])
        feature = (feature - feature.mean(0)) / feature.std(0)
        picks = [int(np.argmin(np.linalg.norm(feature - np.median(feature, 0), axis=1)))]
        while len(picks) < 3:
            gap = np.linalg.norm(feature[:, None] - feature[picks][None], axis=2).min(1)
            picks.append(int(gap.argmax()))
        for order, pick in enumerate(picks):
            i = int(pool[pick])
            chosen.append({
                "id": f"mhr-{prefix}{order + 1}", "group": label, "role": ROLES[order],
                "candidate": i, "poolSize": int(len(pool)),
                "identity": [round(float(x), 5) for x in identity[i]],
                "proportions": {str(k): round(float(x), 5) for k, x in zip(keys, proportions[i])},
            })
    return chosen


def build(rig, entries, out):
    out.mkdir(parents=True, exist_ok=True)
    (out / "mhr-regions.u8").write_bytes(rig.vertex_region.astype(np.uint8).tobytes())
    for entry in entries:
        if "pose" not in entry:
            pose, report = rig.solve_pose(entry["identity"], entry["proportions"])
            entry["pose"] = {str(k): v for k, v in pose.items()}
            entry["poseCheck"] = report
        vertices, _ = rig.evaluate(entry["identity"], entry["proportions"], entry["pose"])
        path = out / f"{entry['id']}.glb"
        write_glb(path, vertices, rig.faces, copyright_text=COPYRIGHT, name=entry["id"],
                  extras={"license": "Apache-2.0", "source": RELEASE, "group": entry["group"]})
        entry["file"] = path.name
        entry["sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        entry["stature"] = round(float(np.ptp(vertices[:, 1])), 4)
        print(entry["id"], entry["group"], entry["role"], f"{entry['stature']:.3f} m", entry["poseCheck"])
    return entries


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("cache", type=Path)
    parser.add_argument("--select", action="store_true")
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    rig = Rig(args.cache)
    manifest_path = args.out / "manifest.json"
    selected = args.select or not IDENTITIES.exists()
    if selected:
        entries = select(rig)
    else:
        entries = json.loads(IDENTITIES.read_text())["targets"]
    manifest = {
        "source": {
            "name": "Momentum Human Rig (MHR) v1.0.1, assets/mhr_model.pt",
            "url": RELEASE, "sha256": RELEASE_SHA256, "license": "Apache-2.0",
            "licenseText": "../../docs/licenses/mhr-apache-2.0.txt", "copyright": COPYRIGHT,
        },
        "selection": {
            "seed": SEED, "candidates": CANDIDATES, "torch": torch.__version__,
            "identity": "0.8 * standard normal for all 45 coefficients, as in the release's demo.py",
            "proportions": "uniform within 60% of the official limits of the eleven body proportion parameters",
            "groups": "identity coefficient 2 >= 1.0 is the female-typical pool, <= -0.4 the male-typical pool",
            "choice": "per pool: the candidate nearest the median stature and mass coefficient, then twice the "
                      "candidate farthest from those already chosen (both features standardised)",
        },
        "pose": "Limbs turned to the directions in scripts/human-benchmark/pose-convention.json; "
                "feet on the floor, pelvis joint over the origin, Y up, +Z front, metres.",
        "regions": {"file": "mhr-regions.u8", "names": REGIONS,
                    "note": "One byte per vertex: the body part with the largest total skin weight."},
        "targets": build(rig, entries, args.out),
    }
    manifest_path.write_bytes((json.dumps(manifest, indent=1) + "\n").encode())
    if selected and args.out.resolve() == OUT:
        IDENTITIES.write_bytes((json.dumps({
            "note": "Parameters of the six benchmark targets for assets/mhr_model.pt of MHR v1.0.1: the seeded "
                    "draw and selection of build-targets.py --select, and the pose that turns the limbs to "
                    "pose-convention.json. Numbers only; the meshes they produce stay local.",
            "selection": manifest["selection"],
            "targets": [{k: t[k] for k in RECORDED} for t in manifest["targets"]]}, indent=1) + "\n").encode())


if __name__ == "__main__":
    main()
