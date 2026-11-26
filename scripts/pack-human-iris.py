"""Pack a polar stroma map of each CC0 MakeHuman iris. Relative contrast only.

Usage: python scripts/pack-human-iris.py SYSTEM_ZIP DESTINATION_JSON
"""
import base64
import io
import json
from pathlib import Path
import sys
import zipfile
import zlib

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates


def pack(archive, destination):
    width, height = 192, 72
    maps = []
    with zipfile.ZipFile(archive) as assets:
        for colour in ["bluegreen", "brownlight", "grey"]:
            stem = "eyes/materials/" + colour
            if b"explicitly released as CC0" not in assets.read(stem + ".mhmat"):
                raise ValueError("Missing CC0 statement for " + colour)
            im = Image.open(io.BytesIO(assets.read(stem + "_eye.png"))).convert("RGB")
            light = np.asarray(im).astype(float) @ [.22, .67, .11]
            yy, xx = np.indices(light.shape)
            pupil = (light < 22) & ((xx-722)**2+(yy-304)**2 < 39**2)
            cy, cx = yy[pupil].mean(), xx[pupil].mean()
            angle = np.arange(width)*2*np.pi/width
            def annulus(radii):
                r = radii[:, None]
                return map_coordinates(light, [cy+r*np.sin(angle), cx+r*np.cos(angle)], order=1)
            rings = annulus(np.arange(150))
            radius = 101 + np.argmax(np.gradient(gaussian_filter(rings.mean(axis=1), 1.6))[101:135])
            tile = np.log(18 + annulus(np.linspace(.31, 1, height)*radius))
            local = tile - np.median(tile, axis=1, keepdims=True)
            local -= gaussian_filter(local, (13, 21), mode=("nearest","wrap"))
            signed = np.uint8(np.clip(128 + 110*np.tanh(local/.42), 0, 255))
            maps.append(base64.b64encode(zlib.compress(signed.tobytes(), 9)).decode())
    Path(destination).write_text(json.dumps(dict(width=width, height=height, maps=maps), separators=(",", ":"))+"\n")


if __name__ == "__main__":
    pack(*sys.argv[1:])
