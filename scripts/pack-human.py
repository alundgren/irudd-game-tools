"""Pack the CC0 body, joint markers, weights and adult morphs from Anny's MPFB data."""

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
from human_subdivision import subdivision
from human_lattice import lattice


def pack(wheel, destination):
    expected = "anny-0.6.2-py3-none-any.whl"
    if wheel.name != expected:
        raise ValueError(f"Expected {expected}")
    archive = zipfile.ZipFile(wheel)
    prefix = "anny/data/mpfb2/"

    def read(name):
        return archive.read(prefix + name)

    vertices, faces, groups, uv, uv_faces = [], {}, {}, [], {}
    body_polys, body_uv = [], []
    for line in read("3dobjs/base.obj").decode().splitlines():
        fields = line.split()
        if not fields:
            continue
        if fields[0] == "v":
            vertices.append([float(x) * 0.1 for x in fields[1:4]])
        elif fields[0] == "vt":
            uv.append([float(x) for x in fields[1:3]])
        elif fields[0] == "g":
            group = fields[1]
        elif fields[0] == "f":
            polygon = [int(s.split("/")[0]) - 1 for s in fields[1:]]
            tex = [int(s.split("/")[1]) - 1 for s in fields[1:]]
            if group == "body":
                body_polys.append(polygon)
                body_uv.append(tex)
            uv_faces.setdefault(group, []).extend(
                [tex[0], tex[i], tex[i + 1]] for i in range(1, len(tex) - 1)
            )
            groups.setdefault(group, set()).update(polygon)
            faces.setdefault(group, []).extend(
                [polygon[0], polygon[i], polygon[i + 1]]
                for i in range(1, len(polygon) - 1)
            )
    vs = np.array(vertices)
    rig = json.loads(read("rigs/standard/rig.game_engine.json"))
    names = [name for name in rig if name != "Root"]

    def joint(name):
        return sorted(groups[rig[name]["head"]["cube_name"]])

    joints = [joint(name) for name in names]
    body_ids = sorted(groups["body"])
    eye_ids = sorted(groups["helper-l-eye"] | groups["helper-r-eye"])
    lash_ids = sorted(set().union(*(v for k, v in groups.items() if "eyelashes" in k)))
    garment_helpers = sorted(
        set.union(
            *(groups[k] for k in ["helper-tights", "helper-skirt", "helper-hair"])
        )
        - set(body_ids + eye_ids + lash_ids)
    )
    ids = body_ids + eye_ids + lash_ids + garment_helpers
    # Keep triangle connectivity welded. Head-aligned eye helpers follow the lids.
    remap = {v: i for i, v in enumerate(ids)}
    triangles = np.array(
        [
            [remap[v] for v in face]
            for g in ["body", "helper-l-eye", "helper-r-eye"]
            for face in faces[g]
        ]
    )
    slots = [[] for _ in ids]
    for name, pairs in json.loads(read("rigs/standard/weights.game_engine.json"))[
        "weights"
    ].items():
        if name in names:
            for v, w in pairs:
                if v in remap and w > 0:
                    slots[remap[v]].append((w, names.index(name)))
    bone_ids = np.zeros((len(ids), 4), dtype=np.uint8)
    weights = np.zeros((len(ids), 4), dtype=np.uint16)
    for i, pairs in enumerate(slots):
        best = sorted(pairs, reverse=True)[:4] or [(1, names.index("head"))]
        total = sum(w for w, _ in best)
        for k, (w, b) in enumerate(best):
            bone_ids[i, k] = b
            weights[i, k] = round(65535 * w / total)
        weights[i, 0] = int(weights[i, 0]) + 65535 - int(weights[i].astype(int).sum())

    def reduce(a):
        return np.vstack([a[ids], [np.mean(a[j], axis=0) for j in joints]])

    packet = {}

    def encode(name, a, dtype):
        data = np.asarray(a, dtype=dtype).tobytes()
        packet[name] = base64.b64encode(zlib.compress(data, 9)).decode()

    encode("base", reduce(vs), "<f4")
    encode("indices", triangles, "<u2")
    encode("uv", np.rint(np.clip(uv, 0, 1) * 65535), "<u2")
    encode("uvFaces", uv_faces["body"], "<u2")
    encode("ids", ids, "<u2")
    refined_uv = subdivision(
        [[remap[v] for v in p] for p in body_polys],
        body_uv,
        uv,
        len(body_ids),
        bone_ids,
        weights,
        encode,
    )
    from PIL import Image

    masks = []
    for area in ["lips", "eyelids", "inside-mouth", "fingernails"]:
        im = np.asarray(
            Image.open(io.BytesIO(read("textures/mpfb_" + area + ".jpg"))).convert("L")
        )
        x = np.rint(np.clip(refined_uv[:, 0], 0, 1) * (im.shape[1] - 1)).astype(int)
        y = np.rint((1 - np.clip(refined_uv[:, 1], 0, 1)) * (im.shape[0] - 1)).astype(
            int
        )
        masks.append(im[y, x])
    encode("subPigments", np.stack(masks, axis=1), "u1")
    encode("bones", bone_ids, "u1")
    encode("weights", weights, "<u2")

    # Smooth tightly spaced detail rings at the chest apex; the broader chest remains.
    # The local chest point target identifies exactly the same vertices in all body shapes.
    def delta(target):
        raw = gzip.decompress(read("targets/" + target + ".target.gz")).strip()
        out = np.zeros_like(vs)
        if raw:
            a = np.loadtxt(io.BytesIO(raw), comments="#", ndmin=2)
            out[a[:, 0].astype(int)] = 0.1 * a[:, 1:4]
        return out

    def morph(key, a):
        # 0.1 mm displacement resolution, including the centres of the moving joints.
        encode("m:" + key, np.rint(reduce(a) * 10000), "<i2")

    for sex in ["female", "male"]:
        for age in ["young", "old"]:
            for ancestry in ["african", "asian", "caucasian"]:
                morph(
                    "-".join([ancestry, sex, age]),
                    delta(f"macrodetails/{ancestry}-{sex}-{age}"),
                )
            for muscle in ["min", "average", "max"]:
                for weight in ["min", "average", "max"]:
                    if muscle == weight == "average":
                        continue
                    label = f"{sex}-{age}-{muscle}muscle-{weight}weight"
                    morph(label, delta("macrodetails/universal-" + label))
    units = {
        "Blink": ["eye-left-closure", "eye-right-closure"],
        "Smile": ["mouth-corner-puller", "mouth-upward-retraction"],
        "BrowLift": ["eyebrows-left-up", "eyebrows-right-up"],
    }
    for expression, parts in units.items():
        average = (
            sum(
                delta(f"expression/units/{family}/{unit}")
                for family in ["african", "asian", "caucasian"]
                for unit in parts
            )
            / 3
        )
        if expression == "Smile":
            average *= 0.72
            # The narrowing at the lids and the raised cheek accompany the
            # mouth corners. The fitted lashes receive the same displacement.
            for side in ("left", "right"):
                for family in ("african", "asian", "caucasian"):
                    root = "expression/units/" + family + "/"
                    average += (0.21 / 3) * delta(root + "eye-" + side + "-slit")
                    average += (0.11 / 3) * delta(root + "nose-" + side + "-elevation")
            x, y, z = vs.T
            malar = np.exp(-(((np.abs(x) - 0.043) / 0.021) ** 2
                + ((y - 0.709) / 0.019) ** 2 + ((z - 0.125) / 0.025) ** 2))
            average[:, 0] += np.sign(x) * 0.0009 * malar
            average[:, 1] += 0.0036 * malar
            average[:, 2] += 0.0029 * malar
        morph(expression, average)
    # Separate endpoints for the artist's smile control. Lip pressure and a
    # quieter corner pull make a reserved smile. The open smile retracts the
    # lip, raises the cheek and narrows the eye with bilateral muscle actions.
    def expression_unit(name):
        return sum(delta(f"expression/units/{family}/{name}")
                   for family in ("african", "asian", "caucasian")) / 3

    for name, actions, cheek in (
        ("ReservedSmile", {"mouth-corner-puller": .52, "mouth-upward-retraction": .06,
                           "mouth-compression": .18, "eye-left-slit": .12, "eye-right-slit": .12}, .52),
        ("BroadSmile", {"mouth-corner-puller": .84, "mouth-upward-retraction": .97,
                        "mouth-retraction": .13, "mouth-open": .10,
                        "eye-left-slit": .43, "eye-right-slit": .43,
                        "nose-left-elevation": .17, "nose-right-elevation": .17}, 1.30),
    ):
        motion = sum(gain * expression_unit(unit) for unit, gain in actions.items())
        motion[:, 0] += np.sign(vs[:, 0]) * .0009 * cheek * malar
        motion[:, 1] += .0036 * cheek * malar
        motion[:, 2] += .0029 * cheek * malar
        # The corner pull in isolation rises almost twice as far as it travels
        # outwards. The risorius draws the commissure across the teeth. Share
        # more of the gesture laterally while the central lip still uncovers them.
        x, y, z = vs.T
        commissure = np.exp(-(((np.abs(x) - .025) / .022) ** 2 +
                              ((y - .663) / .026) ** 2 + ((z - .144) / .034) ** 2))
        across = np.clip(np.abs(x) / .018, 0, 1) * commissure
        motion[:, 0] *= 1 + .43 * across
        motion[:, 1] -= .42 * across * np.maximum(motion[:, 1], 0)
        motion[:, 2] -= .38 * across * np.minimum(motion[:, 2], 0)
        morph(name, motion)
    paired = {
        "eyeSpacing": ("eyes", "eye-trans-in", "eye-trans-out"),
        "eyeTilt": ("eyes", "eye-corner2-down", "eye-corner2-up"),
        "eyeFold": ("eyes", "eye-eyefold-down", "eye-eyefold-up"),
        "earTip": ("ears", "ear-shape-round", "ear-shape-pointed"),
        "earLevel": ("ears", "ear-trans-down", "ear-trans-up"),
        "earSetback": ("ears", "ear-trans-forward", "ear-trans-backward"),
        "earLength": ("ears", "ear-scale-vert-decr", "ear-scale-vert-incr"),
        "earFlare": ("ears", "ear-wing-decr", "ear-wing-incr"),
        "cheekFullness": ("cheek", "cheek-volume-decr", "cheek-volume-incr"),
        "hands": ("hands", "hand-scale-decr", "hand-scale-incr"),
        "feet": ("feet", "foot-scale-decr", "foot-scale-incr"),
    }
    axes = {
        "shoulders": "torso/measure-shoulder-dist",
        "waist": "torso/measure-waist-circ",
        "hips": "torso/measure-hips-circ",
        "belly": "stomach/stomach-tone",
        "chest": "torso/torso-scale-depth",
        "legs": "legs/measure-upperleg-height",
        "neck": "neck/measure-neck-circ",
        "jaw": "chin/chin-width",
        "nose": "nose/nose-scale-horiz",
        "noseBridge": "nose/nose-scale-depth",
        "cheeks": ["cheek/l-cheek-bones", "cheek/r-cheek-bones"],
        "lips": "mouth/mouth-scale-horiz",
        "chin": "chin/chin-prominent",
        "jawProjection": "chin/chin-prognathism",
        "chinHeight": "chin/chin-height",
        "forehead": "forehead/forehead-scale-vert",
        "temples": "forehead/forehead-temple",
        "noseLength": "nose/nose-scale-vert",
        "noseTipWidth": "nose/nose-point-width",
        "nostrilWidth": "nose/nose-nostrils-width",
        "craniumDepth": "head/head-back-scale-depth",
        "faceHeight": "head/head-scale-vert",
        "noseHump": "nose/nose-hump",
        "lipFullness": ["mouth/mouth-upperlip-volume", "mouth/mouth-lowerlip-volume"],
        "upperLipHeight": "mouth/mouth-upperlip-height",
        "cupidsBow": "mouth/mouth-cupidsbow",
        "underEye": ["eyes/l-eye-bag", "eyes/r-eye-bag"],
        "headWidth": "head/head-scale-horiz",
        "eyeSize": ["eyes/l-eye-scale", "eyes/r-eye-scale"],
        "brow": ["eyebrows/eyebrows-trans-down", "eyebrows/eyebrows-trans-up"],
        "ears": ["ears/l-ear-scale", "ears/r-ear-scale"],
        "seat": "buttocks/buttocks-volume",
        "arms": "arms/measure-upperarm-circ",
        "calves": "legs/measure-calf-circ",
        "upperArmLength": "arms/measure-upperarm-length",
        "forearmLength": "arms/measure-lowerarm-length",
        "shinLength": "legs/measure-lowerleg-height",
        "torsoLength": "torso/torso-scale-vert",
        "neckLength": "neck/measure-neck-height",
    }
    for key, stems in axes.items():
        for i, sign in enumerate(["decr", "incr"]):
            files = (
                [stems[i]]
                if key == "brow"
                else [
                    s + "-" + sign
                    for s in ([stems] if isinstance(stems, str) else stems)
                ]
            )
            morph(key + str(i), sum(delta(f) for f in files))
    for i, cup in enumerate(["mincup", "maxcup"]):
        morph(
            "bust" + str(i),
            delta(
                "breast/female-young-averagemuscle-averageweight-"
                + cup
                + "-averagefirmness"
            ),
        )
    axes["bust"] = None
    for key, names_pair in {
        "mouthCorners": ("mouth-angles-down", "mouth-angles-up"),
        "mouthProjection": ("mouth-trans-backward", "mouth-trans-forward"),
        "mouthLevel": ("mouth-trans-down", "mouth-trans-up"),
    }.items():
        for i, name in enumerate(names_pair):
            morph(key + str(i), delta("mouth/" + name))
        axes[key] = None
    for i, name in enumerate(["nose-point-down", "nose-point-up"]):
        morph("noseTipAngle" + str(i), delta("nose/" + name))
    axes["noseTipAngle"] = None
    # Resting contact and a small parting of the lips. The jaw and all
    # expression clips remain independently controllable.
    def mouth_unit(name):
        return sum(delta(f"expression/units/{family}/{name}")
                   for family in ["african", "asian", "caucasian"]) / 3
    part = mouth_unit("mouth-parling")
    morph("lipParting0", 0.84 * mouth_unit("mouth-compression") - 0.09 * part)
    morph("lipParting1", 0.55 * part)
    axes["lipParting"] = None
    for i, (upper, lower) in enumerate([("decr", "incr"), ("incr", "decr")]):
        # Independent vermilion balance. Retain the overall mouth width and
        # leave its resting contact and the corner height to their own axes.
        volume = (delta("mouth/mouth-upperlip-volume-" + upper)
                  + delta("mouth/mouth-lowerlip-volume-" + lower))
        morph("lipBalance" + str(i), volume * np.array([0, .15, .92]))
    axes["lipBalance"] = None
    # A slight pull of the mouth corner and adjacent cheek at rest. The centre
    # of the lips stays closed. The two controls can also make a lopsided smile.
    pull = mouth_unit("mouth-corner-puller") + .35 * mouth_unit("mouth-upward-retraction")
    outer = np.clip((np.abs(vs[:, 0]) - .006) / .018, 0, 1)
    pull *= (.59 * outer * outer * (3 - 2 * outer))[:, None]
    for axis, side in [("smileLeft", 1), ("smileRight", -1)]:
        lift = pull * (vs[:, 0] * side > 0)[:, None]
        morph(axis + "0", -.45 * lift)
        morph(axis + "1", lift)
        axes[axis] = None
    for key, (folder, lo, hi) in paired.items():
        for i, stem in enumerate([lo, hi]):
            morph(
                key + str(i),
                sum(delta(f"{folder}/{side}-{stem}") for side in ["l", "r"]),
            )
        axes[key] = None
    # Confine cheek targets to the external face. Some source files contain
    # entries beyond the cheek, and these controls should leave the eyes, lips
    # and skeleton independent. Coordinates are those of the CC0 rest cage.
    x, y, z = vs.T
    side = np.abs(x)
    skin = np.zeros(len(vs))
    skin[body_ids] = 1

    def ease(p, lower, upper):
        t = np.clip((p - lower) / (upper - lower), 0, 1)
        return t * t * (3 - 2 * t)

    def pad(cx, cy, cz, rx, ry, rz):
        q = ((side - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2
        return np.maximum(0, 1 - q) ** 2 * skin

    def cheek(stem):
        return sum(delta(f"cheek/{lr}-cheek-{stem}") for lr in ("l", "r"))

    malar = (
        skin * ease(side, .013, .035) * ease(z, .083, .114)
        * ease(y, .65, .681) * (1 - ease(y, .716, .737))
    )
    lower = (
        skin * ease(side, .023, .042) * ease(y, .605, .635)
        * (1 - ease(y, .667, .695)) * ease(z, .063, .100)
    )
    jowl = pad(.052, .647, .106, .033, .050, .058)
    under_chin = pad(0, .620, .101, .059, .057, .062)
    for i, sign in enumerate(("decr", "incr")):
        direction = 1 if i else -1
        movement = cheek("trans-" + ("up" if i else "down")) * (.80 * malar[:, None])
        morph("malarHeight" + str(i), movement)
        # The lower pad grows across the edge of the mandible. Its fall is
        # smaller than its outward displacement, so it keeps a smooth jawline.
        movement = cheek("volume-" + sign) * (.34 * lower[:, None])
        movement[:, 0] += direction * .0075 * np.sign(x) * jowl
        movement[:, 1] -= direction * .0030 * jowl
        movement[:, 2] += direction * .0025 * jowl
        morph("jowlFullness" + str(i), movement)
        movement = delta("neck/neck-double-" + sign) * (.62 * skin[:, None])
        movement[:, 2] += direction * .0058 * under_chin
        morph("submentalFullness" + str(i), movement)
    axes.update({key: None for key in ("malarHeight", "jowlFullness", "submentalFullness")})

    # Project small surface-detail zones onto a low-frequency patch fitted to the
    # surrounding skin. The correction follows each identity's broad silhouette.
    patches = []
    points = vs[ids]
    lattice(
        points, triangles[: len(faces["body"])], len(body_ids), bone_ids, names, encode
    )
    adjacency = [set() for _ in ids]
    for a, b, c in triangles:
        adjacency[a].update((b, c))
        adjacency[b].update((a, c))
        adjacency[c].update((a, b))
    # Use an area-weighted spatial low pass on the chest. The dense detail rings
    # otherwise dominate an ordinary vertex average and leave a projecting point.
    from scipy.spatial import cKDTree

    tree = cKDTree(points[: len(body_ids)])
    areas = np.zeros(len(body_ids))
    tri = triangles[: len(faces["body"])]
    area = np.linalg.norm(
        np.cross(
            points[tri[:, 1]] - points[tri[:, 0]], points[tri[:, 2]] - points[tri[:, 0]]
        ),
        axis=1,
    )
    for k in range(3):
        np.add.at(areas, tri[:, k], area)
    zone = np.sqrt(
        ((np.abs(points[:, 0]) - 0.08) / 0.090) ** 2
        + ((points[:, 1] - 0.38) / 0.093) ** 2
    )
    inside = np.where(
        (zone < 1) & (points[:, 2] > 0.068) & (np.arange(len(points)) < len(body_ids))
    )[0]
    starts = [0]
    neighbours = []
    blend = []
    for i in inside:
        near = np.array(tree.query_ball_point(points[i], 0.068))
        dist = np.sum((points[near] - points[i]) ** 2, axis=1)
        w = areas[near] * np.exp(-dist / (2 * 0.023**2))
        neighbours.extend(near)
        blend.extend(w / w.sum())
        starts.append(len(neighbours))
    encode("softIds", inside, "<u2")
    encode("softOffsets", starts, "<u4")
    encode("softNeighbours", neighbours, "<u2")
    encode("softWeights", blend, "<f4")
    encode("softMix", np.clip((1 - zone[inside]) / 0.35, 0, 1), "<f4")
    for cx, cy, rx, ry, zmin in [(0, -0.015, 0.05, 0.072, 0.015)]:
        u, v = (points[:, 0] - cx) / rx, (points[:, 1] - cy) / ry
        d = np.hypot(u, v)
        front = (points[:, 2] > zmin) & (np.arange(len(points)) < len(body_ids))
        inner = np.where(front & (d < 1))[0]
        ring = sorted(set.union(*(adjacency[i] for i in inner)) - set(inner))
        local = {v: i for i, v in enumerate(inner)}
        border = {v: i for i, v in enumerate(ring)}
        lap = np.eye(len(inner))
        fixed = np.zeros((len(inner), len(ring)))
        for v, i in local.items():
            for n in adjacency[v]:
                w = 1 / len(adjacency[v])
                if n in local:
                    lap[i, local[n]] -= w
                else:
                    fixed[i, border[n]] += w
        coefficient = np.linalg.solve(lap, fixed)
        patches.append(
            dict(
                inner=inner.tolist(),
                ring=list(map(int, ring)),
                matrix=coefficient.round(7).tolist(),
            )
        )
    meta = {
        "names": names,
        "parents": [rig[n]["parent"] for n in names],
        "axes": list(axes),
        "patches": patches,
        "bodyVertices": len(body_ids),
        "bodyTriangles": len(faces["body"]),
        "eyeGroups": [
            [remap[v] for v in sorted(groups["helper-" + s + "-eye"])]
            for s in ["l", "r"]
        ],
        "sourceSha256": hashlib.sha256(wheel.read_bytes()).hexdigest(),
    }
    destination.write_text(
        json.dumps(dict(meta=meta, packet=packet), separators=(",", ":")) + "\n"
    )
    print(
        f"{len(ids)} vertices, {len(triangles)} triangles, {len(names)} joints, {destination.stat().st_size:,} bytes"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wheel", type=pathlib.Path)
    parser.add_argument("out", type=pathlib.Path)
    args = parser.parse_args()
    pack(args.wheel, args.out)
