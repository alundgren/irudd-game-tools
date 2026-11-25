"""Reduce soft scan lighting and store the measured brow density separately for brow edits."""

import base64, io, json
import numpy as np
import cv2
from PIL import Image
from inputs import CACHE as root

src = root / "captured-family-data.json"
raw = root / "captured-raw-skin.json"


def decode(uri):
    return np.array(
        Image.open(io.BytesIO(base64.b64decode(uri.split(",")[1]))).convert("RGB")
    )


def encoded(a):
    o = io.BytesIO()
    Image.fromarray(a.round().clip(0, 255).astype("uint8")).save(
        o, "WEBP", quality=97, method=4
    )
    return "data:image/webp;base64," + base64.b64encode(o.getvalue()).decode()


def filtered(a, w, sd):
    return cv2.GaussianBlur(a * w, (0, 0), sd) / np.maximum(
        0.001, cv2.GaussianBlur(w, (0, 0), sd)
    )


out = {}
for key, donor in json.loads(raw.read_bytes()).items():
    material = decode(donor["surface"]).astype("f")
    ratio = (decode(donor["paint"]).astype("f") - 128) / 51
    m = np.load(root / (donor["source"] + "-registration.npz"))
    xy = (m["native"] - m["reference_origin"]) @ m["native_axes"].T / 0.135
    sx = (1 + xy[:, :, 0]) * 512 - 0.5
    sy = (1 - xy[:, :, 1]) * 512 - 0.5
    marks = m["native_marks"]
    sheet = np.zeros((1024, 1024), np.uint8)
    for brow in [
        [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
        [336, 296, 334, 293, 300, 276, 283, 282, 295, 285],
    ]:
        cv2.fillConvexPoly(sheet, cv2.convexHull(marks[brow].round().astype("i")), 255)
    reg = cv2.dilate(sheet, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25)))
    mask = cv2.remap(reg, sx.astype("f"), sy.astype("f"), cv2.INTER_LINEAR) / 255.0
    mask = cv2.GaussianBlur(mask.astype("f"), (0, 0), 1.8)
    lum = ratio @ np.array([0.26, 0.59, 0.15], dtype="f")
    area = material[:, :, 2] / 255
    # The largest changes in light across an entire cheek/forehead belong to the capture studio.
    light = filtered(lum, area * (1 - mask), 32)
    cen = np.median(light[area > 0.95])
    ratio -= 0.48 * (light - cen).clip(-0.72, 0.72)[:, :, None] * area[:, :, None]
    local = filtered(lum, (1 - mask) ** 4 * area, 8.0)
    ink = (local - lum).clip(0, 2.4) * mask
    material[:, :, 1] = ink * 102
    out[key] = {
        "source": donor["source"],
        "brows": key != "HSR0027",
        "paint": encoded(128 + 51 * ratio),
        "surface": encoded(material),
    }
src.write_text(json.dumps(out, separators=(",", ":")))
