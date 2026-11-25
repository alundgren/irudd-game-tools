"""Small mesh helpers shared by the fit and pack steps."""
import numpy as np
from scipy.spatial import cKDTree


def vertex_normals(p, tri):
    fn = np.cross(p[tri[:, 1]] - p[tri[:, 0]], p[tri[:, 2]] - p[tri[:, 0]])
    n = np.zeros_like(p)
    for k in range(3):
        np.add.at(n, tri[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def closest_on_tris(q, a, b, c):
    """Closest point of triangles (a,b,c) to points q, all (N,3). Returns point and barycentric weights."""
    ab, ac, ap = b - a, c - a, q - a
    d1, d2 = (ab * ap).sum(1), (ac * ap).sum(1)
    bp = q - b
    d3, d4 = (ab * bp).sum(1), (ac * bp).sum(1)
    cp = q - c
    d5, d6 = (ab * cp).sum(1), (ac * cp).sum(1)
    va, vb, vc = d3 * d6 - d5 * d4, d5 * d2 - d1 * d6, d1 * d4 - d3 * d2
    w = np.zeros((len(q), 3))
    den = np.where(np.abs(va + vb + vc) < 1e-20, 1, va + vb + vc)
    w[:, 1], w[:, 2] = vb / den, vc / den
    w[:, 0] = 1 - w[:, 1] - w[:, 2]
    # Edge and corner regions, in the order of Ericson's test.
    def put(mask, w0, w1, w2):
        w[mask, 0], w[mask, 1], w[mask, 2] = w0[mask] if hasattr(w0, '__len__') else w0, w1[mask] if hasattr(w1, '__len__') else w1, w2[mask] if hasattr(w2, '__len__') else w2
    safe = lambda x: np.where(np.abs(x) < 1e-20, 1, x)
    t = (d4 - d3) / safe((d4 - d3) + (d5 - d6)); put((va <= 0) & (d4 - d3 >= 0) & (d5 - d6 >= 0), 0 * t, 1 - t, t)
    t = d2 / safe(d2 - d6); put((vb <= 0) & (d2 >= 0) & (d6 <= 0), 1 - t, 0 * t, t)
    put((d6 >= 0) & (d5 <= d6), 0, 0, 1)
    t = d1 / safe(d1 - d3); put((vc <= 0) & (d1 >= 0) & (d3 <= 0), 1 - t, t, 0 * t)
    put((d3 >= 0) & (d4 <= d3), 0, 1, 0)
    put((d1 <= 0) & (d2 <= 0), 1, 0, 0)
    return a * w[:, :1] + b * w[:, 1:2] + c * w[:, 2:], w


class Surface:
    def __init__(self, p, tri):
        self.p, self.tri = p, tri
        self.n = vertex_normals(p, tri)
        a, b, c = p[tri[:, 0]], p[tri[:, 1]], p[tri[:, 2]]
        bary = np.array([[1, 1, 1], [4, 1, 1], [1, 4, 1], [1, 1, 4], [2, 2, .2], [2, .2, 2], [.2, 2, 2]], float)
        bary /= bary.sum(1, keepdims=True)
        pts = np.concatenate([a * w[0] + b * w[1] + c * w[2] for w in bary])
        self.owner = np.tile(np.arange(len(tri)), len(bary))
        self.tree = cKDTree(pts)

    def closest(self, q, k=6):
        """Closest surface point: (point, triangle, weights, signed distance, normal)."""
        _, idx = self.tree.query(q, k=k)
        best = np.full(len(q), np.inf); out = None
        res_p = np.zeros_like(q); res_t = np.zeros(len(q), int); res_w = np.zeros((len(q), 3))
        for j in range(k):
            t = self.owner[idx[:, j]]
            cp, w = closest_on_tris(q, self.p[self.tri[t, 0]], self.p[self.tri[t, 1]], self.p[self.tri[t, 2]])
            d = np.linalg.norm(q - cp, axis=1)
            m = d < best
            best[m] = d[m]; res_p[m] = cp[m]; res_t[m] = t[m]; res_w[m] = w[m]
        nrm = (self.n[self.tri[res_t]] * res_w[:, :, None]).sum(1)
        nrm /= np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-12)
        sign = np.sign(((q - res_p) * nrm).sum(1)); sign[sign == 0] = 1
        return res_p, res_t, res_w, best * sign, nrm


def components(count, tri):
    parent = np.arange(count)
    def root(v):
        while parent[v] != v:
            parent[v] = parent[parent[v]]; v = parent[v]
        return v
    for a, b, c in tri:
        ra, rb, rc = root(a), root(b), root(c)
        parent[rb] = ra; parent[root(rc)] = ra
    return np.array([root(v) for v in range(count)])


def clip(p, attrs, tri, uv, per_tri, d):
    """Keep the part of the triangles where d < 0. p and attrs (dict of (V,k)) grow by the cut points.
    Returns new p, attrs, tri, uv (T,3,2), per_tri (dict), and the indices of vertices made on the cut."""
    p = list(map(np.array, p)); attrs = {k: list(v) for k, v in attrs.items()}; d = list(d)
    made = {}; cut = []
    def mid(i, j):
        key = (min(i, j), max(i, j))
        if key not in made:
            t = d[i] / (d[i] - d[j])
            p.append(p[i] + (p[j] - p[i]) * t)
            for k in attrs: attrs[k].append(attrs[k][i] + (attrs[k][j] - attrs[k][i]) * t)
            d.append(0.0); made[key] = len(p) - 1; cut.append(len(p) - 1)
        return made[key]
    out_t, out_uv, out_i = [], [], []
    for ti, (t, u) in enumerate(zip(tri, uv)):
        inside = [d[v] < 0 for v in t]
        if all(inside):
            out_t.append(list(t)); out_uv.append(u); out_i.append(ti); continue
        if not any(inside): continue
        poly = []
        for e in range(3):
            i, j = t[e], t[(e + 1) % 3]
            if inside[e]: poly.append((i, u[e]))
            if inside[e] != inside[(e + 1) % 3]:
                s = d[i] / (d[i] - d[j])
                poly.append((mid(i, j), u[e] + (u[(e + 1) % 3] - u[e]) * s))
        for k in range(1, len(poly) - 1):
            out_t.append([poly[0][0], poly[k][0], poly[k + 1][0]])
            out_uv.append(np.array([poly[0][1], poly[k][1], poly[k + 1][1]])); out_i.append(ti)
    out_i = np.array(out_i, int)
    return (np.array(p), {k: np.array(v) for k, v in attrs.items()}, np.array(out_t, int).reshape(-1, 3),
            np.array(out_uv).reshape(-1, 3, 2), {k: v[out_i] for k, v in per_tri.items()}, np.array(cut, int))


def smoothstep(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def neighbours(count, tri):
    import scipy.sparse as sp
    i = np.concatenate([tri[:, 0], tri[:, 1], tri[:, 2], tri[:, 1], tri[:, 2], tri[:, 0]])
    j = np.concatenate([tri[:, 1], tri[:, 2], tri[:, 0], tri[:, 0], tri[:, 1], tri[:, 2]])
    a = sp.coo_matrix((np.ones(len(i)), (i, j)), shape=(count, count)).tocsr()
    a.data[:] = 1
    deg = np.maximum(np.asarray(a.sum(1)).ravel(), 1)
    return sp.diags(1 / deg) @ a
