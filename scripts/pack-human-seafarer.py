"""Bake the registered Einar weathering and scars as a signed skin-colour field.

Input: original Einar v1 colour map. Requires NumPy, Pillow, SciPy and OpenCV.
The face, eyes and mouth remain on the editable adult topology.
"""

import json, base64, io
from pathlib import Path
import cv2, numpy as np
from PIL import Image
from scipy.interpolate import RBFInterpolator

import argparse

parser = argparse.ArgumentParser(
    description="Register the artist-painted Einar complexion to the editable adult head."
)
parser.add_argument(
    "albedo", type=Path, help="Einar's original 4096-pixel einar_skin.albedo.tif"
)
parser.add_argument(
    "--output", type=Path, default=Path("character-view/human-seafarer-data.json")
)
args = parser.parse_args()
pairs = [
    (256, 84, 256, 37),
    (160, 125, 126, 92),
    (356, 125, 387, 92),
    (128, 177, 85, 155),
    (384, 177, 423, 155),
    (166, 188, 157, 176),
    (202, 177, 194, 167),
    (224, 187, 216, 177),
    (288, 187, 296, 177),
    (312, 177, 321, 167),
    (343, 188, 355, 176),
    (172, 209, 161, 219),
    (191, 210, 187, 215),
    (217, 215, 212, 221),
    (292, 215, 296, 221),
    (316, 212, 319, 215),
    (339, 210, 345, 219),
    (255, 219, 255, 215),
    (237, 268, 226, 275),
    (254, 268, 254, 276),
    (276, 269, 281, 275),
    (239, 288, 240, 299),
    (270, 288, 269, 299),
    (256, 296, 256, 309),
    (219, 350, 215, 354),
    (237, 331, 237, 344),
    (256, 334, 255, 345),
    (275, 331, 274, 344),
    (292, 350, 293, 354),
    (255, 366, 255, 370),
    (146, 264, 111, 257),
    (361, 265, 402, 257),
    (144, 329, 112, 323),
    (366, 329, 402, 323),
    (187, 390, 159, 398),
    (326, 391, 350, 398),
    (256, 431, 256, 441),
    (125, 230, 78, 222),
    (389, 232, 435, 223),
]
m = np.asarray(pairs, dtype=float)
warp = RBFInterpolator(m[:, :2], m[:, 2:], kernel="thin_plate_spline", smoothing=2)
h, w = 591, 541
yy, xx = np.mgrid[:h, :w]
u = (1 - (yy + 0.5) / h) * 512
v = (xx + 0.5) / w * 512
a, b = np.mgrid[0:1:97j, 0:1:97j]
coarse = np.column_stack(((1 - a.flatten()) * 512, b.flatten() * 512))
field = warp(coarse).reshape(97, 97, 2)
field = cv2.resize(field, (w, h), interpolation=cv2.INTER_CUBIC)
im = np.asarray(Image.open(args.albedo).convert("RGB"))
if im.shape != (4096, 4096, 3):
    parser.error("Expected the 4096-pixel Einar colour map.")
grid = field.astype("f")
grid[:, :, 0] = 820 + grid[:, :, 0] * 2460 / 512
grid[:, :, 1] = 5 + grid[:, :, 1] * 2215 / 512
rgb = cv2.remap(
    im, grid, None, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
).astype(float)
log = np.log(rgb + 1)
l = log - cv2.GaussianBlur(log, (0, 0), 27)
swatch = np.median(log[(u > 137) & (u < 164) & (v > 250) & (v < 289)], axis=0)
l = 0.65 * l + 0.35 * (log - swatch)


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


mask = 1 - smooth((np.hypot((u - 255) / 156, (v - 273) / 180) - 0.77) / 0.21)
for x, y, sx, sy in [
    (192, 213, 29, 12),
    (317, 213, 29, 12),
    (255, 348, 38, 23),
    (241, 288, 10, 7),
    (271, 288, 10, 7),
]:
    mask *= smooth((np.hypot((u - x) / sx, (v - y) / sy) - 0.65) / 0.72)
encoded = np.uint8(np.clip(np.rint(128 + 320 * l * mask[:, :, None]), 0, 255))
data = io.BytesIO()
Image.fromarray(encoded).save(data, "WEBP", quality=95, method=6)
credit = "Einar Rig (CC-BY) Blender Foundation | studio.blender.org"
args.output.write_text(
    json.dumps(
        {
            "source": "https://studio.blender.org/characters/einar/v1/",
            "credit": credit,
            "license": "https://creativecommons.org/licenses/by/4.0/",
            "url": "data:image/webp;base64,"
            + base64.b64encode(data.getvalue()).decode(),
        },
        separators=(",", ":"),
    )
)
