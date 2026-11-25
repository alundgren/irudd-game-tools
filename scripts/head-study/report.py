"""Clay pictures of every stage of the head study, from the numbers run.py wrote.

Usage: python scripts/head-study/report.py CACHE [--label NAME] [name ...]

Every picture that shows a scan or a head fitted to one goes to CACHE/pictures/.
The region map, which shows the default editable head alone, is written to
docs/media/head-study/region-map.png, a folder git also ignores. Every panel of a sheet uses the same orthographic
camera, so shapes can be compared by eye and by overlay.
"""

import json
import sys
from pathlib import Path

import cv2
import numpy as np

import hs_targets
from hb_raster import rasterize, shade, view_basis
from hs_fit import Placement, near_faces
from hs_generator import REGIONS, Generator, HeadTopology
from hs_metrics import Scored, profile
from run import fits_path, labelled, results_path

ROOT = Path(__file__).resolve().parents[2]
MEDIA = ROOT / "docs" / "media" / "head-study"  # ignored by git; tracked pages name it without embedding it
VIEWS = (("front", 0, 0), ("profile", 90, 0), ("three-quarter", 38, 8))
INK = (0.16, 0.16, 0.18)
SCAN_INK, HEAD_INK = (0.15, 0.35, 0.85), (0.85, 0.30, 0.15)  # RGB
PALETTE = np.array([[.85, .45, .35], [.35, .55, .85], [.9, .75, .3], [.8, .35, .6], [.45, .75, .45],
                    [.95, .6, .45], [.55, .5, .8], [.7, .7, .7], [.5, .65, .7], [.3, .3, .3]])


def save(path, image):
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), (np.clip(image, 0, 1)[:, :, ::-1] * 255).astype(np.uint8))


def caption(image, text, origin=(14, 30), scale=0.62):
    out = np.ascontiguousarray((image * 255).astype(np.uint8))
    cv2.putText(out, text, origin, cv2.FONT_HERSHEY_SIMPLEX, scale, tuple(int(c * 255) for c in INK), 1, cv2.LINE_AA)
    return out.astype(np.float64) / 255


def heat(signed_m, limit_mm=4.0):
    """Blue: the generated surface lies inside the scan. Red: outside. Grey: no scan surface there."""
    t = np.clip(np.nan_to_num(signed_m) * 1000 / limit_mm, -1, 1)[:, None]
    white, red, blue = np.array([.93, .92, .90]), np.array([.80, .16, .12]), np.array([.13, .32, .78])
    colour = np.where(t > 0, white + t * (red - white), white - t * (blue - white))
    colour[np.isnan(signed_m)] = [.55, .55, .55]
    return colour


def outline(vertices, faces, camera):
    ids, _, _ = rasterize(vertices, faces, *camera)
    contours, _ = cv2.findContours((ids >= 0).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    return contours


def sheets(name, generator, topology, results, cache, folder, run_label=""):
    source, data = hs_targets.SOURCES[name], results["targets"][name]
    blink = 1.0 if data["eyes_closed"] else 0.0
    vertices, faces = hs_targets.load_placed(name, cache)
    stages = data["stages"]
    reference = Placement.from_json(stages["recipe fit"]["placement"])
    scan = reference.apply(vertices)
    fit = json.loads(fits_path(name, cache, run_label).read_text(encoding="utf-8"))["humanFit"]
    smooth = {}
    for key in ("default", "recipe fit", data["chosen"]):
        surface = generator.smooth(stages[key]["recipe"], fit if key == data["chosen"] else None, blink)
        smooth[key] = reference.apply(Placement.from_json(stages[key]["placement"]).inverse(surface))
    final = smooth[data["chosen"]]
    head_ids = np.unique(topology.smooth_faces)
    scan_faces = faces[near_faces(scan, faces, final[head_ids], 0.045)]
    scored = Scored(topology, scan, faces, final, tuple(data["not_skin"]))
    centre = (final[head_ids].min(0) + final[head_ids].max(0)) / 2

    def millimetres(key, group="face"):
        return f"{stages[key]['regions'][group]['two_way_mean_mm']:.2f} mm"

    # 1. All stages from three directions.
    width, height, ppm = 500, 600, 1850.0
    rows = []
    for view, azimuth, elevation in VIEWS:
        camera = (view_basis(azimuth, elevation), centre, ppm, width, height)
        panels = [caption(shade(scan, scan_faces, *camera)[0], "scan")]
        for key, text in (("default", "default head"), ("recipe fit", "recipe fit"), (data["chosen"], "recipe + correction")):
            panels.append(caption(shade(smooth[key], topology.smooth_faces, *camera)[0], f"{text}  face {millimetres(key)}"))
        colours = heat(scored.vertex_signed(final))
        panels.append(caption(shade(final, topology.smooth_faces, *camera, vertex_colors=colours)[0],
                            "error: red fuller, blue flatter, +-4 mm"))
        rows.append(np.concatenate(panels, axis=1))
    save(folder / f"{name}-stages.png", np.concatenate(rows, axis=0))

    # 2. Face close-ups: scan beside the corrected head, then both outlines over each other.
    m, u = topology.landmarks, topology.landmarks["unit"]
    face_centre = np.array([0.0, m["mouth"][1] + 0.55 * u, m["ear"][2] + 0.9 * u])
    width, height, ppm = 640, 760, 3600.0
    rows = []
    for view, azimuth, elevation in VIEWS[:2]:
        camera = (view_basis(azimuth, elevation), face_centre, ppm, width, height)
        a = shade(scan, scan_faces, *camera)[0]
        b = shade(smooth["recipe fit"], topology.smooth_faces, *camera)[0]
        c = shade(final, topology.smooth_faces, *camera)[0]
        over = np.ascontiguousarray((np.full((height, width, 3), 0.97) * 255).astype(np.uint8))
        for mesh, mesh_faces, ink in ((scan, scan_faces, SCAN_INK), (final, topology.smooth_faces, HEAD_INK)):
            cv2.drawContours(over, outline(mesh, mesh_faces, camera), -1, tuple(int(k * 255) for k in ink), 2, cv2.LINE_AA)
        over = caption(over.astype(np.float64) / 255, "outline: scan blue, corrected head red")
        rows.append(np.concatenate([caption(a, f"scan, {view}"), caption(b, "recipe fit"), caption(c, "recipe + correction"), over], axis=1))
    save(folder / f"{name}-face.png", np.concatenate(rows, axis=0))

    # 3. Midline profile curves.
    width, height, ppm = 560, 760, 3600.0
    panels = []
    for key, text in (("recipe fit", "recipe fit"), (data["chosen"], "recipe + correction")):
        numbers, generated, scan_curve = profile(topology, smooth[key], scan, faces)
        image = np.ascontiguousarray(np.full((height, width, 3), 247, dtype=np.uint8))
        for curve, ink in ((scan_curve, SCAN_INK), (generated, HEAD_INK)):
            # Looking at the head's left side: the nose points right.
            x = (curve[:, 0] - face_centre[2]) * ppm + width * 0.42
            y = height / 2 - (curve[:, 1] - face_centre[1]) * ppm
            for px, py in zip(x.astype(int), y.astype(int)):
                cv2.circle(image, (px, py), 1, tuple(int(k * 255) for k in ink[::-1]), -1, cv2.LINE_AA)
        image = image[:, :, ::-1].astype(np.float64) / 255
        panels.append(caption(image, f"{text}: midline {numbers['mean_mm']:.2f} mm mean, {numbers['max_mm']:.1f} max"))
    save(folder / f"{name}-midline.png", caption(np.concatenate(panels, axis=1), "scan blue, editable head red", (14, 56)))


def region_map(generator, topology, folder):
    smooth = generator.smooth({})
    ids = np.unique(topology.smooth_faces)
    centre = (smooth[ids].min(0) + smooth[ids].max(0)) / 2
    panels = [shade(smooth, topology.smooth_faces, view_basis(azimuth, 0), centre, 1850.0, 500, 600,
                    vertex_colors=PALETTE[topology.smooth_region])[0] for azimuth in (0, 90, 180)]
    image = np.ascontiguousarray((np.concatenate(panels, axis=1) * 255).astype(np.uint8))
    for i, name in enumerate(REGIONS):
        cv2.rectangle(image, (14, 14 + 24 * i), (30, 30 + 24 * i), tuple(int(c * 255) for c in PALETTE[i]), -1)
        cv2.putText(image, name, (38, 28 + 24 * i), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (40, 40, 46), 1, cv2.LINE_AA)
    save(folder / "region-map.png", image.astype(np.float64) / 255)


def main(cache, names, label=""):
    results = json.loads(results_path(cache, label).read_text(encoding="utf-8"))
    generator = Generator(labelled(cache, "generator-snapshot", label))
    if generator.source_sha256 != results["generator_sha256"]:
        raise SystemExit("The generator snapshot is not the one the results were measured on. Run run.py again.")
    topology = HeadTopology(generator)
    region_map(generator, topology, MEDIA)
    for name in names:
        if name not in results["targets"] or hs_targets.load_placed(name, cache) is None:
            continue
        sheets(name, generator, topology, results, cache, labelled(cache, "pictures", label), label)
        print("pictures for", name)
    generator.close()


if __name__ == "__main__":
    arguments, label = sys.argv[1:], ""
    if "--label" in arguments:
        label = arguments.pop(arguments.index("--label") + 1)
        arguments.remove("--label")
    main(Path(arguments[0]), arguments[1:] or list(hs_targets.SOURCES), label)
