"""Independent 3D comparison of a candidate body with a target body.

Nothing here knows how the candidate was made. Both meshes are reduced to
their outside-visible surface, sampled uniformly by area, and compared in both
directions with exact point-to-triangle distances. Distances are reported in
millimetres.
"""

import numpy as np
from scipy.spatial import ConvexHull

from hb_mesh import Surface, rigid_fit, sample_surface
from hb_raster import rasterize, view_basis, visible_faces

ARM_REGIONS = ("upper arms", "forearms", "hands")
THRESHOLDS_MM = (5, 10, 20)


class Body:
    """A mesh prepared for comparison: visible faces, a distance structure and surface samples."""

    def __init__(self, vertices, faces, seed, samples=60000, vertex_region=None, region_names=None):
        self.vertices = np.asarray(vertices, dtype=np.float64)
        self.faces = np.asarray(faces, dtype=np.int64)
        self.visible = visible_faces(self.vertices, self.faces)
        self.surface = Surface(self.vertices, self.faces, self.visible)
        self.points, self.sample_face, bary = sample_surface(self.vertices, self.faces, samples, seed, self.visible)
        self.normals = self.surface.smooth_normal(self.sample_face, bary)
        self.stature = float(np.ptp(self.vertices[np.unique(self.faces[self.visible]), 1]))
        self.region_names = region_names
        self.face_region = None
        if vertex_region is not None:
            corners = np.asarray(vertex_region)[self.faces]
            self.face_region = np.where(corners[:, 1] == corners[:, 2], corners[:, 1], corners[:, 0])

    def transformed(self, rotation, translation):
        """The same body moved rigidly; sampling and visibility are reused."""
        other = object.__new__(Body)
        other.__dict__.update(self.__dict__)
        other.vertices = self.vertices @ rotation.T + translation
        other.points = self.points @ rotation.T + translation
        other.normals = self.normals @ rotation.T
        other.surface = Surface(other.vertices, self.faces, self.visible)
        return other


def summary(distance_m):
    d = np.asarray(distance_m) * 1000.0
    if len(d) == 0:
        return None
    return {"mean": round(float(d.mean()), 2), "rms": round(float(np.sqrt((d ** 2).mean())), 2),
            "median": round(float(np.median(d)), 2), "p95": round(float(np.percentile(d, 95)), 2),
            "max": round(float(d.max()), 2)}


def align(candidate, target, iterations=80, points=10000, trim=0.9):
    """Yaw and translation that best lay the candidate on the target (no scale, no tilt).

    Uses closest points in both directions, drops the worst tenth of the pairs each
    round and starts from the bodies as given. Stops once a round moves the candidate
    by less than 0.02 mm. Returns rotation and translation.
    """
    step_c = max(1, len(candidate.points) // points)
    step_t = max(1, len(target.points) // points)
    pc, pt = candidate.points[::step_c], target.points[::step_t]
    rotation, translation = np.eye(3), np.zeros(3)
    for _ in range(iterations):
        moved = pc @ rotation.T + translation
        d1, q1, _, _ = target.surface.closest(moved)
        back = (pt - translation) @ rotation
        d2, q2, _, _ = candidate.surface.closest(back)
        keep1, keep2 = d1 <= np.quantile(d1, trim), d2 <= np.quantile(d2, trim)
        source = np.concatenate([pc[keep1], q2[keep2]])
        goal = np.concatenate([q1[keep1], pt[keep2]])
        previous = moved
        rotation, translation = rigid_fit(source, goal, yaw_only=True)
        if np.abs(pc @ rotation.T + translation - previous).max() < 2e-5:
            break
    return rotation, translation


def _direction(points, normals, surface):
    d, q, face, bary = surface.closest(points)
    other = surface.smooth_normal(face, bary)
    cosine = np.clip(np.einsum("ij,ij->i", normals, other), -1, 1)
    signed = np.einsum("ij,ij->i", points - q, other)
    return d, face, np.degrees(np.arccos(cosine)), signed


def _local_residual(c_pts, t_pts, candidate, target, iterations=8):
    """Residual after one body part is moved rigidly onto its counterpart: local shape only."""
    if len(c_pts) < 50 or len(t_pts) < 50:
        return None
    rotation, translation = np.eye(3), np.zeros(3)
    for _ in range(iterations + 1):
        moved = c_pts @ rotation.T + translation
        d1, q1, _, _ = target.surface.closest(moved)
        back = (t_pts - translation) @ rotation
        d2, q2, _, _ = candidate.surface.closest(back)
        last = (d1, d2)
        rotation, translation = rigid_fit(np.concatenate([c_pts, q2]), np.concatenate([q1, t_pts]))
    d1, d2 = last
    return {"candidateToTarget": summary(d1), "targetToCandidate": summary(d2),
            "chamfer": round(float(d1.mean() + d2.mean()) * 500, 2)}


def compare(candidate, target, aligned=True, local=True):
    """All surface metrics for one candidate and one target. See docs/local-references.md."""
    rotation, translation = align(candidate, target) if aligned else (np.eye(3), np.zeros(3))
    moved = candidate.transformed(rotation, translation)
    d_ct, face_ct, angle_ct, signed_ct = _direction(moved.points, moved.normals, target.surface)
    d_tc, _, angle_tc, signed_tc = _direction(target.points, target.normals, moved.surface)
    out = {
        "alignment": {"yawDegrees": round(float(np.degrees(np.arctan2(rotation[0, 2], rotation[0, 0]))), 3),
                      "translationMm": [round(float(x) * 1000, 2) for x in translation]},
        "candidateToTarget": summary(d_ct),
        "targetToCandidate": summary(d_tc),
        "chamfer": round(float(d_ct.mean() + d_tc.mean()) * 500, 2),
        "hausdorff95": round(float(max(np.percentile(d_ct, 95), np.percentile(d_tc, 95))) * 1000, 2),
        "normalAngleDegrees": round(float((angle_ct.mean() + angle_tc.mean()) / 2), 2),
        "meanSignedOffset": round(float((signed_ct.mean() - signed_tc.mean()) * 500), 2),
        "fscore": {},
    }
    for mm in THRESHOLDS_MM:
        precision, recall = (d_ct < mm / 1000).mean(), (d_tc < mm / 1000).mean()
        out["fscore"][f"{mm}mm"] = round(float(2 * precision * recall / max(precision + recall, 1e-12)), 4)
    detail = {"moved": moved, "candidateDistance": d_ct, "candidateFace": face_ct,
              "targetDistance": d_tc}
    if target.face_region is not None:
        t_region = target.face_region[target.sample_face]
        c_region = target.face_region[face_ct]
        detail["candidateRegion"] = c_region
        out["regions"] = {}
        for index, name in enumerate(target.region_names):
            c, t = c_region == index, t_region == index
            if c.sum() < 20 or t.sum() < 20:
                continue
            row = {"candidateToTarget": summary(d_ct[c]), "targetToCandidate": summary(d_tc[t]),
                   "chamfer": round(float(d_ct[c].mean() + d_tc[t].mean()) * 500, 2),
                   "meanSignedOffset": round(float((signed_ct[c].mean() - signed_tc[t].mean()) * 500), 2)}
            if local:
                row["local"] = _local_residual(moved.points[c], target.points[t], moved, target)
            out["regions"][name] = row
        head = target.region_names.index("head")
        c = (c_region == head) & (moved.normals[:, 2] > 0.3)
        t = (t_region == head) & (target.normals[:, 2] > 0.3)
        if local and c.sum() >= 50 and t.sum() >= 50:
            out["face"] = {"chamfer": round(float(d_ct[c].mean() + d_tc[t].mean()) * 500, 2),
                           "local": _local_residual(moved.points[c], target.points[t], moved, target)}
    return out, detail


def _hull_perimeter(points_2d):
    if len(points_2d) < 3:
        return 0.0
    try:
        return float(ConvexHull(points_2d).area)
    except Exception:
        return 0.0


def _slice(vertices, faces, height):
    """Points where the plane y=height cuts the triangle edges."""
    y = vertices[faces][:, :, 1] - height
    out = []
    for a, b in ((0, 1), (1, 2), (2, 0)):
        cross = (y[:, a] >= 0) != (y[:, b] >= 0)
        t = y[cross, a] / (y[cross, a] - y[cross, b])
        pa, pb = vertices[faces[cross, a]], vertices[faces[cross, b]]
        out.append(pa + (pb - pa) * t[:, None])
    return np.concatenate(out) if out else np.zeros((0, 3))


def measurements(body, arm_face_mask):
    """Tape-style girths, breadths and volume. Heights are fractions of the body's own stature.

    `arm_face_mask` marks arm and hand faces; they are left out of trunk slices.
    A girth is the perimeter of the convex hull of a horizontal slice, as a tape
    measure spans hollows. Leg girths use the left leg (x > 0).
    """
    floor = body.vertices[np.unique(body.faces[body.visible]), 1].min()
    stature = body.stature
    trunk = body.faces[body.visible & ~arm_face_mask]
    heights = np.linspace(0.04, 0.86, 165)
    girth, breadth, depth, leg = [], [], [], []
    for fraction in heights:
        cut = _slice(body.vertices, trunk, floor + fraction * stature)
        girth.append(_hull_perimeter(cut[:, [0, 2]]))
        breadth.append(float(np.ptp(cut[:, 0])) if len(cut) else 0.0)
        depth.append(float(np.ptp(cut[:, 2])) if len(cut) else 0.0)
        left = cut[cut[:, 0] > 0]
        leg.append(_hull_perimeter(left[:, [0, 2]]))
    girth, breadth, depth, leg = map(np.array, (girth, breadth, depth, leg))

    def window(values, lo, hi, pick):
        inside = (heights >= lo) & (heights <= hi)
        return float(pick(values[inside]))

    pixels = 400.0
    center = np.array([0.0, floor + stature / 2, 0.0])
    width, height = int(1.6 * pixels), int((stature + 0.1) * pixels)
    ids_f, _, depth_f = rasterize(body.vertices, body.faces, view_basis(0), center, pixels, width, height)
    ids_b, _, depth_b = rasterize(body.vertices, body.faces, view_basis(180), center, pixels, width, height)
    hit = (ids_f >= 0) & (ids_b[:, ::-1] >= 0)
    thickness = depth_f[hit] + depth_b[:, ::-1][hit]
    values = {
        "stature": stature,
        "chestGirth": window(girth, 0.70, 0.77, np.max),
        "waistGirth": window(girth, 0.58, 0.67, np.min),
        "hipGirth": window(girth, 0.46, 0.56, np.max),
        "thighGirth": window(leg, 0.36, 0.43, np.max),
        "calfGirth": window(leg, 0.15, 0.27, np.max),
        "shoulderBreadth": window(breadth, 0.78, 0.84, np.max),
        "hipBreadth": window(breadth, 0.46, 0.56, np.max),
        "chestDepth": window(depth, 0.70, 0.77, np.max),
        "waistDepth": window(depth, 0.58, 0.67, np.max),
        "volumeLitres": float(thickness.sum() / pixels ** 2 * 1000),
    }
    return {k: round(v, 4) for k, v in values.items()}, {"heights": heights, "girth": girth, "leg": leg}


def silhouette_overlap(candidate, target, pixels=500.0):
    """Intersection over union of the outlines seen from the front and from the side."""
    top = max(candidate.vertices[:, 1].max(), target.vertices[:, 1].max()) + 0.05
    center = np.array([0.0, top / 2, 0.0])
    out = {}
    for name, azimuth in (("front", 0), ("side", 90)):
        masks = [rasterize(b.vertices, b.faces, view_basis(azimuth), center, pixels,
                           int(1.7 * pixels), int(top * pixels))[0] >= 0 for b in (candidate, target)]
        out[name] = round(float((masks[0] & masks[1]).sum() / max((masks[0] | masks[1]).sum(), 1)), 4)
    return out


def split_error(detail, target, face_mask):
    """Two-way mean distance in millimetres on the part of the target marked by `face_mask`."""
    c = face_mask[detail["candidateFace"]]
    t = face_mask[target.sample_face]
    if c.sum() < 20 or t.sum() < 20:
        return None
    return round(float(detail["candidateDistance"][c].mean() + detail["targetDistance"][t].mean()) * 500, 2)


def signed_vertex_offset(target, candidate):
    """Per target vertex, how far the candidate surface lies outside (+) or inside (-), in metres."""
    from hb_mesh import vertex_normals
    normals = vertex_normals(target.vertices, target.faces)
    _, q, _, _ = candidate.surface.closest(target.vertices)
    return np.einsum("ij,ij->i", q - target.vertices, normals), np.linalg.norm(q - target.vertices, axis=1)


def folded_faces(before, after, faces, face_mask=None, min_area_mm2=0.25):
    """Triangles whose normal turned past perpendicular between two surfaces of one topology.

    A surface correction that keeps the skin intact turns no triangle that far in an
    unchanged pose, so the count measures folds and tears. Slivers are skipped.
    """
    faces = np.asarray(faces)
    if face_mask is not None:
        faces = faces[face_mask]
    old = np.cross(before[faces[:, 1]] - before[faces[:, 0]], before[faces[:, 2]] - before[faces[:, 0]])
    new = np.cross(after[faces[:, 1]] - after[faces[:, 0]], after[faces[:, 2]] - after[faces[:, 0]])
    counted = np.linalg.norm(old, axis=1) / 2 >= min_area_mm2 * 1e-6
    return {"triangles": int(counted.sum()), "folded": int((np.einsum("ij,ij->i", old, new)[counted] <= 0).sum())}
