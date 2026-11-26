"""Pack further CC0 MakeHuman face targets from the MPFB data in Anny as identity controls.

python scripts/pack-human-identity.py PATH/anny-0.6.2-py3-none-any.whl character-view/human-identity-data.json

The controls are stored beside the main adult packet and use its vertex order, so the
main packet stays as it is. Each control has a lower target `0` and an upper target `1`
in 0.1 mm steps, like the measurements packed by pack-human.py. A saved adult without
these controls evaluates exactly as before.
"""

import argparse
import base64
import gzip
import hashlib
import io
import json
import pathlib
import zlib
import zipfile

import numpy as np

CONTROLS = {
    "faceTaper": (["head/head-triangular"], ["head/head-invertedtriangular"]),
    "faceRound": (["head/head-rectangular"], ["head/head-round"]),
    "faceSquare": (["head/head-oval"], ["head/head-square"]),
    "faceDiamond": ([("head/head-diamond", -0.5)], [("head/head-diamond", 0.8)]),
    "faceFlesh": (["head/head-fat-decr"], ["head/head-fat-incr"]),
    "nasolabialFold": (["mouth/mouth-laugh-lines-out"], ["mouth/mouth-laugh-lines-in"]),
    "cheekHollow": (
        ["cheek/l-cheek-inner-incr", "cheek/r-cheek-inner-incr"],
        ["cheek/l-cheek-inner-decr", "cheek/r-cheek-inner-decr"],
    ),
    "lidBag": (
        ["eyes/l-eye-bag-height-decr", "eyes/r-eye-bag-height-decr"],
        ["eyes/l-eye-bag-height-incr", "eyes/r-eye-bag-height-incr"],
    ),
    "jawAngle": (["chin/chin-bones-decr"], ["chin/chin-bones-incr"]),
    "jawDrop": (["chin/chin-jaw-drop-decr"], ["chin/chin-jaw-drop-incr"]),
    "chinCleft": (["chin/chin-cleft-decr"], ["chin/chin-cleft-incr"]),
    "chinPoint": ([("chin/chin-triangle", -0.6)], ["chin/chin-triangle"]),
    "noseVolume": (["nose/nose-volume-decr"], ["nose/nose-volume-incr"]),
    "noseCurve": (["nose/nose-curve-concave"], ["nose/nose-curve-convex"]),
    "noseRoot": (["nose/nose-greek-decr"], ["nose/nose-greek-incr"]),
    "noseBridgeWidth": (
        ["nose/nose-width1-decr", "nose/nose-width2-decr"],
        ["nose/nose-width1-incr", "nose/nose-width2-incr"],
    ),
    "nostrilFlare": (["nose/nose-flaring-decr"], ["nose/nose-flaring-incr"]),
    "noseBase": (["nose/nose-base-down"], ["nose/nose-base-up"]),
    "noseHeight": (["nose/nose-trans-down"], ["nose/nose-trans-up"]),
    "eyeOpening": (
        ["eyes/l-eye-height2-decr", "eyes/r-eye-height2-decr"],
        ["eyes/l-eye-height2-incr", "eyes/r-eye-height2-incr"],
    ),
    "eyeInner": (
        ["eyes/l-eye-height1-decr", "eyes/r-eye-height1-decr"],
        ["eyes/l-eye-height1-incr", "eyes/r-eye-height1-incr"],
    ),
    "eyeOuter": (
        ["eyes/l-eye-height3-decr", "eyes/r-eye-height3-decr"],
        ["eyes/l-eye-height3-incr", "eyes/r-eye-height3-incr"],
    ),
    "eyeDepth": (
        ["eyes/l-eye-push1-in", "eyes/r-eye-push1-in", "eyes/l-eye-push2-in", "eyes/r-eye-push2-in"],
        ["eyes/l-eye-push1-out", "eyes/r-eye-push1-out", "eyes/l-eye-push2-out", "eyes/r-eye-push2-out"],
    ),
    "eyeLevel": (
        ["eyes/l-eye-trans-down", "eyes/r-eye-trans-down"],
        ["eyes/l-eye-trans-up", "eyes/r-eye-trans-up"],
    ),
    "epicanthus": (
        ["eyes/l-eye-epicanthus-out", "eyes/r-eye-epicanthus-out"],
        ["eyes/l-eye-epicanthus-in", "eyes/r-eye-epicanthus-in"],
    ),
    "browAngle": (["eyebrows/eyebrows-angle-down"], ["eyebrows/eyebrows-angle-up"]),
    "browRidge": (["eyebrows/eyebrows-trans-backward"], [("eyebrows/eyebrows-trans-forward", 0.4)]),
    "foreheadSlope": (["forehead/forehead-trans-backward"], ["forehead/forehead-trans-forward"]),
    "mouthHeight": (["mouth/mouth-scale-vert-decr"], ["mouth/mouth-scale-vert-incr"]),
    "jawSkew": (["asym/asym-jaw-1-r"], ["asym/asym-jaw-1-l"]),
    "noseSkew": (["asym/asym-nose-1-r"], ["asym/asym-nose-1-l"]),
    "mouthSkew": (["asym/asym-mouth-1-r"], ["asym/asym-mouth-1-l"]),
    "eyeSkew": (["asym/asym-eye-1-r"], ["asym/asym-eye-1-l"]),
    "browSkew": (["asym/asym-brown-1-r"], ["asym/asym-brown-1-l"]),
    "cheekSkew": (["asym/asym-cheek-1-r"], ["asym/asym-cheek-1-l"]),
}


def pack(wheel, destination, only=None):
    expected = "anny-0.6.2-py3-none-any.whl"
    if wheel.name != expected:
        raise ValueError(f"Expected {expected}")
    archive = zipfile.ZipFile(wheel)
    prefix = "anny/data/mpfb2/"

    def read(name):
        return archive.read(prefix + name)

    vertices, groups = [], {}
    for line in read("3dobjs/base.obj").decode().splitlines():
        fields = line.split()
        if not fields:
            continue
        if fields[0] == "v":
            vertices.append([float(x) * 0.1 for x in fields[1:4]])
        elif fields[0] == "g":
            group = fields[1]
        elif fields[0] == "f":
            groups.setdefault(group, set()).update(int(s.split("/")[0]) - 1 for s in fields[1:])
    vs = np.array(vertices)
    rig = json.loads(read("rigs/standard/rig.game_engine.json"))
    names = [name for name in rig if name != "Root"]
    joints = [sorted(groups[rig[name]["head"]["cube_name"]]) for name in names]
    body_ids = sorted(groups["body"])
    eye_ids = sorted(groups["helper-l-eye"] | groups["helper-r-eye"])
    lash_ids = sorted(set().union(*(v for k, v in groups.items() if "eyelashes" in k)))
    garment_helpers = sorted(
        set.union(*(groups[k] for k in ["helper-tights", "helper-skirt", "helper-hair"]))
        - set(body_ids + eye_ids + lash_ids)
    )
    ids = body_ids + eye_ids + lash_ids + garment_helpers

    def reduce(a):
        return np.vstack([a[ids], [np.mean(a[j], axis=0) for j in joints]])

    def delta(target):
        raw = gzip.decompress(read("targets/" + target + ".target.gz")).strip()
        out = np.zeros_like(vs)
        if raw:
            a = np.loadtxt(io.BytesIO(raw), comments="#", ndmin=2)
            out[a[:, 0].astype(int)] = 0.1 * a[:, 1:4]
        return out

    packet = {}
    chosen = [key for key in CONTROLS if not only or key in only]
    for key in chosen:
        for i, parts in enumerate(CONTROLS[key]):
            total = np.zeros_like(vs)
            for part in parts:
                name, gain = part if isinstance(part, tuple) else (part, 1)
                total += gain * delta(name)
            data = np.rint(reduce(total) * 10000).astype("<i2").tobytes()
            packet["m:" + key + str(i)] = base64.b64encode(zlib.compress(data, 9)).decode()
    meta = {
        "axes": chosen,
        "vertices": len(ids) + len(joints),
        "sourceSha256": hashlib.sha256(wheel.read_bytes()).hexdigest(),
    }
    destination.write_text(json.dumps({"meta": meta, "packet": packet}, separators=(",", ":")))
    print(len(chosen), "controls,", destination.stat().st_size, "bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("wheel", type=pathlib.Path)
    parser.add_argument("destination", type=pathlib.Path)
    parser.add_argument("--only", nargs="*")
    args = parser.parse_args()
    pack(args.wheel, args.destination, args.only)
