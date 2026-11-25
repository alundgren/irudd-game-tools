import json, cv2, base64, zlib
import numpy as np
from scipy.ndimage import distance_transform_edt
from PIL import Image
from inputs import CACHE as p, FRAMES

enc = lambda a: base64.b64encode(zlib.compress(a.tobytes(), 9)).decode()
size = 96
yy, xx = np.mgrid[:size, :size]
u = (xx + 0.5 - size / 2) / (size / 2)
v = (yy + 0.5 - size / 2) / (size / 2)
radius = np.hypot(u, v)
angle = np.arctan2(v, u)
out = {}
for f in [p / (n + "-registration.npz") for n in FRAMES]:
    key = f.stem[:7]
    m = np.load(f)
    marks = m["scan_marks"]
    pic = np.float32(
        Image.open(p / (f.stem.replace("-registration", "-aligned") + ".jpg")).convert(
            "RGB"
        )
    )
    ims = []
    weights = []
    for i, ids in [
        (
            468,
            [
                33,
                7,
                163,
                144,
                145,
                153,
                154,
                155,
                133,
                173,
                157,
                158,
                159,
                160,
                161,
                246,
            ],
        ),
        (
            473,
            [
                263,
                249,
                390,
                373,
                374,
                380,
                381,
                382,
                362,
                398,
                384,
                385,
                386,
                387,
                388,
                466,
            ],
        ),
    ]:
        center = marks[i]
        ring = marks[i + 1 : i + 5]
        r = np.median(np.linalg.norm(ring - center, axis=1))
        eye = np.zeros(pic.shape[:2], "uint8")
        cv2.fillPoly(eye, [np.rint(marks[ids]).astype("i")], 1)
        dist = distance_transform_edt(eye).astype("f")
        for sx, sy in [(1, 1), (-1, 1), (1, -1), (-1, -1)]:
            x = (center[0] + sx * r * u).astype("f")
            y = (center[1] + sy * r * v).astype("f")
            sample = cv2.remap(pic, x, y, cv2.INTER_LINEAR)
            wt = cv2.remap(dist, x, y, cv2.INTER_LINEAR).clip(0, 8) / 8
            ims.append(sample)
            weights.append(wt * (1 if sx == sy == 1 else 0.7))
    imgs = np.stack(ims)
    ww = np.stack(weights)
    col = (imgs * ww[:, :, :, None]).sum(0) / np.maximum(0.01, ww.sum(0)[:, :, None])
    # Where the upper lid blocks a sector, fill using other exposed angles at the same radius.
    known = ww.sum(0) > 0.08
    for ring in np.arange(0, 1.5, 0.045):
        select = (radius >= ring) & (radius < ring + 0.045)
        valid = known & select
        if valid.any():
            col[select & ~known] = np.median(col[valid], axis=0)
    lum = col @ [0.25, 0.6, 0.15]
    ring = (radius > 0.44) & (radius < 0.84)
    baseline = max(15, np.median(lum[ring & known]) if (ring & known).any() else 40)
    rel = np.uint8(np.clip(142 * lum / baseline, 22, 238))
    out[key] = dict(value=enc(rel), size=size)

(p / "captured-irises.json").write_text(json.dumps(out, separators=(",", ":")))
