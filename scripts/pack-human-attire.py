"""Compile CC0 MakeHuman community costumes as fitted surfaces with embedded WebP maps.

python scripts/pack-human-attire.py PACK_FOLDER [PACK_FOLDER ...] character-view/human-attire-data.json

Each PACK_FOLDER holds unpacked official `*_cc0.zip` asset packs (suits02, dress01, skirts01, shirts01),
or only the folders named below with the `packs/*.json` index of each pack.
Each garment keeps its authored fit to the hm08 body, its seams and its painted cloth. The packer adds what
a game needs and the sources lack: colour carried past every UV seam, a chart of which texels take which dye,
relief and a roughness and metal map drawn from the painted surface, and the skin the garment covers.
"""

import base64
import io
import json
import pathlib
import re
import subprocess
import sys
import zlib

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

Image.MAX_IMAGE_PIXELS = None

GARMENTS = {
    "viking_tunic": dict(
        folder="rehmanpolanski_viking_tunic", clo="rehmanpolanski_viking_tunic.mhclo", diffuse="TUNIC_Viking.png",
        size=1024, cover=True,
    ),
    "viking_pants": dict(
        folder="rehmanpolanski_viking_pants", clo="rehmanpolanski_viking_pants.mhclo", diffuse="PantsViking.png",
        size=512, cover=True,
    ),
    "viking_boots": dict(
        folder="rehmanpolanski_viking_boots", clo="rehmanpolanski_viking_boots.mhclo", diffuse="BootsViking.png",
        size=512, cover=True,
    ),
    "monk_robe": dict(
        folder="donitz_monk_robe", clo="donitz_monk_robe.mhclo", diffuse="robe_brown__diffuse.png",
        normal="robe__normal_gl.png", size=1024,
    ),
    "shift_dress": dict(
        folder="toigo_shift_dress", clo="toigo_shift_dress.mhclo", diffuse="ShiftDress.png", size=1024, weave=3.0,
    ),
    "full_skirt": dict(
        folder="toigo_long_full_skirt", clo="toigo_long_full_skirt.mhclo", diffuse="skirtFullLong.png", size=1024,
        under=[0.085, 0.125, 0.2],
    ),
    "rib_sweater": dict(
        folder="toigo_fisherman_sweater", clo="toigo_fisherman_sweater.mhclo", diffuse="shirt-knit.png",
        normal="shirt-knit-NORM.png", size=1024, cover=True,
    ),
}


def encode(values, dtype):
    return base64.b64encode(zlib.compress(np.asarray(values, dtype=dtype).tobytes(), 9)).decode()


def webp(image, quality):
    out = io.BytesIO()
    image.save(out, format="WEBP", quality=quality, method=6)
    return "data:image/webp;base64," + base64.b64encode(out.getvalue()).decode()


def read_fit(path, count):
    """The hm08 anchors, weights and offsets (in metres) of each garment vertex, and the skin its author hid."""
    lines = path.read_text(encoding="utf8", errors="replace").splitlines()
    header = [l for l in lines[:lines.index("verts 0")] if l.startswith("#")]
    licence = next((l for l in header if re.match(r"#\s*license:?\s", l)), None) or next((l for l in header if re.search(r"\bCC0\b", l)), "")
    if not re.search(r"\bCC0\b", licence) or any(re.search(r"GPL|CC.BY|NonCommercial", l) for l in header):
        raise ValueError(path.name + " is not marked CC0")
    refs, weights, offsets, hide = [], [], [], []
    for line in lines[lines.index("verts 0") + 1:]:
        fields = line.split()
        if not fields or not fields[0].isdigit():
            continue
        if len(fields) == 1:
            fields = fields * 3 + [1, 0, 0, 0, 0, 0]
        if len(fields) != 9:
            raise ValueError(path.name + " has an unsupported binding")
        refs.extend(map(int, fields[:3]))
        weights.extend(map(float, fields[3:6]))
        offsets.extend(float(x) * 0.1 for x in fields[6:9])
        if len(refs) == 3 * count:
            break
    assert len(refs) == 3 * count, path.name
    if "delete_verts" in lines:
        for line in lines[lines.index("delete_verts") + 1:]:
            if not line.strip():
                continue
            if not line.strip()[0].isdigit():
                break
            for first, last in re.findall(r"(\d+)(?:\s*-\s*(\d+))?", line):
                hide.extend(range(int(first), int(last or first) + 1))
    obj = next(l.split()[1] for l in lines if l.startswith("obj_file"))
    return refs, weights, offsets, hide, obj


def read_mesh(path):
    rest, tex, corners, texcorners = [], [], [], []
    for line in path.read_text().splitlines():
        f = line.split()
        if f[:1] == ["v"]:
            rest.extend(float(x) * 0.1 for x in f[1:4])
        elif f[:1] == ["vt"]:
            tex.append([float(f[1]), float(f[2])])
        elif f[:1] == ["f"]:
            poly = [x.split("/") for x in f[1:]]
            for j in range(1, len(poly) - 1):
                for v in (poly[0], poly[j], poly[j + 1]):
                    corners.append(int(v[0]) - 1)
                    texcorners.append(int(v[1]) - 1)
    return rest, np.array(tex), corners, texcorners


def islands(tex, texcorners, size):
    """Each texel's UV island, numbered from 1 by falling size, and 0 where no cloth is painted."""
    parent = list(range(len(tex)))

    def root(v):
        while parent[v] != v:
            parent[v] = parent[parent[v]]
            v = parent[v]
        return v

    for i in range(0, len(texcorners), 3):
        a, b, c = texcorners[i:i + 3]
        parent[root(b)] = root(a)
        parent[root(c)] = root(a)
    sizes = {}
    for t in texcorners:
        sizes[root(t)] = sizes.get(root(t), 0) + 1
    rank = {k: n + 1 for n, (k, _) in enumerate(sorted(sizes.items(), key=lambda item: (-item[1], item[0])))}
    chart = Image.new("L", size)
    draw = ImageDraw.Draw(chart)
    pixel = [(float(u) * (size[0] - 1), (1 - float(v)) * (size[1] - 1)) for u, v in tex]
    for i in range(0, len(texcorners), 3):
        face = texcorners[i:i + 3]
        label = rank[root(face[0])]
        draw.polygon([pixel[t] for t in face], fill=label, outline=label)
    return np.asarray(chart)


def colour_terms(rgb):
    high, low = rgb.max(axis=2), rgb.min(axis=2)
    light, span = (high + low) / 2, high - low
    sat = np.where(span < 1e-4, 0, span / np.where(light < 0.5, high + low, 2 - high - low).clip(1e-4))
    return light, sat


def tunic_dye(chart, light, sat):
    body = (chart > 0) & ~np.isin(chart, (5, 8, 11))
    k = light.shape[0] / 2048
    bright = ndimage.gaussian_filter((light > 0.2).astype(np.float32), 9 * k)
    mail = ndimage.binary_closing(bright > 0.3, iterations=round(6 * k)) & body
    cloth = body & ~mail & (light < 0.24)
    return {"main": cloth, "leather": np.isin(chart, (5, 8, 11)) & (light < 0.6)}, {"mail": mail}


def pants_dye(chart, light, sat):
    return {"dark": chart > 0}, {}


def boots_dye(chart, light, sat):
    return {"leather": np.isin(chart, (1, 2)), "sole": np.isin(chart, (7, 8))}, {}


def robe_dye(chart, light, sat):
    return {"main": np.isin(chart, (1, 3, 4)), "dark": np.isin(chart, (2, 5))}, {}


def shift_dye(chart, light, sat):
    return {"main": np.isin(chart, (1, 2)), "dark": np.isin(chart, (3, 4, 5))}, {}


def skirt_dye(chart, light, sat):
    return {"dark": (chart > 0, dict(level=0.1, pale="light", **{"from": 0.2, "to": 0.5}))}, {}


def knit_dye(chart, light, sat):
    return {"main": chart > 0}, {}


DYES = {
    "viking_tunic": tunic_dye, "viking_pants": pants_dye, "viking_boots": boots_dye, "monk_robe": robe_dye,
    "shift_dress": shift_dye, "full_skirt": skirt_dye, "rib_sweater": knit_dye,
}
ROUGH = {"main": 0.9, "dark": 0.92, "leather": 0.62, "sole": 0.8}


def spread(rgb, painted):
    """Carry painted colour past the seams, so a smaller map never bleeds the page into the cloth."""
    at = ndimage.distance_transform_edt(~painted, return_distances=False, return_indices=True)
    return rgb[at[0], at[1]]


def relief(light, painted, strength):
    """A tangent normal map from the painted light and dark of a surface: rings, stitches and grain stand up."""
    fine = ndimage.gaussian_filter(light, 1.0) - ndimage.gaussian_filter(light, 7.0)
    fine = np.where(painted, fine, 0)
    dx = ndimage.sobel(fine, axis=1) * strength
    dy = ndimage.sobel(fine, axis=0) * strength
    n = np.dstack([-dx, dy, np.ones_like(dx)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return Image.fromarray(np.rint((n * 0.5 + 0.5) * 255).astype("uint8"), "RGB")


def credit(roots, folder):
    """Author, licence and page of one asset, from the index the pack ships with."""
    for index in sorted(p for root in roots for p in root.rglob("packs/*.json")):
        entry = json.loads(index.read_text(encoding="utf8")).get(folder)
        if not entry:
            continue
        if entry["license"] != "CC0":
            raise ValueError(folder + " is not CC0 in the pack index")
        return dict(author=entry["author"], licence="CC0 1.0", source=entry["source"], pack=index.stem + "_cc0")
    raise ValueError(folder + " is in no pack index")


def find(roots, name, folder=False):
    return next(p for root in roots for p in root.rglob(name) if p.is_dir() == folder)


def pack_one(name, spec, roots):
    folder = find(roots, spec["folder"], True)
    probe = (folder / spec["clo"]).read_text(encoding="utf8", errors="replace")
    obj = folder / next(l.split()[1] for l in probe.splitlines() if l.startswith("obj_file"))
    rest, tex, corners, texcorners = read_mesh(obj)
    count = len(rest) // 3
    refs, weights, offsets, hide, _ = read_fit(folder / spec["clo"], count)
    source = Image.open(find(roots, spec["diffuse"])).convert("RGB")
    chart = islands(tex, texcorners, source.size)
    painted = ndimage.binary_dilation(chart > 0, iterations=2)
    rgb = spread(np.asarray(source, dtype=np.float32) / 255, painted)
    light, sat = colour_terms(rgb)
    tones, extra = DYES[name](chart, light, sat)
    size = (spec["size"], spec["size"])

    def small(image, mode=Image.Resampling.LANCZOS):
        return image.resize(size, mode) if image.size != size else image

    diffuse = small(Image.fromarray(np.rint(rgb * 255).astype("uint8"), "RGB"))
    labels, rules = np.zeros(chart.shape, "uint8"), []
    for k, (tone, mask) in enumerate(list(tones.items()), 1):
        mask, own = mask if isinstance(mask, tuple) else (mask, {})
        tones[tone] = mask
        labels[mask] = k
        rules.append({"tone": tone, "level": round(float(np.median(light[mask])), 4), **own})
    panels = np.asarray(small(Image.fromarray(labels), Image.Resampling.NEAREST))
    rough = np.full(chart.shape, 0.86, np.float32)
    for tone, mask in tones.items():
        rough[mask] = ROUGH[tone]
    if spec.get("rough"):
        rough = np.asarray(Image.open(folder / spec["rough"]).convert("L").resize(source.size), dtype=np.float32) / 255
    metal = np.zeros(chart.shape, np.float32)
    if "mail" in extra:
        rings = extra["mail"] * np.clip((light - 0.1) / 0.16, 0, 1)
        metal = 0.9 * rings
        rough = np.where(extra["mail"], 0.78 - 0.34 * rings, rough)
    hollow = np.clip(1 + 2.2 * (ndimage.gaussian_filter(light, 1.5) - ndimage.gaussian_filter(light, 14)) / np.maximum(ndimage.gaussian_filter(light, 14), 0.05), 0.55, 1)
    surface = small(Image.fromarray(np.rint(np.dstack([hollow, rough, metal]) * 255).astype("uint8"), "RGB"))
    if spec.get("normal"):
        normal = small(Image.open(find(roots, spec["normal"])).convert("RGB").resize(source.size))
    else:
        high = np.asarray(Image.open(folder / spec["bump"]).convert("L").resize(source.size), dtype=np.float32) / 255 if spec.get("bump") else light
        normal = small(relief(high, chart > 0, spec.get("weave", 9.0 if "mail" in extra else 5.0)))
    record = dict(
        refs=encode(refs, "<u2"),
        weights=encode(weights, "<f4"),
        offsets=encode(offsets, "<f4"),
        uv=encode(np.rint(tex * 65535).clip(0, 65535), "<u2"),
        corners=encode(corners, "<u2"),
        uvCorners=encode(texcorners, "<u2"),
        hide=encode(sorted(set(hide)), "<u2"),
        rest=encode(rest, "<f4"),
        cover=bool(spec.get("cover")),
        panels=encode(panels, "u1"),
        dye=rules,
        texture=webp(diffuse, 88),
        normal=webp(normal, 92),
        surface=webp(surface, 90),
        credit=credit(roots, spec["folder"]),
        **{key: spec[key] for key in ("under",) if key in spec},
    )
    print(name, count, "vertices", len(corners) // 3, "triangles", [r["tone"] + " " + str(r["level"]) for r in rules])
    return record


def pack(roots, out):
    library = {name: pack_one(name, spec, roots) for name, spec in GARMENTS.items()}
    out.write_text(json.dumps(library, separators=(",", ":")) + "\n")
    subprocess.run(["node", str(pathlib.Path(__file__).with_name("pack-human-attire-finish.mjs")), str(out)], check=True)
    print(out.stat().st_size, "bytes")


if __name__ == "__main__":
    pack([pathlib.Path(arg) for arg in sys.argv[1:-1]], pathlib.Path(sys.argv[-1]))
