"""Compile selected CC0 MakeHuman system garments as fitted surfaces and embedded WebP maps.

python scripts/pack-human-library.py SYSTEM_ASSET_FOLDER character-view/human-library-data.json
"""

import base64
import io
import json
import pathlib
import re
import sys
import zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from human_cutout import cutout


def encode(values, dtype):
    return base64.b64encode(
        zlib.compress(np.asarray(values, dtype=dtype).tobytes(), 9)
    ).decode()


def cloth_panels(uv, uv_indices, heights, corners, diffuse):
    """Find the sewn top and trousers from connected UV islands of a two-piece outfit."""
    parent = list(range(len(uv)))
    def root(v):
        while parent[v] != v:
            parent[v] = parent[parent[v]]
            v = parent[v]
        return v

    for i in range(0, len(uv_indices), 3):
        a, b, c = uv_indices[i:i+3]
        parent[root(b)] = root(a)
        parent[root(c)] = root(a)
    lowest = {}
    for t, v in zip(uv_indices, corners):
        island = root(t)
        lowest[island] = min(lowest.get(island, heights[v]), heights[v])
    # In these standing source garments only the trouser panels reach below the pelvis.
    size = diffuse.size
    pixels = [(round(u*(size[0]-1)), round((1-v)*(size[1]-1))) for u, v in uv]
    panel = Image.new("L", size)
    draw = ImageDraw.Draw(panel)
    for i in range(0, len(uv_indices), 3):
        face = uv_indices[i:i+3]
        draw.polygon([pixels[t] for t in face], fill=2 if lowest[root(face[0])] < 0 else 1)
    labels = np.asarray(panel)
    rgb = np.asarray(diffuse.convert("RGB"), dtype=np.float32) / 255
    light = (rgb.min(axis=2) + rgb.max(axis=2)) * 0.5
    levels = [round(float(np.median(light[labels == k])), 4) for k in (1, 2)]
    return {"panels": encode(np.asarray(panel.filter(ImageFilter.MaxFilter(3))), "u1"), "panelLevels": levels}


def pack(root, out):
    library = {}
    names = [
        "male_casualsuit05",
        "male_worksuit01",
        "female_elegantsuit01",
        "male_elegantsuit01",
        "shoes01",
        "shoes02",
        "short04",
        "bob01",
        "afro01",
        "braid01",
        "bob02",
        "ponytail01",
        "long01",
        "short03",
        "male_casualsuit01",
        "male_casualsuit03",
        "female_sportsuit01",
        "shoes05",
    ]
    for name in names:
        folder = next(root.rglob(name + ".mhclo")).parent
        lines = (folder / (name + ".mhclo")).read_text(encoding="utf8").splitlines()
        count = sum(
            l.startswith("v ")
            for l in (folder / (name + ".obj")).read_text().splitlines()
        )
        refs = []
        weights = []
        offsets = []
        hide = []
        for line in lines[lines.index("verts 0") + 1 :]:
            fields = line.split()
            if not fields or not fields[0].isdigit():
                continue
            if len(fields) == 1:
                fields = fields * 3 + [1, 0, 0, 0, 0, 0]
            if len(fields) != 9:
                raise ValueError(name + " has unsupported binding")
            refs.extend(map(int, fields[:3]))
            weights.extend(map(float, fields[3:6]))
            offsets.extend(float(x) * 0.1 for x in fields[6:9])
            if len(refs) == 3 * count:
                break
        assert len(refs) == 3 * count
        if "delete_verts" in lines:
            for line in lines[lines.index("delete_verts") + 1 :]:
                if not line.strip():
                    continue
                if not line.strip()[0].isdigit():
                    break
                for first, last in re.findall(r"(\d+)(?:\s*-\s*(\d+))?", line):
                    hide.extend(range(int(first), int(last or first) + 1))
        tex = []
        corners = []
        texcorners = []
        for line in (folder / (name + ".obj")).read_text().splitlines():
            f = line.split()
            if f[:1] == ["vt"]:
                tex.append(list(map(float, f[1:3])))
            if f[:1] == ["f"]:
                poly = [x.split("/") for x in f[1:]]
                for j in range(1, len(poly) - 1):
                    for v in [poly[0], poly[j], poly[j + 1]]:
                        corners.append(int(v[0]) - 1)
                        texcorners.append(int(v[1]) - 1)
        im = Image.open(next(folder.glob("*diffuse.png"))).convert("RGBA")
        hair = folder.parent.name == "hair"
        trim = cutout(corners, texcorners, tex, im, encode) if hair else {}
        if hair:
            # Preserve directional values under an art-directed hair tint.
            gray = np.asarray(im.convert("L"), dtype=float)
            ref = max(
                22, float(np.quantile(gray[np.asarray(im.getchannel("A")) > 128], 0.85))
            )
            tone = Image.fromarray(
                (np.clip(gray / ref, 0.12, 1.4) * 172).astype("uint8")
            )
            im = Image.merge("RGBA", (tone, tone, tone, im.getchannel("A")))
        im.thumbnail((768, 768), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="WEBP", quality=84, method=6)
        surface = {}
        for suffix, field in [("_normal.png", "normal"), ("_ao.png", "occlusion")]:
            file = next(folder.glob("*" + suffix), None)
            if file is None or hair:
                continue
            detail = Image.open(file).convert("RGB" if field == "normal" else "L")
            detail.thumbnail((768, 768), Image.Resampling.LANCZOS)
            encoded = io.BytesIO()
            detail.save(encoded, format="WEBP", quality=94, method=6)
            surface[field] = "data:image/webp;base64," + base64.b64encode(encoded.getvalue()).decode()
        if name in {"male_casualsuit01", "male_casualsuit03", "female_sportsuit01"}:
            heights = [float(line.split()[2]) for line in (folder / (name + ".obj")).read_text().splitlines() if line.startswith("v ")]
            surface.update(cloth_panels(tex, texcorners, heights, corners, im))
        library[name] = dict(
            **trim,
            **surface,
            refs=encode(refs, "<u2"),
            weights=encode(weights, "<f4"),
            offsets=encode(offsets, "<f4"),
            uv=encode(np.rint(np.array(tex) * 65535).clip(0, 65535), "<u2"),
            corners=encode(corners, "<u2"),
            uvCorners=encode(texcorners, "<u2"),
            hide=encode(hide, "<u2"),
            texture="data:image/webp;base64,"
            + base64.b64encode(buf.getvalue()).decode(),
        )
    out.write_text(json.dumps(library, separators=(",", ":")) + "\n")
    print(out.stat().st_size, "bytes")


if __name__ == "__main__":
    pack(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]))
