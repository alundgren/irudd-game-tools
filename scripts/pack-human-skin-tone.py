"""Pack local body skin tone from the CC0 MakeHuman system skins, per vertex of the smoothed human surface.

Each skin is read in linear light and compared with the skin around it, inside its own UV
island, which removes the pigment and any broad painted shading and leaves what belongs to the
place: knuckle creases, nails, the navel, areolae, the folds of a palm. The median over all
skins drops one person's hair and blemishes. Two signed bytes are stored per vertex of the
surface, 128 for skin that matches its surroundings: darker or lighter, and more or less red.
A vertex on a seam of the layout takes the mean of its coordinates, so the tone has no seams.

The skins are CC0 (MakeHuman community system assets). Run pack-human.py first.

Usage: python scripts/pack-human-skin-tone.py SYSTEM character-view/human-data.json character-view/human-skin-tone-data.json [preview.png]
"""
import base64
import io
import json
import pathlib
import sys
import zipfile
import zlib

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

SIZE = 1024
TONE_RANGE, WARM_RANGE = 0.5, 0.3


def skins(library):
    """Every plain CC0 skin, from a directory of skins or the downloaded archive."""
    if library.is_file():
        with zipfile.ZipFile(library) as zf:
            for name in sorted(n for n in zf.namelist() if n.startswith("skins/") and n.endswith(".png") and "suit" not in n):
                yield name, Image.open(io.BytesIO(zf.read(name))).convert("RGB")
    else:
        for path in sorted((library / "skins").glob("*/*.png")):
            if "suit" not in path.name:
                yield path.name, Image.open(path).convert("RGB")


def unpack(packet, key, dtype):
    return np.frombuffer(zlib.decompress(base64.b64decode(packet[key])), dtype=dtype)


def main(library, human, destination, preview=None):
    packet = json.loads(pathlib.Path(human).read_text())["packet"]
    uv = unpack(packet, "subUV", "<u2").reshape(-1, 2) / 65535
    faces = unpack(packet, "subFaceUV", "<u4").reshape(-1, 3)
    points = np.stack([uv[:, 0] * SIZE, (1 - uv[:, 1]) * SIZE], axis=1)
    cover = Image.new("L", (SIZE, SIZE), 0)
    draw = ImageDraw.Draw(cover)
    for a, b, c in faces:
        draw.polygon([tuple(points[a]), tuple(points[b]), tuple(points[c])], fill=255)
    # The paint of a skin stops short of the border of an island. Read a little inside it.
    inside = ndimage.binary_erosion(np.asarray(cover) > 127, iterations=3).astype(float)
    corners = unpack(packet, "subIndices", "<u4")

    def around(values, sigma):
        weight = ndimage.gaussian_filter(inside, sigma)
        return ndimage.gaussian_filter(values * inside, sigma) / np.maximum(weight, 1e-4)

    tones, warms = [], []
    for name, image in skins(pathlib.Path(library)):
        rgb = np.asarray(image.resize((SIZE, SIZE), Image.Resampling.LANCZOS), dtype=float) / 255
        rgb = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
        light = np.log(rgb @ np.array([0.2126, 0.7152, 0.0722]) + 0.004)
        red = np.log((rgb[..., 0] + 0.004) / (rgb[..., 1] + 0.004))
        tones.append(around(light, 2.2) - around(light, 14))
        warms.append(around(red, 2.6) - around(red, 14))
        print("read", name, flush=True)
    tone = np.median(tones, axis=0)
    warm = np.median(warms, axis=0)
    x = np.clip(np.rint(points[:, 0] - 0.5), 0, SIZE - 1).astype(int)
    y = np.clip(np.rint(points[:, 1] - 0.5), 0, SIZE - 1).astype(int)
    count = int(corners.max()) + 1
    uses = np.bincount(corners, minlength=count)
    mean = lambda field: np.bincount(corners, weights=field[y, x][faces.reshape(-1)], minlength=count) / np.maximum(uses, 1)
    packed = np.stack([
        np.rint(128 + 127 * np.clip(mean(tone) / TONE_RANGE, -1, 1)),
        np.rint(128 + 127 * np.clip(mean(warm) / WARM_RANGE, -1, 1)),
    ], axis=1).astype("u1")
    out = {
        "source": "MakeHuman community system skins, CC0",
        "skins": len(tones),
        "encoding": {"name": "signed-local-tone", "neutral": 128, "toneRange": TONE_RANGE, "warmRange": WARM_RANGE},
        "count": count,
        "tone": base64.b64encode(zlib.compress(packed.tobytes(), 9)).decode(),
    }
    pathlib.Path(destination).write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print("vertices", count, "bytes", len(out["tone"]), "tone std", packed[:, 0].std().round(2), "warm std", packed[:, 1].std().round(2))
    if preview:
        tone, warm = tone * (cover_array := np.asarray(cover) / 255), warm * (np.asarray(cover) / 255)
        show = np.stack([128 + 127 * np.clip(warm / WARM_RANGE, -1, 1), 128 + 127 * np.clip(tone / TONE_RANGE, -1, 1), 128 + 127 * np.clip(tone / TONE_RANGE, -1, 1)], axis=2)
        Image.fromarray(show.astype("u1")).save(preview)


if __name__ == "__main__":
    main(*sys.argv[1:])
