"""Draw the benchmark pictures from the fits cached by run.py.

From the repository root:
    python scripts/human-benchmark/report.py WORK

Writes docs/media/human-benchmark/*.webp. Every picture is an untextured clay
diagnostic drawn from fixed cameras using the available hardware renderer.
Each sheet records its renderer. Open the fitted recipes in the workshop to judge
their materials, animation and silhouette in context.
Candidates are shown where the independent alignment placed them on the target.
"""

import argparse
import pickle
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from hb_generator import source_hash
from hb_gpu import cache_tag, renderer_name
from hb_mesh import Surface, vertex_normals
from hb_raster import BACKGROUND, CLAY, shade, view_basis
from hb_targets import load_manifest, load_target

ROOT = Path(__file__).resolve().parents[2]
MEDIA = ROOT / "docs" / "media" / "human-benchmark"
LIMIT_MM = 20.0
INSIDE, OUTSIDE = np.array([0.20, 0.40, 0.78]), np.array([0.82, 0.24, 0.18])
INK = (40, 40, 40)
FONT = ImageFont.load_default(size=17)
SMALL = ImageFont.load_default(size=14)


def heat_colors(signed_m):
    """Blue where the candidate lies inside the target, red where it lies outside."""
    t = np.clip(signed_m * 1000 / LIMIT_MM, -1, 1)[:, None]
    return np.where(t < 0, CLAY + (INSIDE - CLAY) * -t, CLAY + (OUTSIDE - CLAY) * t)


def signed_offset(target_vertices, target_faces, candidate_vertices, candidate_faces):
    normals = vertex_normals(target_vertices, target_faces)
    _, q, _, _ = Surface(candidate_vertices, candidate_faces).closest(target_vertices)
    return np.einsum("ij,ij->i", q - target_vertices, normals)


def tile(vertices, faces, azimuth, center, scale, size, label, colors=None):
    image, _, _ = shade(vertices, faces, view_basis(azimuth), center, scale, size[0], size[1], vertex_colors=colors)
    picture = Image.fromarray((image * 255).astype(np.uint8))
    ImageDraw.Draw(picture).text((10, 8), label, fill=INK, font=FONT)
    return picture


def legend(width):
    bar = Image.new("RGB", (width, 46), tuple(int(c * 255) for c in BACKGROUND))
    draw = ImageDraw.Draw(bar)
    left, span = width // 2 - 200, 400
    ramp = heat_colors(np.linspace(-LIMIT_MM, LIMIT_MM, span) / 1000)
    for i, c in enumerate(ramp):
        draw.line([(left + i, 8), (left + i, 24)], fill=tuple(int(v * 255) for v in c))
    draw.text((left - 250, 6), f"generated surface {LIMIT_MM:.0f} mm inside", fill=INK, font=SMALL)
    draw.text((left + span + 12, 6), f"{LIMIT_MM:.0f} mm outside the target", fill=INK, font=SMALL)
    draw.text((left + span // 2 - 4, 26), "0", fill=INK, font=SMALL)
    draw.text((10, 26), renderer_name(), fill=INK, font=SMALL)
    return bar


def stack(rows):
    width = max(sum(t.width for t in row) for row in rows)
    sheet = Image.new("RGB", (width, sum(max(t.height for t in row) for row in rows)),
                      tuple(int(c * 255) for c in BACKGROUND))
    y = 0
    for row in rows:
        x = (width - sum(t.width for t in row)) // 2
        for t in row:
            sheet.paste(t, (x, y))
            x += t.width
        y += max(t.height for t in row)
    return sheet


def save(picture, name):
    MEDIA.mkdir(parents=True, exist_ok=True)
    picture.save(MEDIA / name, "WEBP", quality=84, method=6)
    print("wrote", name, picture.size)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("work", type=Path)
    args = parser.parse_args()
    manifest = load_manifest()
    tag = source_hash(args.work / (args.work / "snapshot.txt").read_text().strip())[:12]
    loaded = {}
    for entry in manifest["targets"]:
        cache = args.work / f"{entry['id']}-{cache_tag(tag)}.pkl"
        if not cache.exists():
            cache = args.work / f"{entry['id']}-{tag}.pkl"
        if cache.exists():
            vertices, faces, regions, names = load_target(entry, manifest)
            loaded[entry["id"]] = (entry, vertices, faces, regions, names, pickle.loads(cache.read_bytes()))
    if not loaded:
        raise SystemExit(f"No cached fits for generator {tag} in {args.work}; run run.py first.")

    lineup = []
    for tid, (entry, vertices, faces, *_rest) in loaded.items():
        center, scale = np.array([0.0, 0.98, 0.05]), 300
        label = f"{tid}  {entry['stature']:.2f} m"
        lineup.append(tile(vertices, faces, 0, center, scale, (350, 610), label))
        lineup.append(tile(vertices, faces, 90, center, scale, (190, 610), ""))
    half = len(lineup) // 2
    save(stack([lineup[:half], lineup[half:]]), "targets.webp")

    unseen_rows = []
    for tid, (entry, vertices, faces, regions, names, state) in loaded.items():
        gen_faces = state["generatorFaces"]
        offsets = {k: signed_offset(vertices, faces, state["surfaces"][k], gen_faces)
                   for k in ("coarse", "refined", "coarseFront", "refinedFront")}
        scores = state["scores"]
        center, scale, size = np.array([0.0, 0.98, 0.05]), 300, (350, 610)
        rows = []
        for azimuth in (0, 90):
            first = azimuth == 0
            rows.append([
                tile(vertices, faces, azimuth, center, scale, size, f"target {tid}" if first else ""),
                tile(state["surfaces"]["coarse"], gen_faces, azimuth, center, scale, size, "recipe fit" if first else ""),
                tile(state["surfaces"]["refined"], gen_faces, azimuth, center, scale, size,
                     "recipe + surface correction" if first else ""),
                tile(vertices, faces, azimuth, center, scale, size,
                     f"recipe fit, {scores['coarse']['chamfer']:.1f} mm" if first else "", heat_colors(offsets["coarse"])),
                tile(vertices, faces, azimuth, center, scale, size,
                     f"corrected, {scores['refined']['chamfer']:.1f} mm" if first else "", heat_colors(offsets["refined"])),
            ])
        head = vertices[regions == names.index("head")]
        head_center = (head.min(0) + head.max(0)) / 2 + [0, -0.01, 0]
        heads = []
        for key, label in ((None, "target"), ("coarse", "recipe fit"), ("refined", "corrected")):
            v, f = (vertices, faces) if key is None else (state["surfaces"][key], gen_faces)
            heads.append(tile(v, f, 0, head_center, 1150, (292, 380), label))
            heads.append(tile(v, f, 90, head_center, 1150, (292, 380), ""))
        rows.append(heads)
        rows.append([legend(1750)])
        save(stack(rows), f"fit-{tid}.webp")

        back = [tile(vertices, faces, 180, center, 250, (290, 510), f"{tid} from behind")]
        for key, label in (("coarseFront", "recipe, front seen"), ("refinedFront", "corrected, front seen"),
                           ("refined", "corrected, all seen")):
            caption = f"{label}: {scores[key]['backSurface']:.1f} mm"
            back.append(tile(vertices, faces, 180, center, 250, (290, 510), caption, heat_colors(offsets[key])))
        unseen_rows.append(back)
    paired = [unseen_rows[i] + (unseen_rows[i + 1] if i + 1 < len(unseen_rows) else []) for i in range(0, len(unseen_rows), 2)]
    save(stack(paired + [[legend(1750)]]), "unseen-back.webp")


if __name__ == "__main__":
    main()
