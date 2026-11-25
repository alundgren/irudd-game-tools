"""Triangle-mesh helpers for the human benchmark: GLB files, sampling and exact distances.

Everything is plain numpy and scipy. Meshes are (vertices float64 [N,3] in metres,
faces int [F,3]) with Y up and +Z towards the viewer's front of the figure.
"""

import json
import struct

import numpy as np
from scipy.spatial import cKDTree


# ---------------------------------------------------------------- GLB files
def write_glb(path, vertices, faces, extras=None, copyright_text=None, name="mesh"):
    """Write one indexed triangle mesh as binary glTF 2.0 with byte-quantised smooth normals."""
    v = np.asarray(vertices, dtype="<f4")
    f = np.asarray(faces, dtype="<u2" if len(v) < 65536 else "<u4")
    n = np.zeros((len(v), 4), dtype=np.int8)
    n[:, :3] = np.rint(vertex_normals(vertices, faces) * 127)
    chunks, views = [], []

    def view(data, target, stride=None):
        offset = sum(len(c) for c in chunks)
        raw = data.tobytes()
        chunks.append(raw + b"\0" * (-len(raw) % 4))
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(raw), "target": target})
        if stride:
            views[-1]["byteStride"] = stride
        return len(views) - 1

    accessors = [
        {"bufferView": view(v, 34962), "componentType": 5126, "count": len(v), "type": "VEC3",
         "min": v.min(0).tolist(), "max": v.max(0).tolist()},
        {"bufferView": view(n, 34962, 4), "componentType": 5120, "normalized": True, "count": len(n), "type": "VEC3"},
        {"bufferView": view(f.reshape(-1), 34963), "componentType": 5123 if f.itemsize == 2 else 5125,
         "count": f.size, "type": "SCALAR"},
    ]
    asset = {"version": "2.0", "generator": "irudd-game-tools human benchmark"}
    if copyright_text:
        asset["copyright"] = copyright_text
    doc = {
        "asset": asset,
        "extensionsUsed": ["KHR_mesh_quantization"],
        "extensionsRequired": ["KHR_mesh_quantization"],
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [{"name": name, "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}, "indices": 2}]}],
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": sum(len(c) for c in chunks)}],
    }
    if extras:
        doc["nodes"][0]["extras"] = extras
    text = json.dumps(doc, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    binary = b"".join(chunks)
    with open(path, "wb") as out:
        out.write(struct.pack("<4sII", b"glTF", 2, 28 + len(text) + len(binary)))
        out.write(struct.pack("<I4s", len(text), b"JSON") + text)
        out.write(struct.pack("<I4s", len(binary), b"BIN\0") + binary)


def read_glb(path):
    """Read the first primitive of a GLB. Returns vertices, faces and the node extras."""
    with open(path, "rb") as source:
        raw = source.read()
    length = struct.unpack_from("<I", raw, 12)[0]
    doc = json.loads(raw[20:20 + length])
    binary = raw[20 + length + 8:]
    kinds = {5123: "<u2", 5125: "<u4", 5126: "<f4"}
    width = {"SCALAR": 1, "VEC3": 3}

    def accessor(index):
        a = doc["accessors"][index]
        bv = doc["bufferViews"][a["bufferView"]]
        start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        data = np.frombuffer(binary, kinds[a["componentType"]], a["count"] * width[a["type"]], start)
        return data.reshape(-1, width[a["type"]]) if a["type"] != "SCALAR" else data

    primitive = doc["meshes"][0]["primitives"][0]
    vertices = accessor(primitive["attributes"]["POSITION"]).astype(np.float64)
    faces = accessor(primitive["indices"]).astype(np.int64).reshape(-1, 3)
    return vertices, faces, doc["nodes"][0].get("extras", {}), doc["asset"]


# ---------------------------------------------------------------- geometry
def face_normals(vertices, faces):
    a, b, c = (vertices[faces[:, i]] for i in range(3))
    cross = np.cross(b - a, c - a)
    area = 0.5 * np.linalg.norm(cross, axis=1)
    return cross / np.maximum(2 * area, 1e-20)[:, None], area


def vertex_normals(vertices, faces):
    a, b, c = (vertices[faces[:, i]] for i in range(3))
    cross = np.cross(b - a, c - a)  # area weighted
    out = np.zeros_like(vertices, dtype=np.float64)
    for i in range(3):
        np.add.at(out, faces[:, i], cross)
    return out / np.maximum(np.linalg.norm(out, axis=1), 1e-20)[:, None]


def sample_surface(vertices, faces, count, seed, face_mask=None):
    """Area-uniform random points. Returns points, face index and barycentric weights."""
    rng = np.random.default_rng(seed)
    _, area = face_normals(vertices, faces)
    if face_mask is not None:
        area = np.where(face_mask, area, 0.0)
    pick = rng.choice(len(faces), size=count, p=area / area.sum())
    r1, r2 = np.sqrt(rng.random(count)), rng.random(count)
    bary = np.column_stack([1 - r1, r1 * (1 - r2), r1 * r2])
    points = np.einsum("ij,ijk->ik", bary, vertices[faces[pick]])
    return points, pick, bary


def closest_on_triangles(p, a, b, c):
    """Closest points on triangles (a,b,c) to points p, row by row (Ericson 5.1.5)."""
    ab, ac, ap = b - a, c - a, p - a
    d1, d2 = np.einsum("ij,ij->i", ab, ap), np.einsum("ij,ij->i", ac, ap)
    bp = p - b
    d3, d4 = np.einsum("ij,ij->i", ab, bp), np.einsum("ij,ij->i", ac, bp)
    cp = p - c
    d5, d6 = np.einsum("ij,ij->i", ab, cp), np.einsum("ij,ij->i", ac, cp)
    va, vb, vc = d3 * d6 - d5 * d4, d5 * d2 - d1 * d6, d1 * d4 - d3 * d2
    with np.errstate(divide="ignore", invalid="ignore"):
        denom = va + vb + vc
        v = np.where(denom != 0, vb / denom, 0.0)
        w = np.where(denom != 0, vc / denom, 0.0)
        # Region tests in the order of the reference implementation.
        conds = [
            (d1 <= 0) & (d2 <= 0),
            (d3 >= 0) & (d4 <= d3),
            (vc <= 0) & (d1 >= 0) & (d3 <= 0),
            (d6 >= 0) & (d5 <= d6),
            (vb <= 0) & (d2 >= 0) & (d6 <= 0),
            (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0),
        ]
        t_ab = np.where(d1 - d3 != 0, d1 / (d1 - d3), 0.0)
        t_ac = np.where(d2 - d6 != 0, d2 / (d2 - d6), 0.0)
        t_bc = np.where((d4 - d3) + (d5 - d6) != 0, (d4 - d3) / ((d4 - d3) + (d5 - d6)), 0.0)
    zero, one = np.zeros_like(v), np.ones_like(v)
    choices_v = [zero, one, t_ab, zero, zero, 1 - t_bc]
    choices_w = [zero, zero, zero, one, t_ac, t_bc]
    v = np.select(conds, choices_v, v)
    w = np.select(conds, choices_w, w)
    bary = np.column_stack([1 - v - w, v, w])
    return a * bary[:, :1] + b * bary[:, 1:2] + c * bary[:, 2:], bary


class Surface:
    """A triangle surface that answers exact closest-point queries.

    Candidate triangles are the `k` nearest of a dense set of anchor points:
    every triangle contributes its centroid, and triangles with long edges
    contribute additional interior anchors so no query can miss them.
    """

    def __init__(self, vertices, faces, face_mask=None, anchor_spacing=0.012):
        self.vertices = np.asarray(vertices, dtype=np.float64)
        self.faces = np.asarray(faces, dtype=np.int64)
        self.active = np.arange(len(self.faces)) if face_mask is None else np.flatnonzero(face_mask)
        tri = self.vertices[self.faces[self.active]]
        self.normals, self.areas = face_normals(self.vertices, self.faces)
        self.vertex_normals = vertex_normals(self.vertices, self.faces)
        edges = np.linalg.norm(tri - np.roll(tri, 1, axis=1), axis=2).max(1)
        anchors, owner = [tri.mean(1)], [np.arange(len(tri))]
        long = np.flatnonzero(edges > anchor_spacing)
        if len(long):
            steps = np.ceil(edges[long] / anchor_spacing).astype(int)
            for n in np.unique(steps):
                rows = long[steps == n]
                i, j = np.meshgrid(np.arange(n + 1), np.arange(n + 1), indexing="ij")
                keep = i + j <= n
                w = np.column_stack([i[keep], j[keep], n - i[keep] - j[keep]]) / n
                anchors.append(np.einsum("wk,tkd->twd", w, tri[rows]).reshape(-1, 3))
                owner.append(np.repeat(rows, len(w)))
        self._owner = np.concatenate(owner)
        self._tree = cKDTree(np.concatenate(anchors))

    def closest(self, points, k=12):
        """Returns distance, closest point, face index and barycentric weights per query."""
        points = np.asarray(points, dtype=np.float64)
        k = min(k, len(self._owner))
        _, near = self._tree.query(points, k=k)
        near = near.reshape(len(points), k)
        best_d = np.full(len(points), np.inf)
        best_p = np.zeros((len(points), 3))
        best_f = np.zeros(len(points), dtype=np.int64)
        best_b = np.zeros((len(points), 3))
        seen = np.full(len(points), -1)
        for column in range(k):
            local = self._owner[near[:, column]]
            todo = local != seen if column else np.ones(len(points), dtype=bool)
            seen = local
            rows = np.flatnonzero(todo)
            face = self.active[local[rows]]
            tri = self.vertices[self.faces[face]]
            q, bary = closest_on_triangles(points[rows], tri[:, 0], tri[:, 1], tri[:, 2])
            d = np.linalg.norm(q - points[rows], axis=1)
            better = d < best_d[rows]
            rows = rows[better]
            best_d[rows], best_p[rows], best_f[rows], best_b[rows] = d[better], q[better], face[better], bary[better]
        return best_d, best_p, best_f, best_b

    def smooth_normal(self, face, bary):
        n = np.einsum("ij,ijk->ik", bary, self.vertex_normals[self.faces[face]])
        return n / np.maximum(np.linalg.norm(n, axis=1), 1e-20)[:, None]


def rigid_fit(source, target, weights=None, yaw_only=False):
    """Least-squares rotation R and translation t with R @ source + t ~ target (no scale)."""
    w = np.ones(len(source)) if weights is None else weights
    w = w / w.sum()
    cs, ct = w @ source, w @ target
    a, b = source - cs, target - ct
    if yaw_only:
        s = np.sum(w * (a[:, 2] * b[:, 0] - a[:, 0] * b[:, 2]))
        c = np.sum(w * (a[:, 0] * b[:, 0] + a[:, 2] * b[:, 2]))
        angle = np.arctan2(s, c)
        rot = np.array([[np.cos(angle), 0, np.sin(angle)], [0, 1, 0], [-np.sin(angle), 0, np.cos(angle)]])
    else:
        u, _, vt = np.linalg.svd((a * w[:, None]).T @ b)
        d = np.sign(np.linalg.det(vt.T @ u.T))
        rot = vt.T @ np.diag([1, 1, d]) @ u.T
    return rot, ct - rot @ cs
