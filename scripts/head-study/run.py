"""Fit the editable head to each prepared head scan and score every stage.

Usage: python scripts/head-study/run.py CACHE [--keep-snapshot] [--label NAME] [--install] [name ...]

The modules of the generator are first copied to CACHE/generator-snapshot, so every
number of a run belongs to one generator version. --keep-snapshot reuses the copy.
--label NAME keeps a second run beside the first: its snapshot, results, fits and
pictures get the suffix -NAME, so a frozen run and a run on a newer generator can
be compared.

Writes CACHE/results.json and, per scan, CACHE/fits/<name>.json with the fitted
recipe and its surface correction. Both are derived from the scans and stay in
the cache. --install also copies the fits to examples/head-targets-fits/, the
ignored folder the local study list of the editor reads. tables.py turns the
numbers into the tables of the public write-up.
"""

import json
import shutil
import sys
import time
from pathlib import Path

import numpy as np

import hs_targets
from hs_fit import Head, Placement, ScanView, correct, fit_recipe, near_faces, region_weights, settle
from hs_generator import Generator, HeadTopology, snapshot
from hs_metrics import Scored, folds, profile, roughness

PASSES = (1, 3)        # fitHumanReference runs that are scored
CHOSEN_PASSES = 1      # the run stored as the study's surface correction


INSTALLED = Path(__file__).resolve().parents[2] / "examples" / "head-targets-fits"


def labelled(cache, name, label):
    return Path(cache) / (name + ("-" + label if label else ""))


def results_path(cache, label=""):
    return labelled(cache, "results", label).with_suffix(".json")


def fits_path(name, cache, label=""):
    return labelled(cache, "fits", label) / f"{name}.json"


def study(generator, topology, name, cache, label="", log=print):
    source = hs_targets.SOURCES[name]
    blink, not_skin = source["blink"], tuple(source["not_skin"])
    vertices, faces = hs_targets.load_placed(name, cache)
    started = time.time()
    weight = region_weights(not_skin)
    default_head = Head(topology, generator.evaluate([{}], blink=blink)[0], weight)
    # Fit on the part of the scan near the head; the bust below it only slows the search.
    view = ScanView(vertices, faces, near_faces(vertices, faces, default_head.vertices[default_head.ids], 0.05))
    stages = {}

    log("  default head")
    placement = settle(default_head, view, Placement(), rounds=10)
    stages["default"] = {"recipe": {}, "fit": None, "placement": placement}

    log("  editor recipe fit (optimizeHumanMeasurements, head)")
    measured = generator.measure({}, placement.apply(vertices), faces, "head")
    recipe = generator.recipe(measured["human"])
    head = Head(topology, generator.evaluate([recipe], blink=blink)[0], weight)
    stages["editor recipe fit"] = {"recipe": recipe, "fit": None, "placement": settle(head, view, placement, rounds=10),
                                   "editor_metrics": measured["metrics"]}

    log("  head recipe fit")
    fitted = fit_recipe(generator, topology, view, placement, blink=blink, not_skin=not_skin, log=log)
    recipe, placement = fitted["recipe"], fitted["placement"]
    stages["recipe fit"] = {"recipe": recipe, "fit": None, "placement": placement,
                            "history": fitted["history"], "start": fitted["start"]}

    scan = placement.apply(vertices)  # the frame every stage is scored in
    drop = ("eyes", *not_skin)
    for passes in PASSES:
        log(f"  fitHumanReference x{passes}")
        fit, reports = correct(generator, topology, recipe, scan, faces, passes, drop)
        stages[f"corrected x{passes}"] = {"recipe": recipe, "fit": fit, "placement": placement, "editor_reports": reports}

    chosen = f"corrected x{CHOSEN_PASSES}"
    smooth = {key: generator.smooth(stage["recipe"], stage["fit"], blink) for key, stage in stages.items()}
    # Stages that settled the scan differently are moved into the scoring frame through the scan.
    smooth = {key: placement.apply(stages[key]["placement"].inverse(surface)) for key, surface in smooth.items()}
    scored = Scored(topology, scan, faces, smooth[chosen], not_skin)
    out = {}
    for key, stage in stages.items():
        regions, _ = scored.score(smooth[key])
        line, _, _ = profile(topology, smooth[key], scan, faces)
        out[key] = {"recipe": stage["recipe"], "placement": stage["placement"].to_json(), "regions": regions,
                    "midline_profile": line}
        if stage["fit"]:
            lengths = np.linalg.norm(np.array(stage["fit"]["controls"])[:, 1:], axis=1) * 0.1
            out[key]["correction"] = {
                "controls": len(stage["fit"]["controls"]), "mean_offset_mm": float(lengths.mean()),
                "max_offset_mm": float(lengths.max()), "at_limit": int((lengths > 64).sum()),
                "roughness_mm": roughness(topology, smooth[key], smooth["recipe fit"]),
                # Open-eyed cage, as the editor shows the correction.
                "folds": folds(topology.cage_faces, *generator.evaluate([recipe, recipe], [None, stage["fit"]])),
                "editor_reports": stage["editor_reports"],
            }
        for extra in ("history", "start", "editor_metrics"):
            if extra in stage:
                out[key][extra] = stage[extra]
        log(f"  {key:18s} head {regions['head']['two_way_mean_mm']:.2f} mm, face {regions['face']['two_way_mean_mm']:.2f} mm, "
            f"midline {line['mean_mm']:.2f} mm")

    path = fits_path(name, cache, label)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({
        "target": name, "title": source["title"], "attribution": source["attribution"], "license": source["license"],
        "human": recipe, "humanFit": stages[chosen]["fit"],
        "scanPlacement": placement.to_json(),
        "note": "human and humanFit open in the character editor. scanPlacement moves the prepared scan "
                "(scale * rotation @ point + translation) onto this head. The scan's eyes are closed; the recipe's are open.",
    }, indent=1) + "\n", encoding="utf-8")
    return {"title": source["title"], "license": source["license"],
            "not_skin": source["not_skin"], "eyes_closed": bool(blink), "chosen": chosen,
            "scan_head_share": float(scored.head_face.mean()), "seconds": round(time.time() - started, 1),
            "stages": out}


def main(cache, names, keep_snapshot=False, label="", install=False):
    folder = labelled(cache, "generator-snapshot", label)
    generator = Generator(folder if keep_snapshot and folder.exists() else snapshot(folder))
    topology = HeadTopology(generator)
    path = results_path(cache, label)
    results = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"targets": {}}
    results.update({"generator_sha256": generator.source_sha256, "unit": "millimetres on a 1.72 m editable human",
                    "head_axes": list(topology.head_axes),
                    "axis_effect_mm": {name: round(value, 3) for name, value in topology.axis_effect_mm.items()}})
    for name in names:
        if hs_targets.load_placed(name, cache) is None:
            print(name, "is not prepared here; skipped")
            continue
        print(name, flush=True)
        results["targets"][name] = study(generator, topology, name, cache, label, lambda text: print(text, flush=True))
        if install:
            INSTALLED.mkdir(parents=True, exist_ok=True)
            shutil.copy2(fits_path(name, cache, label), INSTALLED / f"{name}.json")
    path.write_text(json.dumps(results, indent=1) + "\n", encoding="utf-8")
    generator.close()


if __name__ == "__main__":
    arguments, label = sys.argv[1:], ""
    if "--label" in arguments:
        label = arguments.pop(arguments.index("--label") + 1)
        arguments.remove("--label")
    flags = {flag: flag in arguments for flag in ("--keep-snapshot", "--install")}
    arguments = [a for a in arguments if a not in flags]
    main(Path(arguments[0]), arguments[1:] or list(hs_targets.SOURCES), flags["--keep-snapshot"], label, flags["--install"])
