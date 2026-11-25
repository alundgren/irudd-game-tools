"""Register Lee Perry-Smith's CC BY 3.0 colour, tangent and specular scans."""

import argparse
import base64
import io
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy.interpolate import RBFInterpolator

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source", type=Path)
parser.add_argument("destination", type=Path)
args = parser.parse_args()

# Coordinates on the upright native face and donor charts, in a 512-square preview.
pairs = np.asarray(
    [
        [256, 60, 256, 44],
        [256, 120, 256, 79],
        [168, 128, 195, 100],
        [354, 128, 316, 100],
        [128, 180, 161, 144],
        [384, 180, 352, 144],
        [155, 251, 171, 185],
        [357, 251, 341, 185],
        [170, 187, 201, 136],
        [195, 178, 218, 129],
        [222, 187, 245, 136],
        [290, 187, 267, 136],
        [315, 178, 295, 129],
        [343, 187, 311, 137],
        [166, 214, 199, 155],
        [192, 207, 220, 151],
        [216, 215, 237, 155],
        [296, 215, 275, 155],
        [318, 207, 293, 151],
        [343, 214, 312, 155],
        [256, 216, 256, 154],
        [256, 262, 256, 193],
        [235, 277, 239, 203],
        [277, 277, 274, 203],
        [241, 289, 247, 214],
        [271, 289, 267, 214],
        [256, 298, 256, 216],
        [224, 349, 226, 240],
        [240, 331, 242, 233],
        [256, 335, 256, 235],
        [272, 331, 271, 233],
        [288, 349, 285, 240],
        [256, 367, 256, 248],
        [256, 428, 256, 304],
        [202, 396, 209, 277],
        [310, 396, 302, 277],
        [156, 335, 176, 239],
        [356, 335, 336, 239],
        [117, 230, 147, 173],
        [395, 230, 366, 173],
        [169, 420, 190, 306],
        [343, 420, 321, 306],
    ],
    dtype=float,
)
width, height = 541, 591
yy, xx = np.mgrid[:height, :width]
u, v = (1 - (yy + 0.5) / height) * 512, (xx + 0.5) / width * 512
r, c = np.mgrid[0:1:129j, 0:1:129j]
warp = RBFInterpolator(
    pairs[:, :2], pairs[:, 2:], kernel="thin_plate_spline", smoothing=0.5
)
field = warp(np.column_stack(((1 - r.ravel()) * 512, c.ravel() * 512))).reshape(
    129, 129, 2
)
grid = cv2.resize(field, (width, height), interpolation=cv2.INTER_CUBIC).astype("f") * 2


def read(name):
    return np.asarray(Image.open(args.source / name).convert("RGB"), dtype=np.float32)


def sample(image):
    return cv2.remap(
        image, grid, None, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
    )


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def ellipse(x, y, rx, ry):
    return np.hypot((u - x) / rx, (v - y) / ry)


mask = 1 - smooth((ellipse(256, 266, 162, 202) - 0.80) / 0.2)
for x, y, rx, ry in [
    (191, 211, 35, 14),
    (319, 211, 35, 14),
    (194, 180, 41, 15),
    (317, 180, 41, 15),
    (256, 348, 41, 22),
    (241, 289, 11, 8),
    (271, 289, 11, 8),
]:
    mask *= smooth((ellipse(x, y, rx, ry) - 0.78) / 0.55)


def png(array, format):
    buf = io.BytesIO()
    image = Image.fromarray(np.uint8(np.clip(np.rint(array), 0, 255)))
    image.save(
        buf, format, **({"quality": 97, "method": 6} if format == "WEBP" else {})
    )
    return (
        "data:image/"
        + format.lower()
        + ";base64,"
        + base64.b64encode(buf.getvalue()).decode()
    )


# Express the measured reflectance relative to clean skin on this face. Shaving
# grain and colour around the nose remain. The stored neutral recovers every skin tone.
color = np.log(sample(read("Map-COL.jpg")) + 1.0)
base = np.median(
    color[(ellipse(190, 265, 15, 17) < 1) | (ellipse(322, 265, 15, 17) < 1)], axis=0
)
color = (color - base) * mask[:, :, None]
# Integrate the tangent normal into a height field so its axes follow the new
# UV chart. Discard broad displacement that the editable head already supplies.
normal = read("Infinite-Level_02_Tangent_SmoothUV.jpg") / 127.5 - 1
dx = -normal[:, :, 0] / np.maximum(normal[:, :, 2], 0.1)
dy = normal[:, :, 1] / np.maximum(normal[:, :, 2], 0.1)
fy, fx = np.meshgrid(
    np.fft.fftfreq(dx.shape[0]) * 2 * np.pi,
    np.fft.fftfreq(dx.shape[1]) * 2 * np.pi,
    indexing="ij",
)
denom = fx * fx + fy * fy
denom[0, 0] = 1
surface = np.fft.ifft2(
    (-1j * fx * np.fft.fft2(dx) - 1j * fy * np.fft.fft2(dy)) / denom
).real
band = surface - cv2.GaussianBlur(surface, (0, 0), 11)
relief = sample(band.astype("f")) * mask
shine = sample(read("Map-SPEC.jpg").mean(axis=2))
reference = np.median(shine[ellipse(190, 266, 14, 16) < 1])
packed = np.stack(
    (128 + relief * 120, 128 + (shine - reference) * mask, 255 * mask), axis=2
)
data = {
    "credit": "Infinite, 3D Head Scan by Lee Perry-Smith, based on work at triplegangers.com",
    "license": "https://creativecommons.org/licenses/by/3.0/",
    "source": "https://threejs.org/examples/models/gltf/LeePerrySmith/",
    "colour": png(128 + 340 * color, "WEBP"),
    "surface": png(packed, "WEBP"),
}
args.destination.write_text(json.dumps(data, separators=(",", ":")), encoding="utf8")
