"""Print the head study's numbers as Markdown tables for docs/head-scan-study.md.

Usage: python scripts/head-study/tables.py CACHE [--label NAME]

Only measurements are printed. Recipes, corrections and pictures stay in the cache.
"""

import json
import sys
from pathlib import Path

from run import results_path

STAGES = (("default", "Default head"), ("editor recipe fit", "Editor recipe fit"), ("recipe fit", "Head recipe fit"),
          ("corrected x1", "Recipe + correction"), ("corrected x3", "Recipe + correction, three runs"))
REGIONS = ("brow and forehead", "eyes", "nose", "mouth", "cheeks", "chin and jaw", "ears", "cranium", "neck")


def table(header, rows):
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join(["---"] + ["---:"] * (len(header) - 1)) + " |"]
    return "\n".join(lines + ["| " + " | ".join(row) + " |" for row in rows])


def main(cache, label):
    results = json.loads(results_path(cache, label).read_text(encoding="utf-8"))
    print("Generator version", results["generator_sha256"][:12], "\n")
    print(len(results["head_axes"]), "head axes:", ", ".join(results["head_axes"]), "\n")
    for name, target in results["targets"].items():
        stages = target["stages"]
        print(f"### {target['title']}\n")
        rows = []
        for key, title in STAGES:
            s = stages[key]
            head, face, line = s["regions"]["head"], s["regions"]["face"], s["midline_profile"]
            rows.append([title, f"{head['two_way_mean_mm']:.2f}", f"{face['two_way_mean_mm']:.2f}",
                         f"{max(face['generated_to_scan_p95_mm'], face['scan_to_generated_p95_mm']):.1f}",
                         f"{100 * face['within_1mm']:.0f}%", f"{face['normal_angle_mean_deg']:.1f}",
                         f"{line['mean_mm']:.2f}", f"{line['max_mm']:.1f}"])
        print(table(["Stage", "Head", "Face", "Face 95th pct", "Face within 1 mm", "Face normals (degrees)", "Midline", "Midline max"], rows), "\n")

        keys = ("default", "recipe fit", target["chosen"])
        rows = []
        for region in REGIONS:
            if region not in stages["default"]["regions"]:
                continue
            note = f" ({target['not_skin'][region]})" if region in target["not_skin"] else ""
            row = [region.capitalize() + note]
            for key in keys:
                r = stages[key]["regions"][region]
                row.append(f"{r['two_way_mean_mm']:.2f} ({r['signed_mean_mm']:+.2f})")
            rows.append(row)
        print(table(["Region", "Default", "Head recipe fit", "Recipe + correction"], rows), "\n")

        rows = []
        for band in ("forehead and brow", "nose", "lips", "chin"):
            rows.append([band.capitalize()] + [f"{stages[key]['midline_profile']['bands'][band]['mean_mm']:.2f}" for key in keys])
        print(table(["Midline band", "Default", "Head recipe fit", "Recipe + correction"], rows), "\n")

        recipe = stages["recipe fit"]["recipe"]
        limit = sorted(k for k, v in recipe.items() if abs(v) >= 0.999 or (k == "age" and v >= 0.999))
        strong = sorted(k for k, v in recipe.items() if 0.7 <= abs(v) < 0.999)
        print(f"Recipe: {sum(abs(v) > 0.02 for v in recipe.values())} axes moved, at their limit: {', '.join(limit) or 'none'}; "
              f"beyond 0.7: {', '.join(strong) or 'none'}. Scan scale {stages['recipe fit']['placement']['scale']:.3f}.")
        for key in ("corrected x1", "corrected x3"):
            c = stages[key]["correction"]
            editor = c["editor_reports"][-1]["metrics"]
            print(f"{key}: {c['controls']} controls, mean offset {c['mean_offset_mm']:.2f} mm, largest {c['max_offset_mm']:.1f} mm, "
                  f"{c['at_limit']} at the limit, folds {c['folds']['past_perpendicular']} of {c['folds']['triangles']} triangles, "
                  f"roughness {c['roughness_mm']:.3f} mm; editor's own probe {editor['before']['meanMm']:.2f} -> {editor['after']['meanMm']:.2f} mm"
                  + (f", editor fold count {editor['headDistortion']['pastPerpendicular']}" if "headDistortion" in editor else ""))
        e = stages["editor recipe fit"].get("editor_metrics")
        if e:
            print(f"editor recipe fit, its own probe: {e['before']['meanMm']:.2f} -> {e['after']['meanMm']:.2f} mm")
        print()


if __name__ == "__main__":
    arguments, label = sys.argv[1:], ""
    if "--label" in arguments:
        label = arguments.pop(arguments.index("--label") + 1)
        arguments.remove("--label")
    main(Path(arguments[0]), label)
