"""Pack local colour variation from the original generated runner portrait.

Pass its unscaled 887-pixel frontal view and the destination JSON path.
The output contains no facial features, skin swatch, or broad lighting.
"""
import argparse
import base64
import json
import zlib
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

parser = argparse.ArgumentParser()
parser.add_argument("front", type=Path)
parser.add_argument("output", type=Path)
args = parser.parse_args()
image = Image.open(args.front).convert("RGB")
if image.size != (887, 887):
    parser.error("Use the unscaled 887 by 887 frontal runner study.")
light = np.asarray(image.filter(ImageFilter.GaussianBlur(10)), dtype=float)
delta = np.log((np.asarray(image, dtype=float) + 4) / (light + 4))
size = 74
patches = []
for x, y in [(308, 415), (522, 427), (400, 199)]:
    patch = delta[y:y + size, x:x + size]
    centred = patch - patch.mean(axis=(0, 1))
    values = np.clip(np.rint(128 + 535 * centred), 0, 255).astype("uint8")
    patches.append(base64.b64encode(zlib.compress(values.tobytes(), 9)).decode())
data = {"size": size, "patches": patches}
args.output.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
