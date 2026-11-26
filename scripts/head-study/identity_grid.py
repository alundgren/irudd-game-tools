"""Compare each fitted face with every reference after aligning three facial landmarks.

Run: python scripts/head-study/identity_grid.py LOCAL/studies.json LOCAL/result.json
The manifest is a list of {id, target, before, after}. Each path names a local
NumPy archive with vertices in metres, triangle faces and three 3D landmarks:
outer eye corners in image-left/image-right order and the front of the chin.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from scipy.optimize import linear_sum_assignment

import _paths
from hb_raster import rasterize, view_basis
from surface_relief import depth_detail


def normalized(vertices, landmarks):
    left, right, chin = landmarks
    center = (left + right) / 2
    horizontal = right - left
    span = np.linalg.norm(horizontal)
    if span < 1e-5:
        raise ValueError("The two eye landmarks coincide.")
    horizontal = horizontal / span
    down = chin - center
    down -= down.dot(horizontal) * horizontal
    if np.linalg.norm(down) < 1e-5:
        raise ValueError("Eye and chin landmarks must be distinct and non-collinear.")
    up = -down / np.linalg.norm(down)
    toward = np.cross(horizontal, up)
    return (vertices-center) @ np.stack([horizontal,up,toward]).T * (.092/span)


def captures(path):
    with np.load(path) as source:
        vertices = normalized(source["vertices"],source["landmarks"])
        faces = source["faces"]
    records = []
    for angle in (0,35,-35):
        basis = view_basis(angle)
        _, _, depths = rasterize(vertices,faces,basis,np.array([0,-.035,0]),1400,192,210)
        records.append(depths)
    return records


def shared_crops(views):
    yy,xx = np.indices(views[0][0].shape)
    mask = ((xx-95.5)/71)**2 + ((yy-104.5)/95)**2 < 1
    masks = [mask & np.logical_and.reduce([np.isfinite(c) for c in angle]) for angle in zip(*views)]
    coverage = [round(float(m.sum()/mask.sum()),4) for m in masks]
    if min(coverage) < .75:
        raise ValueError("Under 75% of the facial crop is visible on every mesh. Check the landmarks and missing surfaces.")
    return masks, coverage


def distance(candidate, reference, masks):
    means = []
    for a,b,shared in zip(candidate,reference,masks):
        delta = 1000*(a[shared]-b[shared])
        offset = np.median(delta)
        means.append(float(np.mean(np.minimum(np.abs(delta-offset),15))))
    return float(np.mean(means))


def relative_identity(candidates, targets, masks, ids):
    """Compare the signed depth change between two people on each mesh family.

    A shared template bias cancels. A positive cosine means that where the
    second subject projects farther forward, the fit tends to do the same.
    Report amplitude separately: arbitrarily tiny differences can point the
    right way while the two generated heads still look virtually identical.
    """
    def difference(first, second):
        views = []
        for a, b, mask in zip(first, second, masks):
            delta = 1000 * (b[mask] - a[mask])
            delta -= np.median(delta)
            views.append(np.clip(delta, -15, 15) / np.sqrt(delta.size))
        return np.concatenate(views)

    pairs = []
    for i, subject in enumerate(ids):
        for j in range(i + 1, len(ids)):
            source = difference(targets[i], targets[j])
            fitted = difference(candidates[i], candidates[j])
            length = np.linalg.norm(source)
            size = np.linalg.norm(fitted)
            cosine = None
            if length > 1e-6 and size > 1e-6:
                cosine = round(float(np.dot(source, fitted) / (length * size)), 4)
            pairs.append({"subjects":[subject, ids[j]], "cosine":cosine,
                          "depthAmplitudeRatio":round(float(size/length), 4) if length > 1e-6 else None})
    def median(key):
        values = [row[key] for row in pairs if row[key] is not None]
        return round(float(np.median(values)), 4) if values else None

    return {"pairs":pairs, "medianCosine":median("cosine"),
            "medianAmplitudeRatio":median("depthAmplitudeRatio")}


def run(manifest):
    rows = json.loads(manifest.read_text(encoding="utf8"))
    ids = [row["id"] for row in rows]
    if len(ids) < 2 or len(set(ids)) != len(ids):
        raise ValueError("Supply at least two distinct source identities.")
    targets = [captures(manifest.parent / row["target"]) for row in rows]
    result = {"ids":ids,"unit":"mm after scaling to 92 mm between outer eye corners",
              "viewsDegrees":[0,35,-35],"saturatedAtMm":15}
    trials = {mode:[captures(manifest.parent/row[mode]) for row in rows] for mode in ("before","after")}
    masks, result["commonCropFraction"] = shared_crops(targets + trials["before"] + trials["after"])
    for mode, candidates in trials.items():
        matrix = []
        for views in candidates:
            matrix.append([round(distance(views,target,masks),4) for target in targets])
        ranks = [1+sum(x < scores[i] for x in scores) for i,scores in enumerate(matrix)]
        _, assignment = linear_sum_assignment(matrix)
        result[mode] = {"matrix":matrix,"trueRank":ranks,"identified":sum(r==1 for r in ranks),
                        "forcedAssignment":[ids[j] for j in assignment],
                        "forcedCorrect":int(np.sum(assignment == np.arange(len(ids)))),
                        "relativeShape":relative_identity(candidates, targets, masks, ids)}
    detail = []
    for i, subject in enumerate(ids):
        for j, angle in enumerate(result["viewsDegrees"]):
            support, scores = depth_detail(targets[i][j], [trials[mode][i][j] for mode in ("before", "after")], masks[j], 1400)
            detail.append({"subject":subject, "viewDegrees":angle, **support, "before":scores[0], "after":scores[1]})
    result["surfaceDetail"] = detail
    return result


if __name__=="__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest",type=Path)
    parser.add_argument("out",type=Path)
    args = parser.parse_args()
    results = run(args.manifest)
    args.out.write_text(json.dumps(results,indent=2)+"\n",encoding="utf8")
    for mode in ("before","after"):
        print(mode, results[mode]["trueRank"], flush=True)
