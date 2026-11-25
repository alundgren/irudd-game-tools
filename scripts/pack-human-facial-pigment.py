"""Recover registered broad+meso anatomical facial albedo from CC0 MakeHuman system skins.

Usage: python scripts/pack-human-facial-pigment.py SYSTEM_ZIP COMPLEXION_DATA DESTINATION

Each donor skin is read in linear light relative to its own clean jaw/outer-cheek skin ring,
producing three signed 128-centered channels:
- R (dL): broad + meso + fine anatomical luminance (including positive highlights on forehead,
  brow arch, nose bridge, cheekbones, chin, and lips, and natural creases/contours).
- G (dRG): red-green haemoglobin / vascular warmth (cheeks, nose, lips, periorbital transition).
- B (dYB): yellow-blue melanin / coolness undertone (forehead warmth, cool orbital/jaw balance).

Donor hairline, painted eyebrows, eye openings, nostril cavities, inner mouth slit/teeth,
isolated dark spots, and broad directional side-lighting are removed cleanly while guaranteeing
exact 128 at the border so the head-to-body skin seam stays invisible on arbitrary skin tones.
"""
import base64
import io
import json
import sys
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

SOURCES = [
    "young_caucasian_female",
    "young_asian_female",
    "middleage_caucasian_female",
    "middleage_caucasian_male",
    "old_caucasian_male",
    "old_caucasian_female",
]


def step(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def inpaint_masked(arr, hole_weight, sigma=10.0):
    keep = np.clip(1.0 - hole_weight, 0.0, 1.0)
    cur = arr.copy()
    for s in (sigma * 1.4, sigma * 0.7):
        num = ndimage.gaussian_filter(cur * keep, s)
        den = np.maximum(ndimage.gaussian_filter(keep, s), 1e-4)
        cur = arr * keep + (num / den) * (1.0 - keep)
    return cur


def encode(image, quality=82):
    stream = io.BytesIO()
    Image.fromarray(image).save(stream, "WEBP", quality=quality, method=6)
    return "data:image/webp;base64," + base64.b64encode(stream.getvalue()).decode("ascii")


def brow_exclusion(geometry_path, h, w):
    brow_path = geometry_path.parent / "human-brow-paint.json"
    if not brow_path.exists():
        return np.zeros((h, w), dtype=float)
    brow_layout = json.loads(brow_path.read_text())
    brow_mask = np.zeros((h, w), dtype=float)
    for entry in brow_layout.values():
        bim = Image.open(io.BytesIO(base64.b64decode(entry["url"].split(",")[1]))).convert("RGBA")
        bw, bh = bim.size
        ba = np.asarray(bim, dtype=float)[..., 3] / 255.0
        x0 = int(round(entry["x"] / 2.0))
        y0 = int(round(entry["y"] / 2.0))
        rw = max(1, int(round(bw / 2.0)))
        rh = max(1, int(round(bh / 2.0)))
        ba_small = np.asarray(
            Image.fromarray((ba * 255).astype("u1")).resize((rw, rh), Image.Resampling.BILINEAR),
            dtype=float,
        ) / 255.0
        y1, x1 = min(h, y0 + rh), min(w, x0 + rw)
        sy0, sx0 = max(0, -y0), max(0, -x0)
        dy0, dx0 = max(0, y0), max(0, x0)
        brow_mask[dy0:y1, dx0:x1] = np.maximum(
            brow_mask[dy0:y1, dx0:x1],
            ba_small[sy0:sy0 + (y1 - dy0), sx0:sx0 + (x1 - dx0)],
        )
    return np.clip(ndimage.gaussian_filter(ndimage.maximum_filter(brow_mask, size=15), 6.0) * 1.8, 0.0, 1.0)


def pack(archive, geometry, destination):
    geometry_path = Path(geometry)
    layout = json.loads(geometry_path.read_bytes())
    rect = tuple(layout["rect"])
    fetch = lambda url: np.asarray(Image.open(io.BytesIO(base64.b64decode(url.split(",")[1]))).convert("RGB"), dtype=float) / 255.0
    field0 = fetch(layout["fields"][0])
    field2 = fetch(layout["fields"][2])
    lips = field0[:, :, 0]
    lids = field0[:, :, 1]
    socket = field2[:, :, 1]
    face_mask = field2[:, :, 2]
    h, w = face_mask.shape

    yy, xx = np.mgrid[:h, :w]
    xn = xx / (w - 1.0)
    yn = yy / (h - 1.0)

    # Fade inside donor hairline/sideburns and strictly to zero before the rectangle border.
    hairline_keep = step(0.19, 0.30, xn) * (
        1.0 - step(0.76, 0.92, ((xn - 0.55) / 0.38) ** 2 + ((yn - 0.50) / 0.38) ** 2)
    )
    border_fade = step(0.08, 0.45, face_mask)
    edge_dist = np.minimum.reduce([xx, yy, w - 1 - xx, h - 1 - yy])
    clean_mask = np.clip(face_mask * hairline_keep * border_fade * step(6.0, 24.0, edge_dist), 0.0, 1.0)

    brow_exclude = brow_exclusion(geometry_path, h, w)
    eye_hole = np.clip(ndimage.gaussian_filter(step(0.12, 0.45, lids), 3.0) * 1.15, 0.0, 1.0)
    lip_cx = float(np.median(xn[lips > 0.5]))
    mouth_slit = (1.0 - step(0.008, 0.024, np.abs(xn - lip_cx))) * step(0.15, 0.55, lips)
    nostril_core = ((xn - 0.568) / 0.022) ** 2 + ((np.abs(yn - 0.50) - 0.036) / 0.024) ** 2
    nostril_hole = 1.0 - step(0.45, 1.15, nostril_core)

    ref_ring = (
        (clean_mask > 0.30)
        & (clean_mask < 0.88)
        & (xn > 0.35)
        & (xn < 0.80)
        & (np.abs(yn - 0.50) > 0.19)
        & (lips < 0.05)
        & (lids < 0.05)
    )
    socket_w = np.clip(socket * 1.1 + lids * 0.8, 0.0, 1.0)
    lip_w = np.clip(lips, 0.0, 1.0)
    non_lip = 1.0 - lips

    maps = []
    with zipfile.ZipFile(archive) as z:
        for name in SOURCES:
            path = next(i for i in z.namelist() if i.startswith(f"skins/{name}/") and i.endswith(".png"))
            im = Image.open(io.BytesIO(z.read(path))).convert("RGB").resize((2048, 2048), Image.Resampling.LANCZOS).crop(rect)
            lin = srgb_to_linear(np.asarray(im, dtype=float) / 255.0)
            lum = np.maximum(0.008, lin @ np.array([0.2126, 0.7152, 0.0722]))
            rg = np.log((lin[:, :, 0] + 0.030) / (lin[:, :, 1] + 0.030))
            yb = np.log((0.5 * (lin[:, :, 0] + lin[:, :, 1]) + 0.030) / (lin[:, :, 2] + 0.030))
            logL = np.log(lum)

            dL = logL - np.median(logL[ref_ring])
            dRG = rg - np.median(rg[ref_ring])
            dYB = yb - np.median(yb[ref_ring])

            cavity_dark = np.clip((-dL - 0.30) / 0.25, 0.0, 1.0) * np.clip(
                ndimage.gaussian_filter(eye_hole + nostril_hole + lips, 4.0) * 1.5, 0.0, 1.0
            )
            dL = inpaint_masked(dL, mouth_slit, sigma=5.0)
            dRG = inpaint_masked(dRG, mouth_slit, sigma=5.0)
            dYB = inpaint_masked(dYB, mouth_slit, sigma=5.0)

            inpaint_nonlip = np.clip(np.maximum.reduce([eye_hole, nostril_hole, brow_exclude * 0.95, cavity_dark]), 0.0, 1.0) * (1.0 - lips * 0.85)
            dL = inpaint_masked(dL, inpaint_nonlip, sigma=9.5)
            dRG = inpaint_masked(dRG, inpaint_nonlip, sigma=9.5)
            dYB = inpaint_masked(dYB, inpaint_nonlip, sigma=9.5)

            # Remove baked directional side-lighting (broad anti-symmetric component across y=0.5).
            for ch_arr, sig in [(dL, 34.0), (dRG, 40.0), (dYB, 40.0)]:
                asym = 0.5 * (ch_arr - ch_arr[::-1, :])
                broad_asym = ndimage.gaussian_filter(asym * clean_mask, sig) / np.maximum(ndimage.gaussian_filter(clean_mask, sig), 0.05)
                ch_arr -= broad_asym * clean_mask

            # Remove only mild ultra-broad vertical lighting tilt while preserving broad cheekbones,
            # forehead centre, brow arch, nose bridge, chin, and lip highlights.
            w_keep = clean_mask * (1.0 - lips * 0.85)
            ultraL = ndimage.gaussian_filter(dL * w_keep, 105.0) / np.maximum(ndimage.gaussian_filter(w_keep, 105.0), 0.05)
            dL -= 0.32 * ultraL

            dL = ndimage.gaussian_filter(dL, 0.8)
            dRG = ndimage.gaussian_filter(dRG, 1.0)
            dYB = ndimage.gaussian_filter(dYB, 1.0)
            local_med = ndimage.gaussian_filter(dL, 6.0)
            spike = dL - local_med
            dL = local_med + np.where((spike < -0.15) & (non_lip > 0.5), -0.15 + 0.20 * (spike + 0.15), spike)

            dL -= np.median(dL[ref_ring])
            dRG -= np.median(dRG[ref_ring])
            dYB -= np.median(dYB[ref_ring])

            # Keep eye sockets awake and lips dimensional (preserve lower-lip highlight, soften dark centre).
            dL = np.where(dL < 0.0, dL * (1.0 - 0.36 * socket_w), dL)
            dL = np.where(dL < 0.0, dL * (1.0 - 0.28 * lip_w), dL)

            # Asymmetric scale preserves full positive highlight resolution in [128..248] alongside clean shadows.
            normL = np.where(dL >= 0.0, np.tanh(dL / 0.24), np.tanh(dL / 0.34))
            packed = np.empty((h, w, 3), dtype="u1")
            packed[:, :, 0] = np.rint(np.clip(128.0 + 120.0 * normL * clean_mask, 0, 255)).astype("u1")
            packed[:, :, 1] = np.rint(np.clip(128.0 + 120.0 * np.tanh(dRG / 0.19) * clean_mask, 0, 255)).astype("u1")
            packed[:, :, 2] = np.rint(np.clip(128.0 + 120.0 * np.tanh(dYB / 0.21) * clean_mask, 0, 255)).astype("u1")
            maps.append(encode(packed, quality=84))

    payload = {
        "encoding": "local-pigment-v2",
        "neutral": 128,
        "scales": {"lumPos": 0.28, "lumNeg": 0.34, "rg": 0.22, "yb": 0.22},
        "sources": SOURCES,
        "maps": maps,
    }
    Path(destination).write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    print("Packed", len(maps), "maps ->", Path(destination).stat().st_size, "bytes")


if __name__ == "__main__":
    pack(*sys.argv[1:])
