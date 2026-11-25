"""Score the saved fitted recipes again with the generator and correction tool as they are now.

    python scripts/human-benchmark/replay.py [--targets mhr-f1,mhr-m1]

Nothing is refitted in the recipe stage. For each file in examples/human-targets-fits/
the saved recipe is generated with the current character-view/human-surface.js and scored
three ways: on its own, with the saved surface correction, and with a surface correction
made now by the current fitHumanReference. Results go to
docs/media/human-benchmark/replay.json and the new corrections to
examples/human-targets-fits/current/. tables.py prints them beside the recorded numbers.
"""

import argparse
import json
from pathlib import Path

import numpy as np

from hb_fit import target_in_generator_frame
from hb_generator import Generator
from hb_gpu import renderer_name
from hb_metrics import Body, compare, folded_faces
from hb_targets import load_manifest, load_target

ROOT = Path(__file__).resolve().parents[2]
MEDIA = ROOT / "docs" / "media" / "human-benchmark"
FITS = ROOT / "examples" / "human-targets-fits"


def brief(metrics):
    out = {"chamfer": metrics["chamfer"], "hausdorff95": metrics["hausdorff95"],
           "meanSignedOffset": metrics["meanSignedOffset"],
           "regions": {name: r["chamfer"] for name, r in metrics["regions"].items()}}
    if "face" in metrics:
        out["face"] = {"chamfer": metrics["face"]["chamfer"], "shapeAlone": metrics["face"]["local"]["chamfer"]}
        out["headShapeAlone"] = metrics["regions"]["head"]["local"]["chamfer"]
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--targets")
    args = parser.parse_args()
    manifest = load_manifest()
    generator = Generator()
    out = {"replayedWith": generator.source_sha256, "rasterizer": renderer_name(), "axes": generator.axes, "targets": {}}
    (FITS / "current").mkdir(parents=True, exist_ok=True)
    for entry in manifest["targets"]:
        path = FITS / f"{entry['id']}.json"
        if not path.exists() or (args.targets and entry["id"] not in args.targets.split(",")):
            continue
        saved = json.loads(path.read_text())
        out["fittedWith"] = saved["generatorSourceSha256"]
        vertices, faces, regions, names = load_target(entry, manifest)
        target = Body(vertices, faces, seed=1, vertex_region=regions, region_names=names)
        placement = np.array(saved["placement"])
        reply = generator.refine(saved["human"], target_in_generator_frame(target.vertices, placement),
                                 target.faces[target.visible])
        (FITS / "current" / path.name).write_text(json.dumps({
            "target": "../" + saved["target"], "license": saved["license"],
            "generatorSourceSha256": generator.source_sha256,
            "note": "The recipe is the one fitted earlier (see ../" + path.name + "); humanFit was made again "
                    "with the correction tool of the generator version named here.",
            "human": saved["human"], "humanFit": reply["fit"], "placement": saved["placement"],
        }, separators=(",", ":")) + "\n")
        surfaces = generator.evaluate([saved["human"]] * 3, [None, saved["humanFit"], reply["fit"]])
        row = {}
        for index, kind in enumerate(("coarse", "refined", "refinedNow")):
            # Same sample seeds as run.py uses for the first two candidates.
            metrics, detail = compare(Body(surfaces[index], generator.faces, seed=102 + min(index, 1)), target)
            row[kind] = brief(metrics)
            if index == 0:
                centres = detail["moved"].vertices[generator.faces].mean(1)
                _, _, nearest, _ = target.surface.closest(centres)
                head = target.face_region[nearest] == names.index("head")
            else:
                row[kind]["folds"] = {"head": folded_faces(surfaces[0], surfaces[index], generator.faces, head),
                                      "body": folded_faces(surfaces[0], surfaces[index], generator.faces, ~head)}
            print(entry["id"], kind, row[kind]["chamfer"], row[kind].get("face"), row[kind].get("folds"), flush=True)
        row["toolMetrics"] = reply["metrics"]
        out["targets"][entry["id"]] = row
    generator.close()
    (MEDIA / "replay.json").write_text(json.dumps(out, indent=1) + "\n")


if __name__ == "__main__":
    main()
