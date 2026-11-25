"""Pack registered body relief from the CC0 MakeHuman Skins 02 pack.

Usage: python scripts/pack-human-body-relief.py EXTRACTED_PACK character-view/human-body-relief.json
The same hm08 UVs that drive body pigment carry the fold normals on hands,
elbows, shoulders and legs. The head and shared jaw boundary stay neutral.
"""
import base64
import io
import json
import sys
import zlib
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

SIZE = 768


def body_mask(human):
    packet = human["packet"]
    def unpack(key, dtype):
        return np.frombuffer(zlib.decompress(base64.b64decode(packet[key])), dtype=dtype)
    uv = unpack("subUV", "<u2").reshape(-1, 2) / 65535
    points = np.column_stack([uv[:, 0], 1 - uv[:, 1]]) * SIZE
    tex = unpack("subFaceUV", "<u4").reshape(-1, 3)
    faces = unpack("subIndices", "<u4").reshape(-1, 3)
    joints = unpack("subBones", "u1").reshape(-1, 4)
    weights = unpack("subWeights", "<u2").reshape(-1, 4) / 65535
    names = human["meta"]["names"]
    allow = np.array([not name.startswith(("head", "neck", "pelvis")) for name in names])
    strength = np.sum(allow[joints] * weights, axis=1)
    image = Image.new("L", (SIZE, SIZE))
    pen = ImageDraw.Draw(image)
    for corners, opacity in zip(tex, strength[faces].min(axis=1)):
        if opacity < .04:
            continue
        pen.polygon([tuple(v) for v in points[corners]], fill=round(255*opacity))
    # Filtering near a UV seam must sample a flat tangent vector on either side.
    return ndimage.gaussian_filter(ndimage.minimum_filter(np.asarray(image) / 255., size=5), 2.)


def pack(source, destination):
    src, dst = Path(source), Path(destination)
    name = "mindfront_skin_male_african_middleage"
    credit = json.loads((src / "packs/skins02.json").read_bytes())[name]
    if credit["license"] != "CC0":
        raise ValueError("Unsupported grant for " + name)
    mask = body_mask(json.loads((dst.parent / "human-data.json").read_bytes()))
    folder = src / "skins" / name
    def pixels(suffix):
        im = Image.open(next(folder.glob(suffix))).convert("RGB")
        return np.asarray(im.resize((SIZE, SIZE), Image.Resampling.LANCZOS)) / 255
    n = 2 * pixels("*_NRM.png") - 1
    slope = n[..., :2] / np.maximum(.5, n[..., 2:3])
    # Remove the donor's broad body shape. Small folds stay where a joint bends.
    slope -= ndimage.gaussian_filter(slope, (8, 8, 0))
    slope *= mask[..., None] * .94
    vec = np.dstack([slope, np.ones_like(mask)])
    vec /= np.linalg.norm(vec, axis=-1, keepdims=True)
    normal = np.rint(127.5 + 127.5*vec).astype("u1")
    spec = pixels("*_SPEC.png")[..., 0]
    spec = np.maximum(0, spec - ndimage.gaussian_filter(spec, 13))
    rough = np.rint(255*(1 - mask*np.clip(spec*.85, 0, .26))).astype("u1")
    def encoded(values):
        texture = io.BytesIO()
        Image.fromarray(values).save(texture, format="WEBP", lossless=True, method=5)
        return "data:image/webp;base64," + base64.b64encode(texture.getvalue()).decode()
    record = {"asset": name, "author": credit["author"], "license": credit["license"],
              "normal": encoded(normal), "roughness": encoded(rough)}
    dst.write_text(json.dumps(record, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    pack(*sys.argv[1:])
