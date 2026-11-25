"""Pack the original Microsoft Rocketbox normal and specular maps for the cast.

Pass the pinned Microsoft-Rocketbox checkout (or Assets/Avatars) as the first
argument. The optional output path defaults to the character-view runtime data.
Reads TGA sources with Pillow. The reference revision is recorded in the output.
"""
import argparse
import base64
import json
from pathlib import Path
import zlib

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
REVISION = "0943055db6ec570bcef9f2c8b41c9e5467c808f9"
SIZE = 384


def pack_region(folder, region):
    dims = (SIZE // 2, SIZE if region == "body" else SIZE // 2)

    def image(kind, mode):
        paths = list(folder.glob(f"*_{region}_{kind}.tga"))
        if len(paths) != 1:
            raise ValueError(f"Expected one {region} {kind} map in {folder}, found {len(paths)}")
        with Image.open(paths[0]) as src:
            return np.asarray(src.convert(mode).resize(dims, Image.Resampling.LANCZOS), dtype=float)

    normals = image("normal", "RGB")
    specular = image("specular", "L")
    slopes = np.clip(np.round((normals[:, :, :2] - 128) / 2), -64, 63).astype("i1")
    intensity = np.clip(np.round(specular / 2), 0, 127).astype("uint8")
    samples = np.dstack([slopes.view("uint8"), intensity])
    return base64.b64encode(zlib.compress(samples.tobytes(), 9)).decode("ascii")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkout", type=Path)
    parser.add_argument("--output", type=Path, default=ROOT / "character-view/human-cast-surface-data.json")
    args = parser.parse_args()
    art = ROOT / "character-view"
    people = json.loads((art / "human-cast-catalog.json").read_bytes())["people"]
    pieces = json.loads((art / "human-cast-wardrobe-data.json").read_bytes())["pieces"]
    heads = {p["subject"] for p in people.values()}
    subjects = heads | {p["subject"] for p in pieces.values()}
    avatars = args.checkout / "Assets" / "Avatars"
    if not avatars.is_dir():
        avatars = args.checkout
    maps = {}
    for subject in sorted(subjects):
        textures = avatars / subject / "Textures"
        regions = ("body", "head") if subject in heads else ("body",)
        maps[subject] = {region: pack_region(textures, region) for region in regions}
    args.output.write_text(json.dumps({"sourceRevision": REVISION, "size": SIZE, "subjects": maps}, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
