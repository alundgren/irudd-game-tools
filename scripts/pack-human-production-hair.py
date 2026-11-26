from pathlib import Path
import cv2, numpy as np, json, zlib, base64
from PIL import Image
from scipy.ndimage import gaussian_filter, distance_transform_edt
import argparse

parser = argparse.ArgumentParser(
    description="Register the two MIT Rocketbox grooms to the editable skull."
)
parser.add_argument(
    "extracted",
    type=Path,
    help="Folder with Female_Adult_12.npz and Female_Adult_13.npz",
)
parser.add_argument(
    "textures", type=Path, help="Folder containing each source avatar's texture folder"
)
parser.add_argument("output", type=Path)
args = parser.parse_args()
p = args.extracted


def enc(a):
    return base64.b64encode(zlib.compress(a.tobytes(), 9)).decode()


styles = {
    "Female_Adult_12": (
        "Fringed ponytail",
        [
            (0, 123),
            (43, 112),
            (53, 84),
            (60, 77),
            (69, 78),
            (76, 84),
            (82, 79),
            (90, 66),
            (100, 62),
            (111, 63),
            (117, 54),
            (129, 57),
            (139, 55),
            (151, 64),
            (162, 72),
            (177, 84),
            (182, 80),
            (195, 81),
            (200, 95),
            (214, 114),
            (250, 123),
        ],
    ),
    "Female_Adult_13": (
        "Feathered pixie",
        [
            (0, 113),
            (44, 111),
            (51, 91),
            (55, 79),
            (66, 76),
            (68, 90),
            (77, 85),
            (92, 62),
            (100, 48),
            (110, 35),
            (128, 27),
            (138, 27),
            (150, 35),
            (156, 58),
            (162, 71),
            (173, 83),
            (185, 79),
            (196, 82),
            (201, 100),
            (213, 117),
            (250, 117),
        ],
    ),
}
out = {}
for model, (name, edge) in styles.items():
    d = np.load(p / (model + ".npz"))
    xyz, tri, uv, mat = (d[k] for k in ("xyz", "tri", "uv", "mat"))
    src = args.textures / model
    head = np.float32(
        Image.open(next(src.glob("*_head_color.tga")))
        .convert("RGB")
        .resize((768, 768), Image.Resampling.LANCZOS)
    )
    pix = np.uint8(head)
    y, x = np.indices((768, 768)) * 250 / 768
    line = np.interp(x, *np.array(edge).T)
    dist = line - y
    labels = np.where(
        dist > 7, 1, np.where(dist > 0, 3, np.where(dist > -7, 2, 0))
    ).astype("u1")
    cv2.setRNGSeed(27)
    cv2.grabCut(
        pix,
        labels,
        None,
        np.zeros((1, 65)),
        np.zeros((1, 65)),
        4,
        cv2.GC_INIT_WITH_MASK,
    )
    a = (labels % 2).astype(float)
    a *= pix.max(2) > 12
    labs = cv2.connectedComponents(np.uint8(pix.max(2) > 18))[1]
    pony = labs[int(215 / 250 * 768), int(201 / 250 * 768)]
    if pony:
        a[(labs == pony) & (y > 153) & (x > 128)] = 1
    a = gaussian_filter(a, 1.5)
    texture = (
        Image.open(next(src.glob("*_opacity_color.tga")))
        .convert("RGBA")
        .resize((512, 512), Image.Resampling.LANCZOS)
    )

    def gray(rgb, alpha):
        lum = np.dot(rgb[..., :3], [0.26, 0.58, 0.16])
        median = np.median(lum[(alpha > 0.7) & (lum > 12)])
        return np.uint8(np.clip(177 * (lum / max(20, median)) ** 0.86, 20, 255))

    tone = gray(head, a)
    ah = np.asarray(
        Image.fromarray(np.uint8(a * 255)).resize((512, 512), Image.Resampling.LANCZOS)
    )
    top = np.stack(
        [
            np.asarray(
                Image.fromarray(tone).resize((512, 512), Image.Resampling.LANCZOS)
            ),
            ah,
        ],
        axis=2,
    )
    card = np.array(texture)
    bottom = np.stack([gray(card, card[:, :, 3] / 255), card[:, :, 3]], axis=2)
    inside = distance_transform_edt(ah > 128)
    yy0, _ = np.indices(ah.shape)
    roots = np.uint8(np.clip(inside / 8.0, 0, 1) * 255)
    roots[yy0 > int(0.60 * 512)] = 255
    top = np.dstack((top, roots))
    bottom = np.dstack((bottom, np.full((512, 512), 255, "u1")))
    packed = np.vstack([top, bottom])
    soft = cv2.dilate(ah, np.ones((11, 11), "u1"))
    criterion = np.zeros(len(tri), bool)
    for weights in [
        [i / 4, j / 4, 1 - (i + j) / 4] for i in range(5) for j in range(5 - i)
    ]:
        pt = np.clip(np.einsum("v,tvc->tc", weights, uv) * 511, 0, 511).astype(int)
        criterion |= soft[pt[:, 1], pt[:, 0]] > 10
    cards = mat == 2
    cards &= uv.mean(1)[:, 1] < (0.84 if model.endswith("12") else 0.73)
    keep = (criterion & (mat == 1)) | cards
    xyzMid = xyz[tri].mean(axis=1)
    keep &= (xyzMid[:, 1] > 1.634 - 0.065) | (xyzMid[:, 2] < -0.085)

    t = tri[keep]
    tex = uv[keep].copy()
    tex[:, :, 1] = (tex[:, :, 1] + (mat[keep] == 2)[:, None]) * 0.5
    center = np.array([0, 1.634, -0.045])
    radii = np.array([0.076, 0.090, 0.101])
    points = (xyz[t] - center) / radii
    raw = np.int16(np.rint(np.concatenate([points, tex], axis=2).reshape(-1, 5) * 4000))
    unique, ix = np.unique(raw, return_inverse=True, axis=0)
    out[name] = dict(
        model=model,
        points=enc(unique.astype("<i2")),
        index=enc(ix.astype("<u2")),
        texture=enc(packed),
    )
    print(name, len(t), len(unique))
args.output.write_text(json.dumps(out, separators=(",", ":")))
