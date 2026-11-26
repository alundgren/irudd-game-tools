"""Pack artist-authored facial colour, relief and gloss for the portrait finish of the adult face.

Usage: python scripts/pack-human-portrait-finish.py SYSTEM RELIEF_SKIN character-view character-view/human-portrait-finish-data.json [preview.png]

SYSTEM       the CC0 MakeHuman system asset pack (a zip, or a directory holding skins/<name>/<file>.png)
RELIEF_SKIN  the directory of Mindfront's CC0 "skin_male_african_middleage" (its _NRM and _SPEC maps)
character-view  where human-complexion-data.json, human-face-visibility.json and human-brow-paint.json are read

The system skins share the texture layout of the workshop head, so the face rectangle of a skin lies on
the workshop face without any fitting. Each skin is stored as what its artist painted relative to that
donor's own bare facial skin, per channel and in linear light, as a logarithm:

    byte = 128 + 127 * clamp(ln(texel / bare) / (darker if negative else lighter), -1, 1)

so 128 is bare skin and the workshop can lay the paint on any skin colour. Before storing:
- scalp hair, sideburns and painted brows are filled from the open skin beside them (the workshop grows its own),
- the smooth sheet through the donor's values at the border of the face is removed, so the paint starts from the
  person's own colour where it meets the body,
- the paint fades out towards hairline and ears, and its mean over the face is brought to bare skin,
- the parted line of the mouth is a dark warm line (donors paint teeth or a gap there).

The relief is the height of pores (micro) and of lip, lid and line forms (meso), integrated from the normal map,
and the gloss is the specular map about the value of open facial skin. `lips` is the vermilion shared by all
donors: where the median donor is redder than its skin.

Keep the source downloads local. Sources: https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html
and http://www.makehumancommunity.org/node/526, both recorded in the packed credits.
"""
import base64
import io
import json
import sys
import zipfile
import zlib
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

DARKER, LIGHTER = 1.6, 0.8
MICRO_SCALE, MESO_SCALE = 400.0, 110.0
DONORS = [
    ("young_african_female", 0), ("young_african_male", 0), ("young_asian_female", 0), ("young_asian_male", 0),
    ("young_caucasian_female", 0), ("young_caucasian_female2", 0), ("young_caucasian_male", 0), ("young_caucasian_male2", 0),
    ("middleage_african_female", 1), ("middleage_african_male", 1), ("middleage_asian_female", 1), ("middleage_asian_male", 1),
    ("middleage_caucasian_female", 1), ("middleage_caucasian_male", 1),
    ("old_african_female", 2), ("old_african_male", 2), ("old_asian_female", 2), ("old_asian_male", 2),
    ("old_caucasian_female", 2), ("old_caucasian_male", 2),
]


def to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def blur(a, s):
    return ndimage.gaussian_filter(a, [s, s] + [0] * (a.ndim - 2))


def decode(url):
    return Image.open(io.BytesIO(base64.b64decode(url.split(",")[1])))


def encode(image, quality):
    stream = io.BytesIO()
    Image.fromarray(image).save(stream, "WEBP", quality=quality, method=6)
    return "data:image/webp;base64," + base64.b64encode(stream.getvalue()).decode("ascii")


def skins(library):
    """Diffuse image of every listed donor, by name."""
    found = {}
    if library.is_file():
        with zipfile.ZipFile(library) as zf:
            for name in zf.namelist():
                parts = name.split("/")
                if len(parts) == 3 and parts[0] == "skins" and name.endswith(".png"):
                    found[parts[1]] = Image.open(io.BytesIO(zf.read(name))).convert("RGB")
    else:
        for path in sorted((library / "skins").glob("*/*.png")):
            found[path.parent.name] = Image.open(path).convert("RGB")
    return found


def crop(image, rect, size):
    k = image.size[0] / 2048
    return np.asarray(image.crop(tuple(int(round(v * k)) for v in rect)).resize(size, Image.Resampling.LANCZOS), float) / 255


def clean_ratio(texel, f, X, Y):
    """Log of the donor's paint over its own bare facial skin, cleaned as the module comment describes."""
    D = to_linear(texel)
    mask = f["mask"]
    lum = np.log(np.maximum(D @ np.array([0.2126, 0.7152, 0.0722]), 1e-4))
    cheek = (np.abs(np.abs(X - 295) - 105) < 38) & (Y > 250) & (Y < 345)
    bare = cheek | ((np.abs(X - 295) < 60) & (Y > 110) & (Y < 160))
    ref = np.array([np.median(D[..., k][bare]) for k in range(3)])
    R = np.log(np.maximum(D, 1e-4) / ref)
    radius = ((X - 295) / 150) ** 2 + ((Y - 315) / 165) ** 2
    central = (radius < 1) & (f["lips"] < 0.05) & (f["lids"] < 0.05) & (f["socket"] < 0.3)
    trend = lum.copy()
    keep = central.astype(float)
    for s in (96, 48, 24):
        est = blur(trend * keep, s) / np.maximum(blur(keep, s), 1e-4)
        trend = lum * keep + est * (1 - keep)
    outer = smooth(radius, 0.8, 1.25)
    dark = smooth(trend - lum, 0.10, 0.22) * outer
    fine = blur(np.abs(lum - blur(lum, 1.5)), 4)
    hairy = smooth(fine / np.median(fine[bare]), 1.6, 2.6) * outer
    hair = np.clip(blur(np.clip(ndimage.maximum_filter(np.maximum(dark, hairy), 9), 0, 1), 5) * 1.6, 0, 1)
    brows = np.clip(blur(ndimage.maximum_filter(f["brows"], 15), 5) * 1.5, 0, 1)
    keep = (1 - hair) * (1 - brows)
    source = keep * (1 - np.clip(blur(np.maximum(f["lids"], f["socket"]), 3) * 1.6, 0, 1))
    est = R.copy()
    for s in (22, 11, 6):
        est = blur(est * source[..., None], s) / np.maximum(blur(source, s), 1e-4)[..., None]
        est = R * source[..., None] + est * (1 - source[..., None])
    R = R * keep[..., None] + est * (1 - keep[..., None])
    ring = smooth(mask, 0.02, 0.15) * (1 - smooth(mask, 0.3, 0.6))
    sheet = R.copy()
    for s in (120, 70, 40):
        sheet = blur(sheet * ring[..., None], s) / np.maximum(blur(ring, s), 1e-5)[..., None]
        sheet = R * ring[..., None] + sheet * (1 - ring[..., None])
    R = R - blur(sheet, 12)
    window = (1 - smooth(((X - 295) / 172) ** 2 + ((Y - 292) / 205) ** 2, 0.78, 1.22)) * smooth(mask, 0.12, 0.9)
    R = R * window[..., None]
    slit = smooth(1 - f["vis"], 0.34, 0.47) * (np.abs(X - 295) < 62) * (np.abs(Y - 372) < 16)
    slit = np.clip(blur(slit, 0.8) * 1.25, 0, 1)[..., None]
    R = R * (1 - slit) + np.array([-0.62, -0.84, -0.80]) * slit
    core = window * smooth(mask, 0.5, 0.95) * (1 - slit[..., 0])
    return R - (R.mean(-1) * core).sum() / core.sum() * 0.85 * window[..., None] * (1 - slit)


def integrate_normals(N):
    """Least-squares height of a tangent-space normal image, with the green convention of smaller curl."""
    nz = np.maximum(N[..., 2], 0.2)
    p = -N[..., 0] / nz
    best = None
    for sign in (1, -1):
        g = sign * N[..., 1] / nz
        curl = np.abs(np.gradient(p, axis=0) - np.gradient(g, axis=1)).mean()
        if best is None or curl < best[0]:
            best = (curl, g)
    g = best[1]
    h, w = p.shape
    WX, WY = np.meshgrid(np.fft.fftfreq(w) * 2 * np.pi, np.fft.fftfreq(h) * 2 * np.pi)
    d = WX ** 2 + WY ** 2
    d[0, 0] = 1
    Z = (-1j * WX * np.fft.fft2(p) - 1j * WY * np.fft.fft2(g)) / d
    Z[0, 0] = 0
    return np.real(np.fft.ifft2(Z))


def grey(a):
    b = np.clip(np.round(a), 0, 255).astype(np.uint8)
    return np.stack([b, b, b], -1)


def pack(system, relief_dir, source, out, preview=None):
    data = json.loads((source / "human-complexion-data.json").read_bytes())
    left, top, right, bottom = rect = data["rect"]
    W, H = right - left, bottom - top
    size = (W, H)
    tone, zones, eyes = (np.asarray(decode(u).convert("RGB").resize(size), float) / 255 for u in data["fields"])
    vis = np.asarray(decode(json.loads((source / "human-face-visibility.json").read_bytes())["map"]).convert("L").resize(size), float) / 255
    brows = np.zeros((H * 2, W * 2))
    for entry in json.loads((source / "human-brow-paint.json").read_bytes()).values():
        a = np.asarray(decode(entry["url"]).convert("RGBA"), float)[..., 3] / 255
        x, y = int(round(entry["x"])), int(round(entry["y"]))
        h, w = a.shape
        brows[y:y + h, x:x + w] = np.maximum(brows[y:y + h, x:x + w], a[:brows.shape[0] - y, :brows.shape[1] - x])
    brows = np.asarray(Image.fromarray((brows * 255).astype(np.uint8)).resize(size, Image.Resampling.LANCZOS), float) / 255
    f = dict(lips=tone[..., 0], lids=tone[..., 1], socket=eyes[..., 1], mask=eyes[..., 2], vis=vis, brows=brows)
    yy, xx = np.mgrid[0:W, 0:H].astype(float)
    X, Y = np.rot90(xx, 1), np.rot90(yy, 1)

    library = skins(system)
    maps, donors, ratios = [], [], []
    for name, age in DONORS:
        R = clean_ratio(crop(library[name], rect, size), f, X, Y)
        ratios.append(R)
        byte = 128 + 127 * np.clip(R / np.where(R < 0, DARKER, LIGHTER), -1, 1)
        maps.append(encode(np.clip(np.round(byte), 0, 255).astype(np.uint8), 90))
        donors.append({"name": name, "age": age, "deep": "african" in name, "male": "_male" in name})

    redness = np.median(np.stack([R[..., 0] - R[..., 1] for R in ratios]), 0)
    lips = smooth(blur(redness, 1.2), 0.07, 0.2) * (np.abs(X - 295) < 80) * (np.abs(Y - 372) < 40)
    lips = np.clip(blur(lips, 1.0), 0, 1)

    window = (1 - smooth(((X - 295) / 200) ** 2 + ((Y - 292) / 230) ** 2, 0.8, 1.25))
    normal = next(relief_dir.glob("*_NRM.png"))
    N = crop(Image.open(normal).convert("RGB"), rect, size) * 2 - 1
    N[..., :2] *= window[..., None]
    height = integrate_normals(N)
    fade = smooth(f["mask"], 0.12, 0.9) * (1 - smooth(((X - 295) / 172) ** 2 + ((Y - 292) / 205) ** 2, 0.78, 1.22))
    micro = (height - blur(height, 2.5)) * fade
    meso = (blur(height, 2.5) - blur(height, 22)) * fade
    spec = crop(Image.open(next(relief_dir.glob("*_SPEC.png"))).convert("RGB"), rect, size)[..., 0]
    open_skin = (f["mask"] > 0.95) & (f["lips"] < 0.02)
    gloss = (blur(spec, 0.6) - np.median(spec[open_skin])) * fade

    packed = {
        "encoding": {"name": "portrait-finish-v1", "neutral": 128, "darker": DARKER, "lighter": LIGHTER,
                     "micro": MICRO_SCALE, "meso": MESO_SCALE, "gloss": 255},
        "credits": [
            {"asset": "MakeHuman system skins (" + str(len(DONORS)) + " adult skins)", "author": "MakeHuman team and community", "license": "CC0",
             "source": "https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html"},
            {"asset": "mindfront_skin_male_african_middleage (normal and specular maps)", "author": "Mindfront", "license": "CC0",
             "source": "http://www.makehumancommunity.org/node/526"},
        ],
        "donors": donors,
        "maps": maps,
        "micro": encode(grey(128 + micro * MICRO_SCALE), 90),
        "meso": encode(grey(128 + meso * MESO_SCALE), 90),
        "gloss": encode(grey(128 + gloss * 255), 86),
        "lips": encode(grey(lips * 255), 90),
    }
    out.write_text(json.dumps(packed, separators=(",", ":")))
    print(out, round(out.stat().st_size / 1024), "KB", len(maps), "donors")
    if preview:
        tiles = [np.rot90(np.clip(np.exp(R) * 0.45, 0, 1) ** (1 / 2.2), -1) for R in ratios]
        tiles += [np.rot90(grey(128 + micro * MICRO_SCALE) / 255, -1), np.rot90(grey(128 + meso * MESO_SCALE) / 255, -1),
                  np.rot90(grey(128 + gloss * 255) / 255, -1), np.rot90(grey(lips * 255) / 255, -1)]
        rows = [np.concatenate(tiles[i:i + 6], 1) for i in range(0, 24, 6)]
        Image.fromarray((np.concatenate(rows, 0) * 255).astype(np.uint8)).save(preview)


if __name__ == "__main__":
    pack(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]), sys.argv[5] if len(sys.argv) > 5 else None)
