"""Head-specific distance measures between a scan and the rendered editable head.

The comparison never sees a recipe. It receives the subdivided surface the
editor renders (eyes closed when the scan's are) and the scan in the generator
frame. Samples and their region labels are fixed once per scan, so every stage
is scored on the same patches of skin.

Distances are millimetres on a 1.72 m editable human. The scan was scaled to
that head, so they are not millimetres on the sitter unless the scale is 1.
"""

import numpy as np
from scipy.spatial import cKDTree

import _paths
from hb_mesh import Surface, sample_surface
from hs_generator import REGIONS
from hs_targets import boundary_vertices

SAMPLES = 40000
FACE_REGIONS = ("eyes", "nose", "mouth", "chin and jaw", "cheeks", "brow and forehead")


class Scored:
    """A scan prepared for scoring against one family of generated heads."""

    def __init__(self, topology, scan_vertices, scan_faces, reference_smooth, not_skin=()):
        """`scan_vertices` are in the generator frame. `reference_smooth` is the generated
        surface used once to decide which scan surface is head and which facial region it is."""
        self.topology = topology
        self.vertices, self.faces = scan_vertices, scan_faces
        self.surface = Surface(scan_vertices, scan_faces, anchor_spacing=0.006)
        edge = np.zeros(len(scan_vertices), dtype=bool)
        edge[boundary_vertices(scan_faces)] = True
        self.open_face = edge[scan_faces].any(1)
        self.not_skin = tuple(not_skin)

        reference = self.generated(reference_smooth)
        centre = scan_vertices[scan_faces].mean(1)
        d, _, face, bary = reference["surface"].closest(centre)
        self.head_face = (d < 0.04) & ~reference["cut_face"][face]
        self.points, face_index, bary = sample_surface(scan_vertices, scan_faces, SAMPLES, 101, self.head_face)
        self.normals = self.surface.smooth_normal(face_index, bary)
        _, _, face, bary = reference["surface"].closest(self.points)
        corner = topology.smooth_faces[face]
        self.point_region = topology.smooth_region[corner[np.arange(len(corner)), bary.argmax(1)]]
        _, self.gen_face, self.gen_bary = sample_surface(reference_smooth, topology.smooth_faces, SAMPLES, 202)
        corner = topology.smooth_faces[self.gen_face]
        self.gen_region = topology.smooth_region[corner[np.arange(len(corner)), self.gen_bary.argmax(1)]]

    def generated(self, smooth):
        faces = self.topology.smooth_faces
        cut = np.zeros(len(smooth), dtype=bool)
        cut[self.topology.smooth_cut] = True
        return {"surface": Surface(smooth, faces, anchor_spacing=0.006), "cut_face": cut[faces].any(1)}

    def groups(self):
        """Named sets of regions. `face` and `head` leave out what the scan shows as hair or cap."""
        skin = [name for name in REGIONS if name not in self.not_skin and name != "neck"]
        return {"head": skin, "face": [name for name in FACE_REGIONS if name in skin],
                **{name: [name] for name in REGIONS}}

    def score(self, smooth):
        g = self.generated(smooth)
        points = np.einsum("pk,pkd->pd", self.gen_bary, smooth[self.topology.smooth_faces[self.gen_face]])
        d_gs, closest, face, bary = self.surface.closest(points)
        scan_normal = self.surface.smooth_normal(face, bary)
        signed = np.einsum("ij,ij->i", points - closest, scan_normal)
        gen_normal = g["surface"].smooth_normal(self.gen_face, self.gen_bary)
        angle = np.degrees(np.arccos(np.clip(np.einsum("ij,ij->i", gen_normal, scan_normal), -1, 1)))
        valid_gs = ~self.open_face[face]
        d_sg, _, face, _ = g["surface"].closest(self.points)
        valid_sg = ~g["cut_face"][face]

        out = {}
        for name, members in self.groups().items():
            ids = [REGIONS.index(m) for m in members]
            a = valid_gs & np.isin(self.gen_region, ids)
            b = valid_sg & np.isin(self.point_region, ids)
            if a.sum() < 30 or b.sum() < 30:
                continue
            ga, sb = d_gs[a] * 1000, d_sg[b] * 1000
            out[name] = {
                "two_way_mean_mm": float((ga.mean() + sb.mean()) / 2),
                "generated_to_scan_mean_mm": float(ga.mean()), "scan_to_generated_mean_mm": float(sb.mean()),
                "generated_to_scan_p95_mm": float(np.percentile(ga, 95)), "scan_to_generated_p95_mm": float(np.percentile(sb, 95)),
                "max_mm": float(max(ga.max(), sb.max())),
                "within_1mm": _fscore(ga, sb, 1.0), "within_2mm": _fscore(ga, sb, 2.0),
                "signed_mean_mm": float(signed[a].mean() * 1000),
                "normal_angle_mean_deg": float(angle[a].mean()),
                "samples": [int(a.sum()), int(b.sum())],
            }
        return out, {"points": points, "signed": signed, "valid": valid_gs}

    def vertex_signed(self, smooth):
        """Signed distance of every generated vertex to the scan in metres (for heat maps), NaN without a partner."""
        d, closest, face, bary = self.surface.closest(smooth)
        signed = np.einsum("ij,ij->i", smooth - closest, self.surface.smooth_normal(face, bary))
        signed[self.open_face[face]] = np.nan
        return signed


def _fscore(a, b, tolerance):
    precision, recall = (a <= tolerance).mean(), (b <= tolerance).mean()
    return float(2 * precision * recall / max(precision + recall, 1e-12))


def section(vertices, faces, axis=0, value=0.0):
    """Line segments where a mesh crosses the plane coordinate[axis] == value. Returns [n, 2, 3]."""
    side = vertices[:, axis][faces] - value
    crossing = (side.min(1) < 0) & (side.max(1) >= 0)
    tri, s = vertices[faces[crossing]], side[crossing]
    segments = []
    for i, j in ((0, 1), (1, 2), (2, 0)):
        cut = (s[:, i] < 0) != (s[:, j] < 0)
        t = np.where(cut, s[:, i] / np.where(cut, s[:, i] - s[:, j], 1.0), np.nan)
        segments.append(tri[:, i] + t[:, None] * (tri[:, j] - tri[:, i]))
    points = np.stack(segments, axis=1)
    order = np.argsort(np.isnan(points[:, :, 0]), axis=1, kind="stable")[:, :2]
    return points[np.arange(len(points))[:, None], order]


def _densify(segments, spacing=0.00025):
    steps = np.maximum(1, np.ceil(np.linalg.norm(segments[:, 1] - segments[:, 0], axis=1) / spacing).astype(int))
    t = np.concatenate([np.arange(n + 1) / n for n in steps])
    index = np.repeat(np.arange(len(segments)), steps + 1)
    return segments[index, 0] + t[:, None] * (segments[index, 1] - segments[index, 0])


def profile(topology, smooth, scan_vertices, scan_faces):
    """Front midline of both heads from below the chin to the top of the forehead.

    Returns the two curves as (depth z, height y) points and their curve-to-curve
    distance in millimetres, overall and per height band.
    """
    m, u = topology.landmarks, topology.landmarks["unit"]
    low, high = m["mouth"][1] - 0.95 * u, m["eye"][1] + 1.2 * u
    front = m["ear"][2] + 0.45 * u

    def curve(vertices, faces):
        points = _densify(section(vertices, faces))[:, [2, 1]]
        return points[(points[:, 1] > low) & (points[:, 1] < high) & (points[:, 0] > front)]

    generated, scan = curve(smooth, topology.smooth_faces), curve(scan_vertices, scan_faces)
    d_gs = cKDTree(scan).query(generated)[0] * 1000
    d_sg = cKDTree(generated).query(scan)[0] * 1000
    subnasal = m["nose_tip"][1] - 0.16 * u
    bands = {"forehead and brow": (m["eye"][1] + 0.12 * u, high), "nose": (subnasal, m["eye"][1] + 0.12 * u),
             "lips": (m["mouth"][1] - 0.30 * u, subnasal), "chin": (low, m["mouth"][1] - 0.30 * u)}
    result = {"mean_mm": float((d_gs.mean() + d_sg.mean()) / 2), "max_mm": float(max(d_gs.max(), d_sg.max())), "bands": {}}
    for name, (a, b) in bands.items():
        ga, sb = d_gs[(generated[:, 1] >= a) & (generated[:, 1] < b)], d_sg[(scan[:, 1] >= a) & (scan[:, 1] < b)]
        if len(ga) and len(sb):
            result["bands"][name] = {"mean_mm": float((ga.mean() + sb.mean()) / 2), "max_mm": float(max(ga.max(), sb.max()))}
    return result, generated, scan


def folds(faces, before, after, min_area_mm2=0.25):
    """Triangles a correction turned past perpendicular: the sign of a fold or a tear.

    `before` and `after` are the same mesh at the same pose. Triangles smaller
    than `min_area_mm2` before the correction are not counted.
    """
    def cross(vertices):
        a, b, c = (vertices[faces[:, i]] for i in range(3))
        return np.cross(b - a, c - a)

    old, new = cross(before), cross(after)
    counted = np.linalg.norm(old, axis=1) / 2 >= min_area_mm2 * 1e-6
    return {"triangles": int(counted.sum()), "past_perpendicular": int((np.einsum("ij,ij->i", old, new)[counted] <= 0).sum())}


def roughness(topology, smooth, reference_smooth):
    """How much a correction roughens the surface: mean absolute change of the umbrella
    Laplacian against the uncorrected head, in millimetres, over head vertices."""
    faces = topology.smooth_faces
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    edges = np.concatenate([edges, edges[:, ::-1]])
    ids = np.unique(faces)

    def laplacian(vertices):
        total = np.zeros_like(vertices)
        count = np.zeros(len(vertices))
        np.add.at(total, edges[:, 0], vertices[edges[:, 1]])
        np.add.at(count, edges[:, 0], 1)
        return total[ids] / count[ids, None] - vertices[ids]

    return float(np.linalg.norm(laplacian(smooth) - laplacian(reference_smooth), axis=1).mean() * 1000)
