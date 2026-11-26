"""Audit finger contact on the presented dispatch handle of a workshop game GLB.

python scripts/measure-dispatch.py exported.glb
Requires NumPy and SciPy, as used by measure-garments.py.
"""
import argparse
import hashlib
import json
import runpy
from pathlib import Path

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

geometry = runpy.run_path(str(Path(__file__).with_name("measure-garments.py")))
WorkshopMesh = geometry["WorkshopMesh"]
edge_hits = geometry["edge_hits"]


def shaft_faces(mesh):
    faces = mesh.region_faces("gear dispatch handle")
    points = mesh.rest[faces].reshape(-1, 3)
    points, indices = np.unique(points.round(5), axis=0, return_inverse=True)
    ids = indices.reshape(-1, 3)
    rows = ids.flatten()
    cols = ids[:, [1, 2, 0]].flatten()
    graph = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(len(points), len(points)))
    _, labels = connected_components(graph, directed=False)
    spans = [np.linalg.norm(np.ptp(points[labels == c], axis=0)) for c in range(labels.max() + 1)]
    return faces[labels[ids[:, 0]] == np.argmax(spans)]


def contact(surface, shaft, center, axis):
    low, high = surface.min(axis=1), surface.max(axis=1)
    hits, contact_points = set(), []
    for face in shaft:
        selected = np.flatnonzero(np.all(low <= face.max(axis=0) + 1e-7, axis=1)
                                  & np.all(high >= face.min(axis=0) - 1e-7, axis=1))
        if not len(selected):
            continue
        a, b = surface[selected], np.broadcast_to(face, (len(selected), 3, 3))
        for valid, points in edge_hits(a, b) + edge_hits(b, a):
            hits.update(selected[valid])
            contact_points.extend(points[valid])
    if not contact_points:
        return 0, None
    offset = np.unique(np.round(contact_points, 6), axis=0).mean(axis=0) - center
    radial = offset - axis * np.dot(axis, offset)
    return len(hits), radial / max(1e-12, np.linalg.norm(radial))


def audit(path):
    mesh = WorkshopMesh(path)
    parents = {child: i for i, n in enumerate(mesh.nodes) for child in n.get("children", [])}
    joint = next(i for i, n in enumerate(mesh.nodes) if n.get("extras", {}).get("region") == "gear dispatch tube")
    carrier = mesh.nodes[parents[joint]].get("extras", {}).get("region")
    report = {"file": Path(path).name, "sha256": hashlib.sha256(Path(path).read_bytes()).hexdigest(),
              "tubeCarrier": carrier, "triangles": len(mesh.triangles)}
    if " hand" not in carrier:
        report["samples"] = []
        return report
    shaft = shaft_faces(mesh)
    digits = sorted({n["extras"]["digit"] for n in mesh.nodes
                     if n.get("extras", {}).get("region") == carrier and n["extras"].get("digit")})
    faces = mesh.region_faces(carrier)
    finger_faces = {}
    for digit in digits:
        weights = mesh.influence(lambda n: n.get("extras", {}).get("region") == carrier and n["extras"].get("digit") == digit)
        finger_faces[digit] = faces[weights[faces].mean(axis=1) > .35]
    samples = [("Rest", None, 0)]
    for clip in mesh.gltf["animations"]:
        if clip["name"] in ["Walk", "Reach", "Offer dispatch"] or clip["name"].endswith("Present dispatch"):
            samples.extend((clip["name"], clip, phase) for phase in (0, .25, .5, .75))
    report["rodTriangles"] = len(shaft)
    report["samples"] = []
    for name, clip, phase in samples:
        vertices = mesh.pose(clip, phase) if clip else mesh.rest
        points = np.unique(vertices[shaft].reshape(-1, 3).round(6), axis=0)
        center = points.mean(axis=0)
        axis = np.linalg.svd(points - center, full_matrices=False)[2][0]
        contacts = {digit: contact(vertices[f], vertices[shaft], center, axis) for digit, f in finger_faces.items()}
        thumb = contacts["Thumb"][1]
        angles = [float(np.degrees(np.arccos(np.clip(np.dot(thumb, direction), -1, 1))))
                  for digit, (_, direction) in contacts.items() if digit != "Thumb" and direction is not None and thumb is not None]
        report["samples"].append({"clip": name, "phase": phase, "crossedDigitTriangles": {d: count for d, (count, _) in contacts.items()},
                                  "maxOppositionDegrees": round(max(angles), 1) if angles else None})
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("glb")
    print(json.dumps(audit(parser.parse_args().glb), indent=2))
