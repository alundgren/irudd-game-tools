"""Pack the Survey vest and Hoodie and denim shorts from Microsoft Rocketbox adult models 05 and 12.
Uses SciPy, NumPy, Pillow and Node. Run rocketbox-extract.py in background Blender first.
"""

from pathlib import Path
import sys, os, json, base64, zlib, io, argparse, subprocess
import numpy as np
from scipy.interpolate import RBFInterpolator
from scipy.ndimage import distance_transform_edt
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from PIL import Image, ImageDraw

repo = Path(__file__).resolve().parents[1]
args = argparse.ArgumentParser(description=__doc__)
args.add_argument(
    "work",
    type=Path,
    help="Extracted .npz, .bones.json and -arm.npy files from rocketbox-extract.py",
)
args.add_argument(
    "textures", type=Path, help="Original Rocketbox folders, one per source character"
)
args.add_argument("output", type=Path)
opts = args.parse_args()
p = opts.work.resolve()
os.environ["EINAR_WORK"] = str(p)
binder = repo / "scripts/einar-attire"
subprocess.run(
    ["node", str(binder / "body.mjs"), str(p / "body-rest.json")], cwd=repo, check=True
)
sys.path.insert(0, str(binder))
import fit as native


def chart_ids(uv):
    q, ix = np.unique(
        np.rint(uv.reshape(-1, 2) * 16000).astype(int), axis=0, return_inverse=True
    )
    ix = ix.reshape(-1, 3)
    edges = np.vstack((ix[:, [0, 1]], ix[:, [1, 2]], ix[:, [2, 0]]))
    _, groups = connected_components(
        coo_matrix((np.ones(len(edges)), edges.T), shape=(len(q), len(q))),
        directed=False,
    )
    return groups[ix[:, 0]]


def enc(arr, dtype):
    return base64.b64encode(
        zlib.compress(np.ascontiguousarray(arr, dtype).tobytes(), 9)
    ).decode()


def web(arr):
    b = io.BytesIO()
    Image.fromarray(np.uint8(arr)).save(b, "WEBP", quality=92, method=5)
    return "data:image/webp;base64," + base64.b64encode(b.getvalue()).decode()


def outfit(model):
    z = np.load(p / (model + ".npz"))
    body = z["mat"] == 0
    tri = z["tri"][body]
    uv = z["uv"][body]
    ids = chart_ids(uv)
    male = model.startswith("Male")
    # Each number is a connected island in the source UV chart.
    taboo = [1, 3, 4, 5, 6, 28] if male else [0, 23, 5, 21, 13, 14, 15]
    keep = ~np.isin(ids, taboo)
    tri = tri[keep]
    uv = uv[keep]
    ids = ids[keep]
    # Register the donor's fitting pose and place the sole on the native ground plane.
    bones = json.loads((p / (model + ".bones.json")).read_text())
    src = []
    dst = []

    def anchor(d, t):
        src.append(np.array(bones["Bip01 " + d]))
        dst.append(native.JOINT[t])

    for d, t in [("Pelvis", "pelvis"), ("Neck", "neck_01"), ("Head", "head")]:
        anchor(d, t)
    for side in ["L", "R"]:
        for d, t in [
            ("UpperArm", "upperarm"),
            ("Forearm", "lowerarm"),
            ("Hand", "hand"),
            ("Thigh", "thigh"),
            ("Calf", "calf"),
            ("Foot", "foot"),
            ("Toe0", "ball"),
        ]:
            anchor(side + " " + d, t + "_" + side.lower())
    for d, t in [("Spine", "spine_01"), ("Spine1", "spine_02"), ("Spine2", "spine_03")]:
        anchor(d, t)
    used, tri = np.unique(tri, return_inverse=True)
    tri = tri.reshape(-1, 3)
    xyz = z["xyz"][used]
    warp = RBFInterpolator(
        src, np.array(dst) - np.array(src), kernel="thin_plate_spline", smoothing=0.0003
    )
    pos = xyz + warp(xyz)
    pos = native.clear({"tri": tri}, pos, [(native.body, 0.004)], 0.004)
    # A sleeve follows its own arm even when it brushes the waist. Each trouser leg follows its own thigh.
    kinds = np.zeros(len(pos), int)
    armShare = np.load(p / (model + "-arm.npy"))[used]
    kinds[armShare > 0.32] = 1
    kinds[tri[np.isin(ids, [0, 27] if male else [1, 18, 3, 4, 19, 24])].ravel()] = 2
    kinds[
        tri[
            np.isin(
                ids, [7, 8, 9, 21, 23, 25] if male else [6, 7, 8, 9, 16, 17, 20, 22]
            )
        ].ravel()
    ] = 3
    refs = np.zeros((len(pos), 3), int)
    wts = np.zeros((len(pos), 3))
    offsets = np.zeros_like(wts)
    for kind, allow in enumerate(
        [
            (native.ARM < 0.65) & (native.HEAD < 0.75) & (native.HAND < 0.05),
            (native.ARM > 0.25) & (native.HAND < 0.6),
            (native.ARM < 0.05) & (native.HAND < 0.05) & (native.FOOT < 0.96),
            native.LEG > 0.5,
        ]
    ):
        for sign in [-1, 1] if kind else [0]:
            sel = kinds == kind
            if sign:
                sel &= pos[:, 0] * sign >= 0
            if not sel.any():
                continue
            ok = allow if not sign else allow & (native.BP[:, 0] * sign > -0.005)
            refs[sel], wts[sel], offsets[sel] = native.bind(
                pos[sel], ok, "part " + str(kind)
            )
    hide = native.covered([(pos, tri)])
    hide |= (native.FOOT > 0.72) & (native.BP[:, 1] < 0.1)
    skin = native.BP
    trunk = (native.ARM < 0.66) & (native.HAND < 0.09) & (native.HEAD < 0.03)
    # The source leaves the neck and hands open. Fully remove the torso and upper thigh skin
    # that ought to stay dressed even when shape edits push it through the low-poly source.
    hide |= trunk & (skin[:, 1] > 0.74) & (skin[:, 1] < 1.425)
    outerShoulder = (np.abs(skin[:, 0]) > 0.059) | (
        skin[:, 2] < native.JOINT["neck_01"][2] - 0.025
    )
    hide |= trunk & (skin[:, 1] >= 1.425) & (skin[:, 1] < 1.49) & outerShoulder
    hide |= (native.ARM > 0.16) & (native.HAND < 0.18) & (native.HEAD < 0.1)
    if not male:
        hide |= (native.LEG > 0.25) & (native.HAND < 0.2) & (skin[:, 1] > 0.66)
    if male:
        hide |= (native.BP[:, 1] < 1.17) & (native.ARM < 0.05) & (native.HAND < 0.05)
    uvs = uv.copy()
    uvs[:, :, 1] = 1 - uvs[:, :, 1]
    uvq, uix = np.unique(
        np.rint(uvs.reshape(-1, 2) * 65535).clip(0, 65535).astype("<u2"),
        axis=0,
        return_inverse=True,
    )
    source = opts.textures / model
    size = 768

    def picture(kind):
        return np.array(
            Image.open(next(source.glob("*_body_" + kind + ".tga")))
            .convert("RGB")
            .resize((size, size), Image.Resampling.LANCZOS)
        )

    albedo = picture("color")
    normal = picture("normal")
    spec = picture("specular").mean(2) / 255
    # The source's panel boundaries are UV seams. Each panel follows an independent wardrobe dye.
    tones = [
        ("main", [12, 13, 15, 19, 20, 22] if male else [2, 10, 11, 12]),
        ("dark", [0, 27] if male else [1, 18, 3, 4, 19, 24]),
        ("accent", [2, 10, 16, 17, 18, 26] if male else []),
        ("leather", [7, 8, 9, 21, 23, 25] if male else [6, 7, 8, 9, 16, 17, 20, 22]),
    ]
    pim = Image.new("L", (size, size))
    brush = ImageDraw.Draw(pim)
    rules = []
    for name, islands in tones:
        if not islands:
            continue
        idx = len(rules) + 1
        for coords in uv[np.isin(ids, islands)]:
            brush.polygon([tuple(z) for z in (coords * size).astype(int)], fill=idx)
        mask = np.asarray(pim) == idx
        a = albedo[mask].astype(float) / 255
        level = np.median((a.max(1) + a.min(1)) / 2)
        rules.append(
            dict(tone=name, level=round(float(max(0.07, level)), 4), worn=0.48)
        )
    panels = np.array(pim)
    near = distance_transform_edt(
        panels == 0, return_distances=False, return_indices=True
    )
    panels = panels[tuple(near)]
    surface = np.uint8(
        np.stack(
            [
                np.ones_like(spec),
                np.clip(0.86 - 0.65 * spec, 0.29, 0.92),
                np.zeros_like(spec),
            ],
            axis=2,
        )
        * 255
    )
    return dict(
        refs=enc(native.IDS[refs], "<u2"),
        weights=enc(wts, "<f4"),
        offsets=enc(offsets, "<f4"),
        uv=enc(uvq, "<u2"),
        uvCorners=enc(uix, "<u2"),
        corners=enc(tri, "<u2"),
        hide=enc(np.sort(native.IDS[hide]), "<u2"),
        panels=enc(panels, "u1"),
        dye=rules,
        texture=web(albedo),
        normal=web(normal),
        surface=web(surface),
        credit={"author": "Microsoft", "licence": "MIT", "source": model},
    )


assets = {
    name: outfit(model)
    for name, model in [
        ("expedition_vest", "Male_Adult_05"),
        ("hoodie_shorts", "Female_Adult_12"),
    ]
}
opts.output.write_text(json.dumps(assets, separators=(",", ":")))
