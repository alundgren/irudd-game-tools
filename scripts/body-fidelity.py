"""Fit and score workshop figures against standing, white-background scan previews.

From repo root: python scripts/body-fidelity.py CACHE [--fit]
Requires numpy, scipy, opencv-python, requests, Node, and the repo's npm deps.
Downloads reference previews into CACHE. --fit writes fitted parameters there.
Default compares the parameters saved locally in examples/reference-fits.json. CACHE also receives compare.html,
24 privately cached source plates, silhouette overlays and body-fidelity.json.
"""

import argparse
import hashlib
import json
import subprocess
from html import escape
from pathlib import Path

import cv2
import numpy as np
import requests
from scipy.ndimage import binary_erosion, distance_transform_edt
from scipy.optimize import lsq_linear

ROOT = Path(__file__).resolve().parents[1]
ROWS = 96
VIEWS = ("front", "side", "back")
# Degrees, ratios and torso depth multipliers are kept in their native units.
LIMITS = {
    "shoulders": (0.7, 1.4),
    "chest": (0.7, 1.95),
    "waist": (0.7, 2.05),
    "hips": (0.7, 1.85),
    "belly": (0, 1),
    "limbs": (0.7, 1.6),
    "legBuild": (0.65, 1.65),
    "ribDepth": (0.65, 1.9),
    "abdomenDepth": (0.65, 1.9),
    "pelvisDepth": (0.65, 1.9),
    "legs": (0.9, 1.1),
    "arms": (0.88, 1.12),
    "heads": (6, 8.4),
    "neck": (0.75, 1.35),
    "stance.arms": (4, 40),
    "stance.feet": (0.5, 2),
}
BOUNDS = np.array(list(LIMITS.values()))
SPAN = BOUNDS[:, 1] - BOUNDS[:, 0]


def reference_rows(path, side):
    gray = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if gray is None:
        raise ValueError(f"Unreadable preview: {path}")
    _, labels, stats, _ = cv2.connectedComponentsWithStats((gray < 222).astype("uint8"))
    # The profile plates show left and right. Choose the right-facing body.
    bodies = [i for i, (_, _, _, h, _) in enumerate(stats) if i and h > 0.7 * len(gray)]
    if len(bodies) != (2 if side else 1):
        raise ValueError(
            f"Unexpected full-body component count in {path}: {len(bodies)}"
        )
    index = max(bodies, key=lambda i: stats[i, 0])
    x, y, w, h, _ = stats[index]
    # Fill isolated highlight holes, preserving genuine gaps between limbs.
    body = (labels[y : y + h, x : x + w] == index).astype("uint8")
    body = cv2.morphologyEx(body, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    rows = []
    for j in range(ROWS):
        pixels = body[h - 1 - int((j + 0.5) * h / ROWS)]
        cuts = np.flatnonzero(np.diff(np.r_[0, pixels, 0]))
        rows.append((cuts.reshape(-1, 2) / h).tolist())
    return center(rows)


def center(rows):
    # One horizontal translation for the entire view. No per-row recentering,
    # width rescale, nonrigid registration, or pose warp.
    area = sum(b - a for row in rows for a, b in row)
    if area <= 0:
        raise ValueError("Empty silhouette")
    shift = sum((b * b - a * a) / 2 for row in rows for a, b in row) / area
    return [[[a - shift, b - shift] for a, b in row] for row in rows]


def descriptor(rows):
    # At equal height compare the outer edges, occupied width, and three
    # quantiles of the occupied intervals. Open arm and leg gaps influence
    # the result even where two figures share an identical bounding box.
    out = []
    for row in rows:
        if not row:
            out.extend([0] * 6)
            continue
        spans = np.array(row)
        widths = spans[:, 1] - spans[:, 0]
        cumulative = np.cumsum(widths)
        total = cumulative[-1]
        qs = []
        for fraction in (0.2, 0.5, 0.8):
            offset = total * fraction
            i = min(len(row) - 1, np.searchsorted(cumulative, offset))
            qs.append(spans[i, 1] - cumulative[i] + offset)
        out.extend([row[0][0], row[-1][1], total, *qs])
    return np.array(out)


def overlap(actual, target, lo=0, hi=ROWS):
    intersection = union = 0.0
    for a, b in zip(actual[lo:hi], target[lo:hi]):
        common = sum(max(0.0, min(d, f) - max(c, e)) for c, d in a for e, f in b)
        intersection += common
        union += sum(d - c for c, d in a + b) - common
    if union <= 0:
        raise ValueError("Empty comparison region")
    return intersection / union


def arm_overlap(actual, reference):
    # Measure lateral intervals on rows where the reference visibly separates
    # an arm from the torso. Including the gap penalizes a fused arm as well.
    kept_actual, kept_reference = [], []
    for i, (a, b) in enumerate(zip(actual, reference)):
        if not 0.46 < (i + 0.5) / ROWS < 0.73:
            continue
        core = next(((l, r) for l, r in b if l < 0 < r and r - l > 0.08), None)
        if not core:
            continue
        for sign in (-1, 1):
            edge = core[1] if sign == 1 else -core[0]

            def outside(row, sign=sign, edge=edge):
                signed = sorted(
                    (min(l * sign, r * sign), max(l * sign, r * sign)) for l, r in row
                )
                return [
                    [max(l, edge + 0.002), r]
                    for l, r in signed
                    if r > max(l, edge + 0.002)
                ]

            target = outside(b)
            if not target or target[0][0] < edge + 0.004:
                continue
            kept_reference.append(target)
            kept_actual.append(outside(a))
    return (
        overlap(kept_actual, kept_reference, hi=len(kept_reference))
        if kept_reference
        else None
    )


class Workshop:
    def __enter__(self):
        self.process = subprocess.Popen(
            ["node", "scripts/body-sections.mjs"],
            cwd=ROOT,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        )
        return self

    def __exit__(self, *_):
        self.process.stdin.close()
        self.process.wait()

    def project(self, figure, angles, *, raw=False):
        self.process.stdin.write(
            json.dumps({"figure": figure, "rows": ROWS, "angles": angles}) + "\n"
        )
        self.process.stdin.flush()
        result = json.loads(self.process.stdout.readline())
        if "error" in result:
            raise RuntimeError(result["error"])
        return result if raw else list(map(center, result))

    def sample(self, figure):
        front, side = self.project(figure, [0, 90])
        back = [[[-b, -a] for a, b in reversed(row)] for row in front]
        return [front, side, back]


def archetype(key):
    return "female" if key.startswith("f") else "male"


def recipe(key, params):
    gender = archetype(key)
    values = dict(zip(LIMITS, params))
    stance = {
        "arms": values.pop("stance.arms"),
        "feet": values.pop("stance.feet"),
        "elbows": 9,
    }
    return dict(archetype=gender, hair="Bald", height=1.72, stance=stance, **values)


def fit(workshop, key, reference):
    female = archetype(key) == "female"
    start = np.array(
        [0.94, 0.97, 0.96, 1.09, 0, 0.955, 1, 1, 1, 1, 1, 1, 7.4, 0.95, 13, 1]
        if female
        else [1.07, 1.045, 1.035, 0.97, 0, 1.045, 1, 1, 1, 1, 1, 1, 7.4, 1.06, 13, 1]
    )

    def measured(x):
        return np.concatenate(
            [descriptor(v) for v in workshop.sample(recipe(key, x))[:2]]
        )

    target = np.concatenate([descriptor(v) for v in reference[:2]])
    x = start.copy()
    value = measured(x)
    for iteration in range(5):
        # A finite difference over a visible size increment remains useful at
        # arm/body contacts, where an infinitesimal derivative is unstable.
        J = []
        for k, width in enumerate(SPAN):
            delta = width * (0.035 if iteration < 2 else 0.018)
            if x[k] + delta > BOUNDS[k, 1]:
                delta = -delta
            test = x.copy()
            test[k] += delta
            J.append((measured(test) - value) / delta * width)
        # Regularisation biases unobservable depth/width tradeoffs toward the starting figure.
        penalty = 0.09
        matrix = np.vstack((np.array(J).T, penalty * np.eye(len(x))))
        residual = np.r_[target - value, penalty * (start - x) / SPAN]
        delta = (
            lsq_linear(
                matrix,
                residual,
                bounds=(
                    np.maximum((BOUNDS[:, 0] - x) / SPAN, -0.36) - 1e-10,
                    np.minimum((BOUNDS[:, 1] - x) / SPAN, 0.36) + 1e-10,
                ),
            ).x
            * SPAN
        )
        for fraction in (1.0, 0.5, 0.25):
            trial = np.clip(x + delta * fraction, *BOUNDS.T)
            other = measured(trial)
            if np.linalg.norm(target - other) < np.linalg.norm(target - value):
                x, value = trial, other
                break
        else:
            break
    return recipe(key, np.round(x, 4))


# Same normalized heights as sectionHeights in the workshop. A correction is
# estimated from a local band to suppress isolated holes and fingers.
STATIONS = (
    0.035,
    0.11,
    0.20,
    0.29,
    0.38,
    0.47,
    0.54,
    0.61,
    0.68,
    0.75,
    0.81,
    0.86,
    0.92,
    0.97,
)


def refine_sections(workshop, figure, reference):
    original = {k: v for k, v in figure.items() if k != "sectionProfile"}
    projected = workshop.project(original, [0, 90], raw=True)
    columns = []
    for view_index, (raw, ref) in enumerate(zip(projected, reference[:2])):
        centered = center(raw)
        shift = next(a[0][0] - b[0][0] for a, b in zip(raw, centered) if a)
        ratios, offsets = [], []
        for station in STATIONS:
            errors = []
            for j in range(ROWS):
                if abs((j + 0.5) / ROWS - station) > 0.024 or not ref[j] or not raw[j]:
                    continue
                a, b = raw[j][0][0], raw[j][-1][1]
                c, d = ref[j][0][0] + shift, ref[j][-1][1] + shift
                if view_index == 0 and 0.46 < station < 0.80:
                    # A detached arm should not set rib-cage width. When both
                    # plates show the gap, use the wide midline component.
                    def trunk(row, mid):
                        return next(
                            ((l, r) for l, r in row if l <= mid <= r and r - l > 0.075),
                            None,
                        )

                    source_trunk = trunk(ref[j], 0)
                    mesh_trunk = trunk(raw[j], 0)
                    if (
                        source_trunk
                        and mesh_trunk
                        and len(ref[j]) >= 3
                        and len(raw[j]) >= 3
                    ):
                        a, b = mesh_trunk
                        c, d = source_trunk[0] + shift, source_trunk[1] + shift
                if b - a < 0.01:
                    continue
                # Bound the residual deformation so a noisy camera or hairline
                # cannot stretch an entire ring of the mesh.
                scale = np.clip(1 + 0.86 * ((d - c) / (b - a) - 1), 0.74, 1.30)
                offset = np.clip(
                    0.86 * ((c + d) / 2 - (a + b) / 2 * scale), -0.036, 0.036
                )
                errors.append([scale, offset])
            scale, offset = np.median(errors, axis=0) if errors else (1.0, 0.0)
            ratios.append(scale)
            offsets.append(offset)
        columns.extend((ratios, offsets))
    data = np.stack([columns[i] for i in (0, 2, 1, 3)], axis=1)
    return dict(
        original,
        sectionProfile={
            "height": original["height"],
            "stations": np.round(data, 5).tolist(),
        },
    )


def fit_arm_stance(workshop, figure, reference):
    """Recover separated forearms after torso fitting, using only training views."""

    def score(candidate):
        front, side = workshop.project(candidate, [0, 90])
        local = arm_overlap(front, reference[0])
        value = (
            overlap(front, reference[0])
            + overlap(side, reference[1])
            + 0.30 * (local or 0.0)
        )
        return value, local

    best, local = score(figure)
    if local is None or local >= 0.65:
        return figure
    # A little more abduction or a shorter arm can uncover the wrist beside
    # a broad hip. Keep the torso fit fixed while comparing those changes.
    for key, offsets in (
        ("spread", (-9, -4, 4, 9, 16)),
        ("length", (-0.09, -0.045, 0.045, 0.09)),
    ):
        start = figure
        for offset in offsets:
            if key == "spread":
                stance = start["stance"]
                candidate = dict(
                    start,
                    stance=dict(
                        stance, arms=float(np.clip(stance["arms"] + offset, 4, 75))
                    ),
                )
            else:
                candidate = dict(
                    start,
                    arms=float(np.clip(start.get("arms", 1) + offset, 0.88, 1.12)),
                )
            value, _ = score(candidate)
            if value > best + 1e-5:
                figure, best = candidate, value
    return figure


def mask_from_rows(rows, height=480, width=300):
    mask = np.zeros((height, width), bool)
    for j, row in enumerate(rows):
        for a, b in row:
            x1, x2 = np.rint(np.array([a, b]) * height + width / 2).astype(int)
            mask[
                height - (j + 1) * height // ROWS : height - j * height // ROWS,
                max(0, x1) : min(width, x2),
            ] = True
    return mask


def boundary_distances(actual, target):
    # Symmetric 95th percentile boundary distance as a fraction of stature.
    # Boundaries include interior holes, such as the space beside a wrist.
    masks = [mask_from_rows(rows) for rows in (actual, target)]
    edges = [m ^ binary_erosion(m) for m in masks]
    if not all(np.any(e) for e in edges):
        raise ValueError("Empty comparison contour")
    distances = [distance_transform_edt(~b)[a] for a, b in (edges, edges[::-1])]
    return {
        label: round(max(np.percentile(d, q) for d in distances) / len(masks[0]), 4)
        for q, label in [(50, "medianStature"), (95, "p95Stature")]
    }


def draw_comparison(key, target, output, destination):
    # Save derived comparison images locally alongside the downloaded previews.
    # Grey is agreement. Pink extends beyond the fit. Blue extends beyond the scan.
    h, w = 480, 255
    image = np.full((h + 48, w * 4, 3), 245, np.uint8)
    for v, (source, fit) in enumerate(zip(target, output)):
        a, b = [mask_from_rows(rows, h, w) for rows in (source, fit)]
        panel = image[:h, v * w : (v + 1) * w]
        panel[a & b] = (135, 141, 139)
        panel[a & ~b] = (140, 95, 213)
        panel[b & ~a] = (193, 151, 65)
        label = (key.upper() + "  " if v == 0 else "") + (
            "Front",
            "Profile",
            "Rear",
            "Oblique",
        )[v]
        cv2.putText(
            image,
            label,
            (v * w + 15, h + 31),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.65,
            (35, 41, 38),
            1,
            cv2.LINE_AA,
        )
    if not cv2.imwrite(str(destination), image):
        raise OSError(f"Could not write {destination}")


def write_comparison_page(cache, sources):
    cards = []
    for key, source in sources.items():
        plates = "".join(
            f'<figure><img loading="lazy" src="{key}-{view}.jpg" alt="{view} scan plate">'
            f"<figcaption>{view.title()}</figcaption></figure>"
            for view in (*VIEWS, "oblique")
        )
        cards.append(
            f"<section><h2>{key.upper()} &middot; {escape(source['title'])}</h2>"
            f'<p><a href="{escape(source["page"], quote=True)}">Original scan</a></p>'
            f'<div>{plates}</div><img class="overlay" src="{key}-overlay.png" '
            f'alt="Scan and editor silhouette overlap for {key}"></section>'
        )
    head = """<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Scan comparisons</title>
<style>body{max-width:1040px;margin:auto;padding:18px;color:#23352e;font:17px/1.5 system-ui}
h1,h2{font-family:Georgia,serif}section{margin:2em 0;border-top:1px solid #bbc5be}
div{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
img{display:block;width:100%;height:auto}figure{margin:0}a{color:#23634f}
@media(max-width:650px){div{grid-template-columns:1fr 1fr}}</style>
<h1>Scan comparisons</h1><p>Gray marks overlap. Pink is visible only in the reference,
blue only in the editor mesh. The first two projections were used to fit each figure.
The fourth is a nominal 45-degree oblique view.</p>"""
    (cache / "compare.html").write_text(
        head + "".join(cards) + "</html>", encoding="utf8"
    )


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path)
    parser.add_argument("--fit", action="store_true")
    parser.add_argument(
        "--refine",
        action="store_true",
        help="Refine a saved coarse fit in CACHE using only the front and side views.",
    )
    args = parser.parse_args()
    saved = ROOT / "examples/reference-fits.json"
    if not (args.fit or args.refine) and not saved.exists():
        parser.error(
            "examples/reference-fits.json is local reference material and is not installed. "
            "Run with --fit to fit the figures again. See docs/local-references.md."
        )
    args.cache.mkdir(parents=True, exist_ok=True)
    sources = json.loads((ROOT / "examples/body-references.json").read_text())
    parameters = (
        {}
        if args.fit or args.refine
        else json.loads(saved.read_text())
    )
    if args.refine and not args.fit:
        parameters = json.loads((args.cache / "reference-fits.json").read_text())
    references, fits, obliques, report = {}, {}, {}, {}
    with Workshop() as workshop:
        for key, source in sources.items():
            references[key] = []
            for name in (*VIEWS, "oblique"):
                path = args.cache / f"{key}-{name}.jpg"
                if not path.exists():
                    response = requests.get(source["views"][name], timeout=45)
                    response.raise_for_status()
                    path.write_bytes(response.content)
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                if digest != source["sha256"][name]:
                    raise ValueError(
                        f"Source image changed: {path}. Review it against the product page before updating the manifest."
                    )
                references[key].append(reference_rows(path, name == "side"))
            ref = references[key]
            base = workshop.sample(
                {"archetype": archetype(key), "hair": "Bald", "height": 1.72}
            )
            if args.fit:
                parameters[key] = fit(workshop, key, ref)
            if args.fit or args.refine:
                parameters[key].update(source["surface"])
                # Compare a proportion solve and a manually blocked-in figure.
                # Only front and side masks select the candidate.
                block = dict(
                    archetype=archetype(key),
                    height=1.72,
                    hair="Bald",
                    **source["initialFigure"],
                    **source["surface"],
                )
                candidates = [
                    refine_sections(workshop, f, ref) for f in (parameters[key], block)
                ]

                def fit_score(candidate, ref=ref):
                    masks = workshop.project(candidate, [0, 90])
                    return sum(overlap(p, q) for p, q in zip(masks, ref[:2])) + 0.30 * (
                        arm_overlap(masks[0], ref[0]) or 0
                    )

                parameters[key] = fit_arm_stance(
                    workshop, max(candidates, key=fit_score), ref
                )
            coarse = workshop.sample(
                {k: v for k, v in parameters[key].items() if k != "sectionProfile"}
            )
            views = workshop.sample(parameters[key])
            fits[key] = views
            arms = arm_overlap(views[0], ref[0])
            report[key] = {
                "separatedArmsFront": round(arms, 4) if arms is not None else None,
                "default": dict(
                    zip(VIEWS, [round(overlap(p, q), 4) for p, q in zip(base, ref)])
                ),
                "coarse": dict(
                    zip(VIEWS, [round(overlap(p, q), 4) for p, q in zip(coarse, ref)])
                ),
                "fit": dict(
                    zip(VIEWS, [round(overlap(p, q), 4) for p, q in zip(views, ref)])
                ),
                "sideByRegion": {
                    name: round(
                        overlap(views[1], ref[1], round(a * ROWS), round(b * ROWS)), 4
                    )
                    for name, a, b in [
                        ("feet", 0, 0.09),
                        ("legs", 0.09, 0.46),
                        ("trunk", 0.46, 0.82),
                        ("neckAndHead", 0.82, 1),
                    ]
                },
            }

            # Use a fixed nominal yaw. Published previews lack calibrated cameras.
            # Report both neighbouring angles to expose camera uncertainty.
            yaw = source["obliqueDegrees"]
            alt = workshop.project(parameters[key], [yaw, yaw * 2 / 3, yaw * 4 / 3])
            report[key]["oblique"] = {
                "nominal": round(overlap(alt[0], ref[3]), 4),
                "at30": round(overlap(alt[1], ref[3]), 4),
                "at60": round(overlap(alt[2], ref[3]), 4),
                "coarse": round(
                    overlap(
                        workshop.project(
                            {
                                k: v
                                for k, v in parameters[key].items()
                                if k != "sectionProfile"
                            },
                            [yaw],
                        )[0],
                        ref[3],
                    ),
                    4,
                ),
                "default": round(
                    overlap(
                        workshop.project(
                            {"archetype": archetype(key), "hair": "Bald"}, [yaw]
                        )[0],
                        ref[3],
                    ),
                    4,
                ),
                "boundary95Stature": boundary_distances(alt[0], ref[3])["p95Stature"],
            }
            report[key]["boundaries"] = {
                v: boundary_distances(a, b)
                for v, a, b in zip((*VIEWS, "oblique"), [*views, alt[0]], ref)
            }
            report[key]["referenceSHA256"] = source["sha256"]
            obliques[key] = {
                yaw: alt[0],
                -yaw: workshop.project(parameters[key], [-yaw])[0],
            }
            draw_comparison(
                key, ref, [*views, alt[0]], args.cache / f"{key}-overlay.png"
            )
            # Negative control: compress the torso in depth without narrowing
            # it in front view. A whole-body average can conceal this defect.
            flat = dict(
                parameters[key], ribDepth=0.65, abdomenDepth=0.65, pelvisDepth=0.65
            )
            flat_side = workshop.project(flat, [90])[0]
            report[key]["flattenedTrunkSide"] = round(
                overlap(flat_side, ref[1], round(0.46 * ROWS), round(0.82 * ROWS)), 4
            )
            print(
                f"{key}: front {report[key]['fit']['front']:.3f}, profile {report[key]['fit']['side']:.3f}, oblique {report[key]['oblique']['nominal']:.3f}",
                flush=True,
            )
    # Wrong-subject control, evaluated on the untrained view as well.
    for key in fits:
        report[key]["obliqueAgainstAll"] = {
            other: round(
                overlap(obliques[key][sources[other]["obliqueDegrees"]], target[3]), 4
            )
            for other, target in references.items()
        }
        report[key]["rearAgainstAll"] = {
            other: round(overlap(fits[key][2], target[2]), 4)
            for other, target in references.items()
        }
    write_comparison_page(args.cache, sources)
    if args.fit or args.refine:
        (args.cache / "reference-fits.json").write_text(
            json.dumps(parameters, indent=2) + "\n"
        )
    (args.cache / "body-fidelity.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    run()
