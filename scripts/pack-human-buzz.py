"""Extract the CC0 MakeHuman young_african_male close-cut scalp on the native UVs.

Usage: python scripts/pack-human-buzz.py SYSTEM_SKINS_ZIP OUTPUT_JSON
Requires numpy, scipy, opencv-python and Pillow.
"""
import argparse
import base64
import io
import json
import zipfile
import zlib

import cv2
import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt

import rocketbox_face_surface as native


def smoothstep(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def packed(array, dtype):
    return base64.b64encode(zlib.compress(array.astype(dtype).tobytes(), 9)).decode()


def pack(archive):
    points = native.smooth(native.evaluate())
    triangles, uv = native.smooth_topology()
    tip = points[:native.meta["bodyVertices"], 1].max()
    centres = points[triangles].mean(axis=1)
    x, y, z = centres.T
    angle = np.arctan2(x, z - .044)
    limit = tip - .151 + .065 * np.cos(angle)
    radius = (x / .07) ** 2 + ((z - .045) / .088) ** 2
    on_scalp = ((y > limit - .008) & (z > -.07)
                & ((radius > .4) | (y > tip - .048))
                & (uv.mean(axis=1)[:, 0] > .59))

    corners = native.unpack("subFaceUV", "<u4").reshape(-1, 3)[on_scalp]
    all_uv = native.unpack("subUV", "<u2").reshape(-1, 2) / 65535
    coords = all_uv[corners].copy()
    coords[:, :, 1] = 1 - coords[:, :, 1]
    pixels = (coords * 2048).round().astype("i")
    origin = np.maximum(0, pixels.min(axis=(0, 1)) - 4)
    width, height = np.minimum(2048, pixels.max(axis=(0, 1)) + 4) - origin
    mask = np.zeros((height, width), np.uint8)
    for face in pixels:
        cv2.fillConvexPoly(mask, face - origin, 255)

    with zipfile.ZipFile(archive) as source:
        name = next(n for n in source.namelist()
                    if n.startswith("skins/young_african_male/") and n.endswith(".png"))
        image = Image.open(io.BytesIO(source.read(name))).convert("RGB")
        image = image.resize((2048, 2048), Image.Resampling.LANCZOS)
    ox, oy = origin
    rgb = np.asarray(image, dtype="f")[oy:oy+height, ox:ox+width]
    red, green, blue = rgb.transpose(2, 0, 1)
    chroma = (red - green) / np.maximum(8, green)
    neighbourhood = cv2.GaussianBlur(chroma, (0, 0), 3.3)
    coverage = smoothstep((.49 - neighbourhood) / .18)
    tone = np.clip((78 - red) / 58, 0, 1)
    density = coverage * (1 - (1 - (.75*tone + .25*smoothstep((.46-chroma)/.41)))**1.65)
    density *= mask / 255
    luminance = .29*red + .57*green + .14*blue
    grain = np.clip((luminance - 18) / 30, -.42, .7)
    channels = np.stack([density, .5 + grain*.64], axis=2)

    inside = cv2.erode(mask, np.ones((5, 5), np.uint8)) > 0
    nearest = distance_transform_edt(~inside, return_distances=False, return_indices=True)
    channels = np.where(inside[:, :, None], channels, channels[nearest[0], nearest[1]])
    atlas = cv2.resize(channels, (512, 768), interpolation=cv2.INTER_AREA)
    covered = cv2.dilate((density > .012).astype("uint8"), np.ones((15, 15), np.uint8))

    def samples(point):
        coord = (point - origin).round().astype("i").clip([0, 0], [width-1, height-1])
        return covered[coord[:, 1], coord[:, 0]] > 0

    selected = samples(pixels.mean(axis=1))
    for corner in range(3):
        selected |= samples(pixels[:, corner])
    faces = triangles[on_scalp][selected]
    uv_faces = corners[selected]
    vertices, index = np.unique(np.stack([faces.ravel(), uv_faces.ravel()], axis=1),
                                axis=0, return_inverse=True)
    uv = all_uv[vertices[:, 1]].copy()
    uv[:, 1] = 1 - uv[:, 1]
    uv = np.clip((uv*2048 - origin) / [width, height], 0, 1)
    locations = (uv * [511, 767]).round().astype("i")
    return dict(source=name, size=[512, 768], pixels=packed(np.rint(atlas.clip(0, 1)*255), "u1"),
                vertices=packed(vertices[:, 0], "<u4"), uv=packed(np.rint(uv*65535), "<u2"),
                density=packed(np.rint(atlas[locations[:, 1], locations[:, 0], 0]*255), "u1"),
                indices=packed(index, "<u2"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive")
    parser.add_argument("output", type=argparse.FileType("w", encoding="utf8"))
    args = parser.parse_args()
    json.dump(pack(args.archive), args.output, separators=(",", ":"))
