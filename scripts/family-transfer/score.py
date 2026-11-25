"""Score transferred heads against every member of the family and draw them.

From the repository root, after run.mjs:
    python scripts/family-transfer/score.py WORK --landmarks PICKS.json [--ids f1,m1]

WORK is the local folder run.mjs wrote. PICKS.json names three landmarks on
each topology as triangle corners and weights, {"family": [...], "editable":
[...]}: outer eye corners in image-left, image-right order and the front of
the chin. They are picked once per topology and follow every member.

The identity measures are those of scripts/head-study/identity_grid.py: depth
maps after aligning the landmarks, each result against every member, and the
signed depth change between two people on both mesh families.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy.optimize import linear_sum_assignment

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "head-study"))
sys.path.insert(0, str(HERE.parent / "human-benchmark"))
from hb_gpu import renderer_name  # noqa: E402
from hb_mesh import Surface, rigid_fit  # noqa: E402
from hb_raster import rasterize, shade, view_basis  # noqa: E402
import identity_grid as grid  # noqa: E402

MODES = ["base", "reference-fit", "ordinary", "measurements", "transfer", "detail", "full", "plain", "fitted", "dense"]
LABELS = {"member": "family member", "base": "registered base (no identity)", "reference-fit": "ordinary reference fit",
          "measurements": "transfer: measurements only", "controls": "transfer: control anchors only",
          "transfer": "transfer: measurements + anchors", "dense": "per-vertex goals (upper bound)",
          "detail": "transfer: measurements + fine layer", "full": "transfer: all three layers",
          "ordinary": "ordinary fit, this version", "plain": "editor: head onto plain adult",
          "fitted": "editor: ordinary fit + head"}


def read(work, name, faces):
    return np.fromfile(work / name, "<f4").reshape(-1, 3).astype(np.float64), faces


def landmarks(vertices, picks):
    return np.stack([np.array(weights) @ vertices[np.array(corners)] for corners, weights in picks])


def score(work, ids, picks, modes):
    family = np.fromfile(work / "family.idx", "<u4").reshape(-1, 3).astype(np.int64)
    smooth = np.fromfile(work / "smooth.idx", "<u4").reshape(-1, 3).astype(np.int64)
    out = work / "grid"
    out.mkdir(exist_ok=True)

    def capture(name, faces, key):
        vertices, _ = read(work, name, faces)
        path = out / (Path(name).stem + ".npz")
        np.savez_compressed(path, vertices=vertices, faces=faces, landmarks=landmarks(vertices, picks[key]))
        return grid.captures(path)

    targets = [capture(f"{i}-member.xyz", family, "family") for i in ids]
    trials = {}
    for mode in modes:
        if mode == "base":
            trials[mode] = [capture("base.xyz", smooth, "editable")] * len(ids)
        elif all((work / f"{i}-{mode}.xyz").exists() for i in ids):
            trials[mode] = [capture(f"{i}-{mode}.xyz", smooth, "editable") for i in ids]
    masks, coverage = grid.shared_crops(targets + [v for views in trials.values() for v in views])
    result = {"ids": ids, "unit": "mm after scaling to 92 mm between outer eye corners", "viewsDegrees": [0, 35, -35],
              "saturatedAtMm": 15, "commonCropFraction": coverage, "renderer": renderer_name()}
    # How far apart the members themselves are: the scale every other number is read against.
    result["members"] = {"matrix": [[round(grid.distance(a, b, masks), 4) for b in targets] for a in targets]}
    for mode, candidates in trials.items():
        matrix = [[round(grid.distance(views, target, masks), 4) for target in targets] for views in candidates]
        ranks = [1 + sum(x < scores[i] for x in scores) for i, scores in enumerate(matrix)]
        _, assignment = linear_sum_assignment(matrix)
        diagonal = [matrix[i][i] for i in range(len(ids))]
        wrong = [np.mean([matrix[i][j] for j in range(len(ids)) if j != i]) for i in range(len(ids))]
        result[mode] = {
            "matrix": matrix, "trueRank": ranks, "identified": sum(r == 1 for r in ranks),
            "forcedAssignment": [ids[j] for j in assignment],
            "forcedCorrect": int(np.sum(assignment == np.arange(len(ids)))),
            "matchedMeanMm": round(float(np.mean(diagonal)), 4), "wrongPersonMeanMm": round(float(np.mean(wrong)), 4),
            "marginMm": [round(float(min(matrix[i][j] for j in range(len(ids)) if j != i) - matrix[i][i]), 4)
                         for i in range(len(ids))],
            "relativeShape": grid.relative_identity(candidates, targets, masks, ids),
        }
    return result


def face_vertices(work, picks):
    """Editable vertices of the face: those seen from the front inside the grid's ellipse on the registered base.

    Only skin the family also has counts: eye openings and the inside of the
    mouth lie away from the neutral and say nothing about a member.
    """
    smooth = np.fromfile(work / "smooth.idx", "<u4").reshape(-1, 3).astype(np.int64)
    family = np.fromfile(work / "family.idx", "<u4").reshape(-1, 3).astype(np.int64)
    base, _ = read(work, "base.xyz", smooth)
    neutral = Surface(read(work, "neutral.xyz", family)[0], family, anchor_spacing=0.006)
    posed = grid.normalized(base, landmarks(base, picks["editable"]))
    ids, _, _ = rasterize(posed, smooth, view_basis(0), np.array([0, -.035, 0]), 1400, 192, 210)
    yy, xx = np.indices(ids.shape)
    inside = (((xx - 95.5) / 71) ** 2 + ((yy - 104.5) / 95) ** 2 < 1) & (ids >= 0)
    seen = np.unique(smooth[ids[inside]])
    return seen[neutral.closest(base[seen])[0] < 0.004]


def surface_distances(work, ids, picks, modes):
    """Distance from each result's face to every member's surface, in true millimetres.

    No landmarks and no depth maps: the face vertices of a result are turned and
    shifted onto a member's surface until their mean distance stops falling, then
    measured. Every pair gets its own best placement, so a wrong person is not
    penalised for standing elsewhere.
    """
    family = np.fromfile(work / "family.idx", "<u4").reshape(-1, 3).astype(np.int64)
    smooth = np.fromfile(work / "smooth.idx", "<u4").reshape(-1, 3).astype(np.int64)
    face = face_vertices(work, picks)
    base = read(work, "base.xyz", smooth)[0][face]
    members = [Surface(read(work, f"{i}-member.xyz", family)[0], family, anchor_spacing=0.006) for i in ids]

    def placed(points, surface):
        for _ in range(12):
            _, nearest, _, _ = surface.closest(points)
            turn, shift = rigid_fit(points, nearest)
            points = points @ turn.T + shift
        return float(surface.closest(points)[0].mean() * 1000)

    result = {"unit": "mm, mean distance of the result's face vertices to a member after the best turn and shift",
              "faceVertices": int(len(face))}
    for mode in modes:
        names = ["base.xyz"] * len(ids) if mode == "base" else [f"{i}-{mode}.xyz" for i in ids]
        if not all((work / n).exists() for n in names):
            continue
        matrix = []
        for name in names:
            points = read(work, name, smooth)[0][face]
            turn, shift = rigid_fit(points, base)  # every result starts where the registered base stands
            points = points @ turn.T + shift
            matrix.append([round(placed(points, member), 4) for member in members])
        ranks = [1 + sum(x < row[i] for x in row) for i, row in enumerate(matrix)]
        _, assignment = linear_sum_assignment(matrix)
        count = len(ids)
        result[mode] = {
            "matrix": matrix, "trueRank": ranks, "identified": sum(r == 1 for r in ranks),
            "forcedCorrect": int(np.sum(assignment == np.arange(count))),
            "matchedMeanMm": round(float(np.mean([matrix[i][i] for i in range(count)])), 4),
            "wrongPersonMeanMm": round(float(np.mean([matrix[i][j] for i in range(count) for j in range(count) if i != j])), 4),
        }
    return result


def sheet(work, ids, rows, path, angle=35, tile=(200, 232)):
    family = np.fromfile(work / "family.idx", "<u4").reshape(-1, 3).astype(np.int64)
    smooth = np.fromfile(work / "smooth.idx", "<u4").reshape(-1, 3).astype(np.int64)
    width, height = tile
    image = Image.new("RGB", (width * len(ids), (height + 18) * len(rows)), "#1b2429")
    draw = ImageDraw.Draw(image)
    for column, i in enumerate(ids):
        member, _ = read(work, f"{i}-member.xyz", family)
        # Frame every row of a column on the head transferred onto the registered base, so a shift or a size change shows.
        placed = next(m for m in ("transfer", "detail", "measurements") if (work / f"{i}-{m}.xyz").exists())
        anchor, _ = read(work, f"{i}-{placed}.xyz", smooth)
        top = anchor[:, 1].max()
        upper = anchor[anchor[:, 1] > top - 0.17]
        centre = np.array([upper[:, 0].mean(), top - 0.115, (upper[:, 2].max() + upper[:, 2].min()) / 2])
        for row, mode in enumerate(rows):
            if mode == "member":
                vertices, faces = member, family
            else:
                name = "base.xyz" if mode == "base" else f"{i}-{mode}.xyz"
                vertices, faces = read(work, name, smooth)
            if mode in ("base", "reference-fit", "ordinary", "plain", "fitted"):
                # These stand elsewhere: bring the top of the head and the face centre to the same spot.
                own_top = vertices[:, 1].max()
                own = vertices[vertices[:, 1] > own_top - 0.17]
                shift = centre - np.array([own[:, 0].mean(), own_top - 0.115, (own[:, 2].max() + own[:, 2].min()) / 2])
                vertices = vertices + shift
            rgb = shade(vertices, faces, view_basis(angle), centre, width / 0.25, width, height)[0]
            image.paste(Image.fromarray(np.uint8(255 * rgb.clip(0, 1))), (column * width, row * (height + 18)))
            draw.text((column * width + 4, row * (height + 18) + height + 3), f"{i}: {LABELS[mode]}"[:34], fill="white")
    image.save(path, quality=92)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("work", type=Path)
    parser.add_argument("--landmarks", type=Path, required=True)
    parser.add_argument("--ids")
    parser.add_argument("--modes", default=",".join(MODES))
    parser.add_argument("--name", default="identity", help="name of the JSON written into WORK")
    parser.add_argument("--rows", default="reference-fit,transfer,detail,full", help="modes drawn under each member")
    args = parser.parse_args()
    members = json.loads((args.work / "results.json").read_text())["members"]
    ids = args.ids.split(",") if args.ids else sorted(members)
    picks = json.loads(args.landmarks.read_text())
    modes = args.modes.split(",")
    result = score(args.work, ids, picks, modes)
    result["surface"] = surface_distances(args.work, ids, picks, modes)
    (args.work / f"{args.name}.json").write_text(json.dumps(result, indent=1) + "\n")
    print("members apart", np.round(np.array(result["members"]["matrix"]), 2).tolist())
    for mode in modes:
        if mode not in result:
            continue
        r = result[mode]
        print(f"{mode:14s} identified {r['identified']}/{len(ids)} forced {r['forcedCorrect']}/{len(ids)} "
              f"matched {r['matchedMeanMm']:.2f} wrong {r['wrongPersonMeanMm']:.2f} "
              f"cos {r['relativeShape']['medianCosine']} amp {r['relativeShape']['medianAmplitudeRatio']} rank {r['trueRank']}")
    for mode in modes:
        if mode in result["surface"]:
            r = result["surface"][mode]
            print(f"surface {mode:14s} identified {r['identified']}/{len(ids)} matched {r['matchedMeanMm']:.2f} "
                  f"wrong {r['wrongPersonMeanMm']:.2f} rank {r['trueRank']}")
    rows = ["member"] + [m for m in args.rows.split(",") if (args.work / f"{ids[0]}-{m}.xyz").exists()]
    for angle in (0, 35, 90):
        sheet(args.work, ids, rows, args.work / f"heads-{angle}.webp", angle)


if __name__ == "__main__":
    main()
