"""Print the benchmark's Markdown tables from docs/media/human-benchmark/results.json.

    python scripts/human-benchmark/tables.py

When replay.py has written replay.json beside it, the same recipes scored with the
current generator and correction tool are printed next to the recorded numbers.
"""

import json
import sys
from pathlib import Path

import numpy as np

RESULTS = Path(__file__).resolve().parents[2] / "docs" / "media" / "human-benchmark" / "results.json"
REPLAY = RESULTS.with_name("replay.json")
LABEL = {"neutral": "Default figure", "stature": "Stature only", "coarse": "Recipe fit",
         "refined": "Recipe + correction", "coarseFront": "Recipe fit, front seen",
         "refinedFront": "Recipe + correction, front seen"}


def table(header, rows):
    print("| " + " | ".join(header) + " |")
    print("| " + " | ".join("---" for _ in header) + " |")
    for row in rows:
        print("| " + " | ".join(str(c) for c in row) + " |")
    print()


def f(value, digits=1):
    return "–" if value is None else f"{value:.{digits}f}"


def main():
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    data = json.loads(RESULTS.read_text())
    targets = data["targets"]
    ids = list(targets)
    cross = data["wrongIdentity"]

    print("### Targets\n")
    table(["Target", "Build", "Role", "Stature m", "Chest m", "Waist m", "Hip m", "Shoulders m", "Volume l"],
          [[i, t["group"], t["role"]] + [f(t["measurements"][k], 3 if k != "volumeLitres" else 1) for k in
           ("stature", "chestGirth", "waistGirth", "hipGirth", "shoulderBreadth", "volumeLitres")]
           for i, t in targets.items()])

    print("### Whole body, two-way mean distance in mm\n")
    kinds = ("neutral", "stature", "coarse", "refined")
    rows = []
    for i, t in targets.items():
        other = min(v for j, v in cross["targets"][i].items() if j != i)
        rows.append([i, t["role"]] + [f(t["candidates"][k]["chamfer"], 2) for k in kinds] + [f(other, 2)])
    for role in ("development", "held out"):
        chosen = [i for i in ids if targets[i]["role"] == role]
        rows.append([f"**mean, {role}**", ""] + [
            f(np.mean([targets[i]["candidates"][k]["chamfer"] for i in chosen]), 2) for k in kinds] + [
            f(np.mean([min(v for j, v in cross["targets"][i].items() if j != i) for i in chosen]), 2)])
    table(["Target", "Role"] + [LABEL[k] for k in kinds] + ["Nearest other target"], rows)

    print("### Further whole-body measures\n")
    rows = []
    for i, t in targets.items():
        for k in ("stature", "coarse", "refined"):
            c = t["candidates"][k]
            rows.append([i, LABEL[k], f(c["candidateToTarget"]["mean"], 2), f(c["targetToCandidate"]["mean"], 2),
                         f(c["hausdorff95"]), f(c["candidateToTarget"]["max"]), f(c["targetToCandidate"]["max"]),
                         f(c["fscore"]["5mm"], 2), f(c["fscore"]["10mm"], 2), f(c["normalAngleDegrees"]),
                         f(c["meanSignedOffset"], 2), f(c["silhouetteOverlap"]["front"], 3), f(c["silhouetteOverlap"]["side"], 3)])
    table(["Target", "Candidate", "Generated→target", "Target→generated", "P95", "Max gen→tgt", "Max tgt→gen",
           "F 5 mm", "F 10 mm", "Normal °", "Signed offset", "Outline front", "Outline side"], rows)

    print("### Body parts, mean over targets, mm\n")
    regions = list(targets[ids[0]]["candidates"]["coarse"]["regions"]) + ["face"]
    rows = []
    for region in regions:
        row = [region]
        for k in ("stature", "coarse", "refined"):
            placed, local = [], []
            for i in ids:
                c = targets[i]["candidates"][k]
                r = c.get("face") if region == "face" else c["regions"].get(region)
                if r:
                    placed.append(r["chamfer"])
                    local.append(r["local"]["chamfer"])
            row += [f(np.mean(placed), 2), f(np.mean(local), 2)]
        rows.append(row)
    table(["Part", "Stature only", "its shape alone", "Recipe fit", "its shape alone", "Recipe + correction", "its shape alone"], rows)

    print("### Tape measurements, generated minus target\n")
    keys = (("stature", 1000, "Stature mm"), ("chestGirth", 1000, "Chest mm"), ("waistGirth", 1000, "Waist mm"),
            ("hipGirth", 1000, "Hip mm"), ("thighGirth", 1000, "Thigh mm"), ("calfGirth", 1000, "Calf mm"),
            ("shoulderBreadth", 1000, "Shoulders mm"), ("volumeLitres", 1, "Volume l"))
    rows = []
    for k in ("stature", "coarse", "refined"):
        for i, t in targets.items():
            m = t["candidates"][k]["measurements"]
            rows.append([LABEL[k], i] + [f((m[a] - t["measurements"][a]) * s, 1) for a, s, _ in keys])
        rows.append([f"**{LABEL[k]}, mean absolute**", ""] + [
            f(np.mean([abs(targets[i]["candidates"][k]["measurements"][a] - targets[i]["measurements"][a]) * s
                       for i in ids]), 1) for a, s, _ in keys])
    table(["Candidate", "Target"] + [label for _, _, label in keys], rows)

    print("### Seen and unseen surface, two-way mean distance in mm\n")
    kinds = ("stature", "coarseFront", "refinedFront", "coarse", "refined")
    for side, title in (("backSurface", "Back-facing target surface"), ("frontSurface", "Front-facing target surface")):
        print(f"{title}\n")
        rows = [[i] + [f(t["candidates"][k][side], 2) for k in kinds] for i, t in targets.items()]
        rows.append(["**mean**"] + [f(np.mean([targets[i]["candidates"][k][side] for i in ids]), 2) for k in kinds])
        table(["Target"] + [LABEL[k] for k in kinds], rows)

    for kind, title in (("coarse", "recipe fit"), ("refined", "recipe + correction")):
        print(f"### Wrong-identity control, {title}: row = fitted to, column = scored against, mm\n")
        rows = []
        for i in ids:
            rows.append([f"fit of {i}"] + [f"**{f(cross[kind][i][j], 2)}**" if i == j else f(cross[kind][i][j], 2) for j in ids])
        table([""] + ids, rows)
        own = [cross[kind][i][i] for i in ids]
        wrong = [min(cross[kind][j][i] for j in ids if j != i) for i in ids]
        hits = sum(min(ids, key=lambda j: cross[kind][j][i]) == i for i in ids)
        print(f"Each target is closest to its own fit in {hits} of {len(ids)} cases. Own fit: mean {np.mean(own):.2f} mm. "
              f"Best wrong fit: mean {np.mean(wrong):.2f} mm, smallest margin {min(w - o for w, o in zip(wrong, own)):.2f} mm.\n")

    print("### Target against target, mm\n")
    table([""] + ids, [[i] + [f(cross["targets"][i][j], 2) for j in ids] for i in ids])

    print("### Controls\n")
    table(["Disturbance of one target", "Two-way mean mm", "P95 mm", "Signed offset mm", "Recovered yaw °"],
          [[name, f(c["chamfer"], 2), f(c["hausdorff95"], 2), f(c["meanSignedOffset"], 2), f(c["alignment"]["yawDegrees"], 2)]
           for name, c in data["controls"]["calibration"].items()])
    table(["Self-recovery seed", "Before mm", "After mm", "Mean axis error", "Worst axis error", "Worst axis"],
          [[c["seed"], f(c["chamferBefore"], 2), f(c["chamferAfter"], 2),
            f"{c['axisErrorFractionOfRange']['mean'] * 100:.1f}% of range",
            f"{c['axisErrorFractionOfRange']['max'] * 100:.1f}% of range", c["axisErrorFractionOfRange"]["worstAxis"]]
           for c in data["controls"]["selfRecovery"]])

    print("### Fit cost\n")
    table(["Target", "Recipe fit s", "Generator evaluations", "Surface correction s", "Anchors moved"],
          [[i, t["fits"]["coarse"]["seconds"], t["fits"]["coarse"]["evaluations"], t["fits"]["refined"]["seconds"],
            f"{t['fits']['refined']['toolMetrics']['fittedAnchors']} of {t['fits']['refined']['toolMetrics']['eligibleAnchors']}"]
           for i, t in targets.items()])

    if "folds" in targets[ids[0]]:
        print("### Triangles the surface correction turns inside out\n")
        table(["Target", "Head, all seen", "Body, all seen", "Head, front seen", "Body, front seen"],
              [[i] + [f"{t['folds'][k][part]['folded']} of {t['folds'][k][part]['triangles']}"
                      for k in ("refined", "refinedFront") for part in ("head", "body")] for i, t in targets.items()])
        print("### Recipe axes at the end of their range\n")
        table(["Target", "Count", "Axes"],
              [[i, len(t["axesAtLimit"]["coarse"]), ", ".join(f"`{a}`" for a in t["axesAtLimit"]["coarse"]) or "none"]
               for i, t in targets.items()])
        print("### Fitted recipes, main body axes\n")
        axes = ("height", "frame", "age", "weight", "muscle", "shoulders", "chest", "bust", "waist", "hips", "belly", "legs")
        axes = [a for a in axes if a in targets[ids[0]]["fits"]["coarse"]["recipe"]]
        table(["Target"] + [f"`{a}`" for a in axes],
              [[i] + [f(t["fits"]["coarse"]["recipe"][a], 2) for a in axes] for i, t in targets.items()])

    if REPLAY.exists():
        replay = json.loads(REPLAY.read_text())
        done = [i for i in ids if i in replay["targets"]]
        print(f"### Same recipes on generator {replay['replayedWith'][:12]} (fitted on {replay['fittedWith'][:12]}), mm\n")
        rows = []
        for i in done:
            r, c = replay["targets"][i], targets[i]["candidates"]
            rows.append([i, f(c["coarse"]["chamfer"], 2), f(r["coarse"]["chamfer"], 2), f(c["refined"]["chamfer"], 2),
                         f(r["refined"]["chamfer"], 2), f(r["refinedNow"]["chamfer"], 2),
                         f(c["coarse"]["regions"]["torso"]["chamfer"], 2), f(r["coarse"]["regions"]["torso"], 2)])
        rows.append(["**mean**"] + [f(np.mean([float(row[n]) for row in rows]), 2) for n in range(1, 8)])
        table(["Target", "Recipe fit, as fitted", "now", "Saved correction, as fitted", "now", "Correction made now",
               "Torso of recipe fit, as fitted", "now"], rows)
        print("### Head after each correction, mm and triangles turned inside out\n")
        rows = []
        for i in done:
            r = replay["targets"][i]
            rows.append([i] + [f(r[k]["face"]["chamfer"], 2) for k in ("coarse", "refined", "refinedNow")]
                        + [f(r[k]["headShapeAlone"], 2) for k in ("coarse", "refined", "refinedNow")]
                        + [f(r[k]["face"]["shapeAlone"], 2) for k in ("coarse", "refined", "refinedNow")]
                        + [r[k]["folds"]["head"]["folded"] for k in ("refined", "refinedNow")]
                        + [r[k]["folds"]["body"]["folded"] for k in ("refined", "refinedNow")])
        rows.append(["**mean**"] + [f(np.mean([float(row[n]) for row in rows]), 2) for n in range(1, 10)]
                    + [f(np.mean([row[n] for row in rows]), 1) for n in range(10, 14)])
        table(["Target", "Face: recipe", "saved", "now", "Head shape alone: recipe", "saved", "now",
               "Face shape alone: recipe", "saved", "now", "Head folds: saved", "now", "Body folds: saved", "now"], rows)


if __name__ == "__main__":
    main()
