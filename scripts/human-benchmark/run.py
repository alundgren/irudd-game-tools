"""Fit the editable human to every benchmark target and score the results independently.

From the repository root, after `pnpm install --frozen-lockfile`:
    python scripts/human-benchmark/run.py WORK [--targets mhr-f1,mhr-m1] [--refit]
                                               [--keep-snapshot] [--fits-only]

WORK is a scratch folder inside the repository (for example
.reference-cache/human-benchmark) for a copy of the generator, cached fits and
comparisons. Results go to
docs/media/human-benchmark/results.json and the fitted recipes to
examples/human-targets-fits/. Run report.py afterwards for the pictures.
Requires numpy, scipy, moderngl, opencv-python and Node with the repository's npm packages.
"""

import argparse
import json
import pickle
import time
from pathlib import Path

import numpy as np

from hb_fit import CoarseFit, TargetView, target_in_generator_frame
from hb_generator import Generator, snapshot
from hb_gpu import cache_tag, renderer_name
from hb_mesh import face_normals, vertex_normals
from hb_metrics import ARM_REGIONS, Body, compare, folded_faces, measurements, silhouette_overlap, split_error
from hb_targets import load_manifest, load_target

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "docs" / "media" / "human-benchmark" / "results.json"
FITS = ROOT / "examples" / "human-targets-fits"
CANDIDATES = ("neutral", "stature", "coarse", "refined", "coarseFront", "refinedFront")


def log(*parts):
    print(time.strftime("%H:%M:%S"), *parts, flush=True)


def arm_mask(body, target=None):
    """Arm and hand faces: the target's own labels, or labels carried over from the nearest target face."""
    if target is None:
        region = body.face_region
        names = body.region_names
    else:
        centres = body.vertices[body.faces].mean(1)
        _, _, face, _ = target.surface.closest(centres)
        region, names = target.face_region[face], target.region_names
    return np.isin(region, [names.index(n) for n in ARM_REGIONS])


def refine(generator, recipe, placement, target, seen):
    """The editor's second-stage surface correction, shown only the `seen` target faces."""
    vertices = target_in_generator_frame(target.vertices, placement)
    reply = generator.refine(recipe, vertices, target.faces[seen])
    return reply["fit"], reply["metrics"]


def fit_target(generator, target):
    front = face_normals(target.vertices, target.faces)[0][:, 2] > 0
    out = {"frontFaces": front}
    for key, seen in (("coarse", None), ("coarseFront", front)):
        started, before = time.time(), generator.evaluations
        view = TargetView(target, seen)
        recipe, placement, starts = CoarseFit(generator, view, log).run()
        out[key] = {"recipe": recipe, "placement": placement.tolist(), "starts": starts,
                    "seconds": round(time.time() - started, 1), "evaluations": generator.evaluations - before}
        started = time.time()
        fit, tool = refine(generator, recipe, placement, target, view.seen)
        out[key.replace("coarse", "refined")] = {
            "recipe": recipe, "humanFit": fit, "placement": placement.tolist(), "toolMetrics": tool,
            "seconds": round(time.time() - started, 1)}
    return out


def score(candidate_vertices, faces, target, seed, front=None):
    body = Body(candidate_vertices, faces, seed=seed)
    metrics, detail = compare(body, target)
    moved = detail["moved"]
    metrics["silhouetteOverlap"] = silhouette_overlap(moved, target)
    metrics["measurements"], _ = measurements(moved, arm_mask(moved, target))
    if front is not None:
        metrics["frontSurface"] = split_error(detail, target, front)
        metrics["backSurface"] = split_error(detail, target, ~front)
    return metrics, moved.vertices


def folds(generator, state, target):
    """Triangles the surface correction turns inside out, counted on the head and on the rest of the body."""
    centres = state["surfaces"]["coarse"][generator.faces].mean(1)
    _, _, nearest, _ = target.surface.closest(centres)
    head = target.face_region[nearest] == target.region_names.index("head")
    out = {}
    for key in ("refined", "refinedFront"):
        fit = state["fits"][key]
        before, after = generator.evaluate([fit["recipe"]] * 2, [None, fit["humanFit"]])
        out[key] = {"head": folded_faces(before, after, generator.faces, head),
                    "body": folded_faces(before, after, generator.faces, ~head)}
    return out


def at_limit(generator, recipe):
    """Recipe axes the fit pushed to the end of their legal range."""
    values = generator.vector(recipe)
    span = generator.high - generator.low
    return [name for name, v, low, high, s in zip(generator.axes, values, generator.low, generator.high, span)
            if min(v - low, high - v) < 0.005 * s]


def self_recovery(generator, seed):
    """Positive control: can the fit find a recipe the generator itself produced?"""
    rng = np.random.default_rng(seed)
    span = generator.high - generator.low
    truth = generator.initial + (rng.random(len(span)) - 0.5) * span * 0.5
    truth[generator.axes.index("height")] = rng.uniform(1.58, 1.86)
    truth[generator.axes.index("age")] = rng.uniform(0, 0.5)
    truth_recipe = generator.recipe(truth)
    target = Body(generator.evaluate([truth_recipe])[0], generator.faces, seed=seed)
    recipe, _, _ = CoarseFit(generator, TargetView(target), log).run()
    found = Body(generator.evaluate([recipe])[0], generator.faces, seed=seed + 1)
    start = Body(generator.evaluate([{"height": truth_recipe["height"]}])[0], generator.faces, seed=seed + 2)
    error = np.abs(generator.vector(recipe) - generator.vector(truth_recipe)) / span
    return {"seed": seed, "truth": truth_recipe, "recovered": recipe,
            "chamferBefore": compare(start, target, local=False)[0]["chamfer"],
            "chamferAfter": compare(found, target, local=False)[0]["chamfer"],
            "axisErrorFractionOfRange": {"mean": round(float(error.mean()), 4), "max": round(float(error.max()), 4),
                                         "worstAxis": generator.axes[int(error.argmax())]}}


def calibration(target):
    """Does the metric report known disturbances of a target at their true size?"""
    normals = vertex_normals(target.vertices, target.faces)
    angle = np.radians(4.0)
    turn = np.array([[np.cos(angle), 0, np.sin(angle)], [0, 1, 0], [-np.sin(angle), 0, np.cos(angle)]])
    cases = {
        "identical surface, new samples": target.vertices,
        "inflated 5 mm along normals": target.vertices + 0.005 * normals,
        "turned 4 degrees and moved 36 mm": target.vertices @ turn.T + [0.03, 0.0, 0.02],
        "scaled to 103 percent": target.vertices * 1.03,
    }
    out = {}
    for name, vertices in cases.items():
        metrics, _ = compare(Body(vertices, target.faces, seed=77), target, local=False)
        out[name] = {k: metrics[k] for k in ("chamfer", "hausdorff95", "meanSignedOffset", "alignment")}
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("work", type=Path)
    parser.add_argument("--targets")
    parser.add_argument("--refit", action="store_true", help="ignore cached fits and comparisons")
    parser.add_argument("--keep-snapshot", action="store_true",
                        help="reuse the generator copy named in WORK/snapshot.txt instead of copying the current one")
    parser.add_argument("--fits-only", action="store_true",
                        help="stop after the per-target fits, so several processes can share the work")
    args = parser.parse_args()
    args.work.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    entries = [e for e in manifest["targets"] if not args.targets or e["id"] in args.targets.split(",")]
    pointer = args.work / "snapshot.txt"
    if args.keep_snapshot and pointer.exists():
        folder = args.work / pointer.read_text().strip()
    else:
        folder = snapshot(args.work)
        pointer.write_text(folder.name + "\n")
    generator = Generator(folder)
    tag = cache_tag(generator.source_sha256)
    log("generator", tag, len(generator.axes), "axes")

    targets, state = {}, {}
    for entry in entries:
        vertices, faces, regions, names = load_target(entry, manifest)
        targets[entry["id"]] = Body(vertices, faces, seed=1, vertex_region=regions, region_names=names)
        log("prepared", entry["id"])

    for entry in entries:
        tid, target = entry["id"], targets[entry["id"]]
        cache = args.work / f"{tid}-{tag}.pkl"
        if cache.exists() and not args.refit:
            state[tid] = pickle.loads(cache.read_bytes())
            log("cached", tid)
            continue
        log("fitting", tid)
        fits = fit_target(generator, target)
        front = fits.pop("frontFaces")
        recipes = {"neutral": ({}, None), "stature": ({"height": round(target.stature, 4)}, None)}
        for key in ("coarse", "coarseFront"):
            recipes[key] = (fits[key]["recipe"], None)
            recipes[key.replace("coarse", "refined")] = (fits[key]["recipe"], fits[key.replace("coarse", "refined")]["humanFit"])
        scores, surfaces = {}, {}
        for index, name in enumerate(CANDIDATES):
            recipe, human_fit = recipes[name]
            vertices = generator.evaluate([recipe], [human_fit])[0]
            scores[name], surfaces[name] = score(vertices, generator.faces, target, 100 + index, front)
            log(f"  {name:13s} chamfer {scores[name]['chamfer']:6.2f} mm  front {scores[name]['frontSurface']}"
                f"  back {scores[name]['backSurface']}")
        own, _ = measurements(target, arm_mask(target))
        state[tid] = {"fits": fits, "scores": scores, "surfaces": surfaces, "measurements": own,
                      "front": front, "generatorFaces": generator.faces}
        cache.write_bytes(pickle.dumps(state[tid]))

    if args.fits_only:
        generator.close()
        return

    ids = [e["id"] for e in entries]
    cross_cache = args.work / f"cross-{tag}-{'-'.join(ids)}.pkl"
    if cross_cache.exists() and not args.refit:
        cross = pickle.loads(cross_cache.read_bytes())
    else:
        cross = {"coarse": {}, "refined": {}, "targets": {}}
        bodies = {(kind, i): Body(state[i]["surfaces"][kind], generator.faces, seed=200) for i in ids for kind in ("coarse", "refined")}
        for i in ids:
            for kind in ("coarse", "refined"):
                cross[kind][i] = {j: (state[i]["scores"][kind]["chamfer"] if i == j else
                                      compare(bodies[(kind, i)], targets[j], local=False)[0]["chamfer"]) for j in ids}
            cross["targets"][i] = {j: (0.0 if i == j else compare(targets[i], targets[j], local=False)[0]["chamfer"])
                                   for j in ids}
            log("cross", i, cross["coarse"][i])
        cross_cache.write_bytes(pickle.dumps(cross))

    control_cache = args.work / f"controls-{tag}.pkl"
    if control_cache.exists() and not args.refit:
        controls = pickle.loads(control_cache.read_bytes())
    else:
        log("controls")
        controls = {"selfRecovery": [self_recovery(generator, seed) for seed in (5, 6)],
                    "calibration": calibration(targets[ids[0]])}
        control_cache.write_bytes(pickle.dumps(controls))

    FITS.mkdir(parents=True, exist_ok=True)
    RESULTS.parent.mkdir(parents=True, exist_ok=True)
    results = {
        "generator": {"sourceSha256": generator.source_sha256, "axes": generator.axes},
        "rasterizer": renderer_name(),
        "targetsManifest": "examples/human-targets/manifest.json",
        "units": "distances in millimetres, girths and breadths in metres, volume in litres",
        "targets": {}, "wrongIdentity": cross, "controls": controls,
    }
    for entry in entries:
        tid, s = entry["id"], state[entry["id"]]
        results["targets"][tid] = {
            "group": entry["group"], "role": entry["role"], "measurements": s["measurements"],
            "candidates": s["scores"], "folds": folds(generator, s, targets[tid]),
            "axesAtLimit": {key: at_limit(generator, s["fits"][key]["recipe"]) for key in ("coarse", "coarseFront")},
            "fits": {k: {a: b for a, b in v.items() if a not in ("humanFit",)} for k, v in s["fits"].items()},
        }
        (FITS / f"{tid}.json").write_text(json.dumps({
            "target": f"../human-targets/{entry['file']}",
            "license": "Apache-2.0. Measured from a target derived from the Momentum Human Rig; see "
                       "../human-targets/manifest.json.",
            "generatorSourceSha256": generator.source_sha256,
            "note": "human is the coarse recipe fitted to the whole target; humanFit is the editor's bounded "
                    "surface correction on top of it. placement moves the generated figure onto the target "
                    "(metres, then yaw in radians). frontOnly repeats both stages seeing only front-facing target surface.",
            "human": s["fits"]["coarse"]["recipe"], "humanFit": s["fits"]["refined"]["humanFit"],
            "placement": s["fits"]["coarse"]["placement"],
            "frontOnly": {"human": s["fits"]["coarseFront"]["recipe"], "humanFit": s["fits"]["refinedFront"]["humanFit"],
                          "placement": s["fits"]["coarseFront"]["placement"]},
        }, separators=(",", ":")) + "\n")
    RESULTS.write_text(json.dumps(results, indent=1) + "\n")
    generator.close()
    log("wrote", RESULTS)


if __name__ == "__main__":
    main()
