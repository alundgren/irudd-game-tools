"""Measure garment intersections or contact between named regions in a workshop GLB.

Usage: python scripts/measure-garments.py model.glb --garments cape tabard
Requires NumPy and SciPy. The inputs are the binary meshes and animation clips
exported by the workshop. Results are lengths of triangle intersection curves,
in metres, counting both sewn fabric surfaces.
"""
import argparse
import itertools
import json
import re
import struct
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation, Slerp


class WorkshopMesh:
    def __init__(self, filename):
        data = Path(filename).read_bytes()
        if data[:4] != b"glTF":
            raise ValueError("Choose a binary glTF model.")
        length = struct.unpack_from("<I", data, 12)[0]
        self.gltf = json.loads(data[20:20 + length])
        self.binary = data[28 + length:]
        self.nodes = self.gltf["nodes"]
        node = next(node for node in self.nodes if node.get("name") == "Character surface")
        skin = self.gltf["skins"][node["skin"]]
        self.joints = skin["joints"]
        self.inverse_bind = self.read(skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
        primitive, = self.gltf["meshes"][node["mesh"]]["primitives"]
        attrs = primitive["attributes"]
        self.region_names = node.get("extras", {}).get("regionNames", [])
        self.region_indices = self.read(attrs["_REGION"]).ravel() if "_REGION" in attrs else None
        self.rest = self.read(attrs["POSITION"])
        self.triangles = self.read(primitive["indices"]).reshape(-1, 3)
        self.indices = self.read(attrs["JOINTS_0"])
        self.weights = self.read(attrs["WEIGHTS_0"])

    def read(self, index):
        acc = self.gltf["accessors"][index]
        view = self.gltf["bufferViews"][acc["bufferView"]]
        dtype = np.dtype({5121: "u1", 5123: "<u2", 5125: "<u4", 5126: "<f4"}[acc["componentType"]])
        count = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[acc["type"]]
        array = np.ndarray(
            (acc["count"], count), dtype=dtype, buffer=self.binary,
            offset=acc.get("byteOffset", 0) + view.get("byteOffset", 0),
            strides=(view.get("byteStride", dtype.itemsize * count), dtype.itemsize),
        )
        return array.astype(float) / np.iinfo(dtype).max if acc.get("normalized") else array

    def influence(self, predicate):
        selected = np.array([predicate(self.nodes[j]) for j in self.joints], dtype=bool)
        return (selected[self.indices] * self.weights).sum(axis=1)

    def region_faces(self, name):
        if self.region_indices is not None and name in self.region_names:
            mask = self.region_indices[self.triangles] == self.region_names.index(name)
            return self.triangles[mask.sum(axis=1) >= 2]
        influence = self.influence(lambda n: n.get("extras", {}).get("region") == name)
        return self.triangles[influence[self.triangles].mean(axis=1) > .8]

    def pose(self, clip, phase):
        pose = [
            {key: node.get(key, default) for key, default in [
                ("translation", [0, 0, 0]), ("rotation", [0, 0, 0, 1]), ("scale", [1, 1, 1])]}
            for node in self.nodes
        ]
        time = phase * max(self.read(s["input"]).max() for s in clip["samplers"])
        for channel in clip["channels"]:
            target = channel["target"]
            path = target["path"]
            if path == "weights":
                continue  # The garment mesh has no facial expression targets.
            sampler = clip["samplers"][channel["sampler"]]
            if sampler.get("interpolation", "LINEAR") != "LINEAR":
                raise ValueError("This audit supports the workshop's linearly keyed animation clips.")
            times = self.read(sampler["input"])[:, 0]
            values = self.read(sampler["output"])
            t = np.clip(time, times[0], times[-1])
            lo = int(np.searchsorted(times, t, side="right")) - 1
            hi = min(lo + 1, len(times) - 1)
            if hi == lo:
                value = values[lo]
            elif path == "rotation":
                pairs = [lo, hi]
                value = Slerp(times[pairs], Rotation.from_quat(values[pairs]))([t]).as_quat()[0]
            else:
                mix = (t - times[lo]) / (times[hi] - times[lo])
                value = values[lo] + mix * (values[hi] - values[lo])
            pose[target["node"]][path] = value

        worlds = {}
        def walk(index, parent):
            node = pose[index]
            local = np.eye(4)
            local[:3, :3] = Rotation.from_quat(node["rotation"]).as_matrix() @ np.diag(node["scale"])
            local[:3, 3] = node["translation"]
            worlds[index] = parent @ local
            for child in self.nodes[index].get("children", []):
                walk(child, worlds[index])
        for root in self.gltf["scenes"][self.gltf.get("scene", 0)]["nodes"]:
            walk(root, np.eye(4))
        transforms = np.array([worlds[j] for j in self.joints]) @ self.inverse_bind
        blended = (transforms[self.indices] * self.weights[:, :, None, None]).sum(axis=1)
        return (blended[:, :3, :3] @ self.rest[:, :, None])[:, :, 0] + blended[:, :3, 3]


def edge_hits(source, target):
    """Intersect the three finite edges of each source triangle with its paired target."""
    ab = target[:, 1] - target[:, 0]
    ac = target[:, 2] - target[:, 0]
    results = []
    for i in range(3):
        start = source[:, i]
        direction = source[:, (i + 1) % 3] - start
        p = np.cross(direction, ac)
        det = (ab * p).sum(axis=1)
        valid = np.abs(det) > 1e-13
        divisor = np.where(valid, det, 1)
        offset = start - target[:, 0]
        u = (offset * p).sum(axis=1) / divisor
        q = np.cross(offset, ab)
        v = (direction * q).sum(axis=1) / divisor
        along = (ac * q).sum(axis=1) / divisor
        inside = valid & (u >= -1e-7) & (v >= -1e-7) & (u + v <= 1 + 1e-7)
        inside &= (along >= -1e-7) & (along <= 1 + 1e-7)
        results.append((inside, start + direction * along[:, None]))
    return results


def crossings(cloth, arms):
    """Count crossed fabric triangles and sum non-coplanar intersection lengths."""
    if not len(cloth) or not len(arms):
        return 0, 0.0
    centers = cloth.mean(axis=1)
    body_centers = arms.mean(axis=1)
    radii = np.linalg.norm(cloth - centers[:, None], axis=2).max(axis=1)
    max_body_radius = np.linalg.norm(arms - body_centers[:, None], axis=2).max()
    nearby = cKDTree(body_centers).query_ball_point(centers, radii + max_body_radius + 1e-6)
    counts = [len(row) for row in nearby]
    if not any(counts):
        return 0, 0.0
    i = np.repeat(np.arange(len(cloth)), counts)
    j = np.concatenate([row for row in nearby if len(row)]).astype(int)
    overlap = (cloth[i].min(axis=1) <= arms[j].max(axis=1) + 1e-7).all(axis=1)
    overlap &= (arms[j].min(axis=1) <= cloth[i].max(axis=1) + 1e-7).all(axis=1)
    i, j = i[overlap], j[overlap]
    hits = edge_hits(cloth[i], arms[j]) + edge_hits(arms[j], cloth[i])
    distance = np.zeros(len(i))
    for h, (present, start) in enumerate(hits):
        for other, end in hits[h + 1:]:
            chord = np.linalg.norm(start - end, axis=1)
            distance = np.maximum(distance, np.where(present & other, chord, 0))
    valid = distance > 1e-6
    return len(np.unique(i[valid])), float(distance[valid].sum())


def measure(filename, garments, samples):
    mesh = WorkshopMesh(filename)
    def region(node):
        return node.get("extras", {}).get("region", node["name"]).lower()
    fabric = {name: mesh.influence(lambda n: region(n) == name.lower()) for name in garments}
    # Some cloth vertices also follow arm joints. Their original garment joint
    # retains an influence, so they stay out of the set of wearer triangles.
    garment_membership = np.maximum.reduce(list(fabric.values()))
    arm_membership = mesh.influence(lambda n: bool(re.search(r"arm|hand|palm|finger|thumb", region(n))))
    triangles = mesh.triangles
    arms = triangles[(arm_membership[triangles].mean(axis=1) > .55) &
                     (garment_membership[triangles].max(axis=1) < .003)]
    if not len(arms):
        raise ValueError("Could not identify arm geometry in this workshop export.")
    selected = {name: triangles[w[triangles].min(axis=1) > .003] for name, w in fabric.items()}
    if any(not len(faces) for faces in selected.values()):
        raise ValueError("Choose visible garment region IDs from this particular export.")
    result = {"samplesPerClip": samples, "armTriangles": len(arms), "garments": {}, "clips": {}}
    for name, faces in selected.items():
        pts = mesh.rest[faces]
        area = .5 * np.linalg.norm(np.cross(pts[:, 1] - pts[:, 0], pts[:, 2] - pts[:, 0]), axis=1).sum()
        result["garments"][name] = {"triangles": len(faces), "twoSidedAreaM2": round(float(area), 4)}
    for clip in mesh.gltf["animations"]:
        metrics = {name: [] for name in garments}
        for i in range(samples):
            p = mesh.pose(clip, i / samples)
            for name, faces in selected.items():
                count, length = crossings(p[faces], p[arms])
                metrics[name].append({"triangles": count, "lengthM": round(length, 5)})
        result["clips"][clip["name"]] = metrics
    return result


def contact_report(filename, pairs, samples):
    mesh = WorkshopMesh(filename)
    faces = [(mesh.region_faces(child), mesh.region_faces(parent)) for child, parent in pairs]
    if any(not len(a) or not len(b) for a, b in faces):
        raise ValueError("A named region could not be identified in this export.")
    clips = {}
    for clip in [None, *mesh.gltf.get("animations", [])]:
        rows = [[] for pair in pairs]
        for phase in (np.arange(samples) / samples if clip else [0]):
            vertices = mesh.pose(clip, phase) if clip else mesh.rest
            for row, (a, b) in zip(rows, faces):
                count, _ = crossings(vertices[a], vertices[b])
                row.append(count)
        clips[clip["name"] if clip else "Rest"] = rows
    return {"pairs": pairs, "faceSelection": "region attribute" if mesh.region_indices is not None else "joint influence",
            "measure": "intersecting child triangles per sampled pose", "clips": clips}


def arm_motion_report(filename, recipe, samples):
    """Check other arms and the torso at fixed phases in the exported moving mesh."""
    mesh = WorkshopMesh(filename)
    parts = json.loads(Path(recipe).read_text(encoding="utf-8"))["form"]["parts"]
    children = {}
    for part in parts:
        children.setdefault(part.get("parent"), []).append(part)

    def role(part):
        return part.get("motionRole", part.get("outfitRole"))

    def child(part, wanted):
        return next((p for p in children.get(part["id"], []) if role(p) == wanted), None)

    chains, torso_pairs = [], []
    for upper in parts:
        if role(upper) != "upper arm" or upper["id"] not in mesh.region_names:
            continue
        lower = child(upper, "forearm")
        hand = child(lower or upper, "hand")
        if not hand or hand["id"] not in mesh.region_names:
            continue
        members = [p["id"] for p in (upper, lower, hand) if p]
        for limb in (upper, lower):
            if limb:
                members.extend(p["id"] for p in children.get(limb["id"], [])
                               if role(p) == "rigid" and p["id"] in mesh.region_names)
        chains.append(members)
        if upper.get("parent") in mesh.region_names:
            torso_pairs.extend((p["id"], upper["parent"]) for p in (lower, hand) if p)

    if len(chains) < 2:
        raise ValueError("Choose a matching recipe and GLB with two or more named arm and hand chains.")
    arm_pairs = [(a, b) for left, right in itertools.combinations(chains, 2)
                 for a in left for b in right]
    all_pairs = arm_pairs + torso_pairs
    regions = {part: mesh.region_faces(part) for pair in all_pairs for part in pair}
    if any(not len(tris) for tris in regions.values()):
        raise ValueError("The recipe contains an arm region missing from the triangulated mesh.")

    def frame_hits(vertices, pairs):
        geometry = {name: vertices[faces] for name, faces in regions.items()}
        bounds = {name: (tris.min(axis=(0, 1)), tris.max(axis=(0, 1))) for name, tris in geometry.items()}
        hits = []
        for a, b in pairs:
            lo, hi = bounds[a]
            other_lo, other_hi = bounds[b]
            if np.any(lo > other_hi) or np.any(other_lo > hi):
                continue
            count, _ = crossings(geometry[a], geometry[b])
            if count:
                hits.append([a, b, count])
        return hits

    clips = {}
    for clip in [None, *mesh.gltf.get("animations", [])]:
        name = clip["name"] if clip else "Rest"
        count = samples if clip and not name.startswith("Pose ") else 1
        frames = []
        for phase in np.arange(count) / count:
            vertices = mesh.pose(clip, phase) if clip else mesh.rest
            hits = frame_hits(vertices, all_pairs)
            frames.append({"phase": phase, "crossings": hits})
        clips[name] = frames
    return {"chains": chains, "crossArmPairs": arm_pairs, "distalArmToCarrierPairs": torso_pairs,
            "measure": "Each crossing is the region pair and number of intersecting triangles of its first region.",
            "clips": clips}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", type=Path)
    parser.add_argument("--garments", nargs="+", default=["cape", "tabard"])
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--arm-motion", type=Path, metavar="FORM", help="Check arm crossings in an exported form at fixed phases.")
    mode.add_argument("--contact", action="append", nargs=2, metavar=("CHILD", "PARENT"), help="Check physical contact for this pair in rest and each clip. May be repeated.")
    parser.add_argument("--samples", type=int, default=8)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 2 <= args.samples <= 128:
        parser.error("Choose 2–128 samples per clip.")
    if args.arm_motion:
        report = arm_motion_report(args.model, args.arm_motion, args.samples)
    elif args.contact:
        report = contact_report(args.model, args.contact, args.samples)
    else:
        report = measure(args.model, args.garments, args.samples)
    result = json.dumps(report, indent=2)
    if args.output:
        args.output.write_text(result + "\n", encoding="utf-8")
    else:
        print(result)
