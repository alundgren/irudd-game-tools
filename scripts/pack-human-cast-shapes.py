"""Pack Rocketbox face foundations as displacement lattices for the editable adult head.

python scripts/pack-human-cast-shapes.py EXTRACTED_MESH_DIRECTORY OUT.json
Each donor face is read through the shared face landmarks, set on the native head of the same sex by a
similarity fit, and the difference inside the face is stored as a smooth vector field like human-portrait-bases.json.
Microsoft Rocketbox Avatar Library, MIT, Copyright (c) 2020 Microsoft, commit 0943055db6ec570bcef9f2c8b41c9e5467c808f9.
"""

import base64, json, zlib
from pathlib import Path
import numpy as np
from scipy.ndimage import gaussian_filter
from scipy.spatial import cKDTree
import argparse
import cv2
from scipy.interpolate import RBFInterpolator
import rocketbox_face_surface as native
from rocketbox_face_chart import landmarks

NAMES = {
    "Male_Adult_03": "castM03",
    "Male_Adult_04": "castM04",
    "Male_Adult_05": "castM05",
    "Male_Adult_12": "castM12",
    "Male_Adult_14": "castM14",
    "Male_Adult_16": "castM16",
}
SKIN = {
    "Male_Adult_03": (104, 148),
    "Male_Adult_04": (108, 122),
    "Male_Adult_05": (116, 148),
    "Male_Adult_12": (112, 136),
    "Male_Adult_14": (104, 150),
    "Male_Adult_16": (110, 148),
}
PITCH = 0.006
FACET = 0.5
LIMIT = 0.016
LIPS = 0.0065
GAIN = 1.25
step = lambda z: np.clip(z, 0, 1) ** 2 * (3 - 2 * np.clip(z, 0, 1))


def umeyama(a, b, w):
    """Similarity taking points a onto b, weighted."""
    w = w / w.sum()
    ma, mb = w @ a, w @ b
    A, B = a - ma, b - mb
    U, S, Vt = np.linalg.svd((B * w[:, None]).T @ A)
    d = np.sign(np.linalg.det(U @ Vt))
    D = np.diag([1, 1, d])
    R = U @ D @ Vt
    s = (S * [1, 1, d]).sum() / (w @ (A**2).sum(1))
    return s, R, mb - s * R @ ma


class Reference:
    """The native head a donor of one sex is compared with."""

    def __init__(self, frame):
        self.cage = native.evaluate(frame)
        self.joint = self.cage[native.head_joint]
        self.s = native.smooth(self.cage)
        self.idx, uv = native.smooth_topology()
        c = native.chart(uv)
        inside = ((c > 2) & (c < 510)).all(-1).all(-1)
        ch = np.full((len(self.s), 2), np.nan)
        ch[self.idx[inside]] = c[inside]
        self.face = np.flatnonzero(~np.isnan(ch[:, 0]))
        self.chart = ch[self.face]
        u, v = self.chart.T
        oval = np.hypot((u - 256) / 168, (v - 280) / 215)
        self.mask = step((1 - oval) / 0.20) * step((v - 104) / 44)
        e = np.unique(
            np.sort(
                np.concatenate(
                    [self.idx[:, [0, 1]], self.idx[:, [1, 2]], self.idx[:, [2, 0]]]
                ),
                axis=1,
            ),
            axis=0,
        )
        local = np.full(len(self.s), -1)
        local[self.face] = np.arange(len(self.face))
        self.edges = local[e][(local[e] >= 0).all(1)]
        self.eyes = [self.cage[g].mean(0) for g in native.meta["eyeGroups"]]
        self.sample = np.flatnonzero(
            np.isin(np.arange(len(self.s)), np.unique(self.idx))
            & (self.s[:, 1] > self.joint[1] - 0.17)
        )


def measure(ref, donor, warp):
    """Displacement of the reference's face vertices (smooth surface) that makes this donor's face."""
    q, ok = donor.at(warp(ref.chart))
    p = ref.s[ref.face]
    a, b = ref.edges.T
    stretch = np.linalg.norm(q[a] - q[b], axis=1) / (
        np.linalg.norm(p[a] - p[b], axis=1) + 1e-9
    )
    torn = np.zeros(len(p), bool)
    torn[ref.edges[stretch > 4].ravel()] = True
    torn |= ~ok
    torn &= ref.mask > 0
    cut = step((cKDTree(p[torn]).query(p)[0] - 0.004) / 0.012) if torn.any() else 1
    top, side = SKIN[donor.name]
    u, v = ref.chart.T
    mask = (
        ref.mask
        * step((v - top) / 40)
        * step((side + 22 * step((v - 300) / 50) - np.abs(u - 256)) / 26 + 1)
        * cut
    )
    w = mask * ok
    rim = w * (1 - mask) * 4 + w
    s, R, t = umeyama(q, p, rim + 1e-9)
    fit = s * q @ R.T + t
    d = (fit - p) * w[:, None]
    tree = cKDTree(p)
    dist, near = tree.query(p, k=420, distance_upper_bound=0.024)
    near = np.minimum(near, len(p) - 1)

    def blur(values, weight, sigma):
        g = np.exp(-(dist**2) / (2 * sigma[:, None] ** 2)) * weight[near]
        return np.einsum("ij,ijk->ik", g, values[near]) / (
            g.sum(1, keepdims=True) + 1e-12
        )

    sigma = np.clip(FACET * s * donor.size, 0.0015, 0.008)
    lips = 1 - step((np.hypot((u - 256) / 50, (v - 350) / 32) - 0.8) / 0.5)
    sigma = np.maximum(sigma, LIPS * lips)
    sigma = blur(sigma[:, None], np.ones(len(p)), np.full(len(p), 0.004))[:, 0]
    broad = blur(d, np.ones(len(p)), np.full(len(p), 0.007))
    keep = 1 - 0.9 * step((np.linalg.norm(d - broad, axis=1) - 0.003) / 0.003)
    d = blur(d, keep, sigma)
    for e in ref.eyes:
        r = np.linalg.norm(p - e, axis=1)
        ring = (r > 0.017) & (r < 0.030) & (w > 0.5)
        k = 1 - step((r - 0.015) / 0.012)
        d = d * (1 - k[:, None]) + k[:, None] * d[ring].mean(0) * mask[:, None]
    d *= GAIN
    size = np.linalg.norm(d, axis=1, keepdims=True) + 1e-12
    d *= LIMIT * np.tanh(size / LIMIT) / size
    return d, dict(
        scale=float(s), R=R, t=t, fit=fit, ok=ok, mask=mask, torn=int(torn.sum())
    )


def lattice(ref, d, origin, shape):
    grid = (
        np.moveaxis(np.indices(shape), 0, -1).reshape(-1, 3) * PITCH
        + origin
        + ref.joint
    )
    full = np.zeros_like(ref.s)
    full[ref.face] = d
    dist, near = cKDTree(ref.s[ref.sample]).query(grid, k=64)
    wt = np.exp(-(dist**2 - dist[:, :1] ** 2) / (2 * 0.0035**2))
    wt /= wt.sum(1, keepdims=True)
    field = np.einsum("ij,ijk->ik", wt, full[ref.sample][near]).reshape(*shape, 3)
    att = np.clip(1 - (dist[:, 0] - 0.012) / 0.024, 0, 1)
    edge = np.indices(shape)
    edge = np.minimum(edge, np.array(shape)[:, None, None, None] - 1 - edge).min(0)
    att *= np.clip(edge.ravel() / 2, 0, 1)
    field = gaussian_filter(field, (0.5, 0.5, 0.5, 0)) * att.reshape(*shape, 1)
    for e in ref.eyes:
        move = d[np.argsort(np.linalg.norm(ref.s[ref.face] - e, axis=1))[:40]].mean(0)
        k = (1 - step((np.linalg.norm(grid - e, axis=1) - 0.019) / 0.012)).reshape(
            *shape, 1
        )
        field = field * (1 - k) + k * move
    return field


class Donor:
    def __init__(self, directory, name):
        d = np.load(directory / (name + ".npz"))
        head = (
            d["mat"] == [i for i, n in enumerate(d["names"]) if n.endswith("_head")][0]
        )
        self.name, self.xyz, self.tri, self.uv = (
            name,
            d["xyz"],
            d["tri"][head],
            d["uv"][head],
        )
        S = 2000
        ids = np.full((S, S), -1, np.int32)
        for t, c in enumerate(self.uv):
            cv2.fillConvexPoly(ids, np.round(c * S).astype(np.int32), int(t))
        self.ids, self.S = ids, S
        _, weld = np.unique(np.round(self.xyz, 5), axis=0, return_inverse=True)
        weld = weld.ravel()
        fn = np.cross(
            self.xyz[self.tri[:, 1]] - self.xyz[self.tri[:, 0]],
            self.xyz[self.tri[:, 2]] - self.xyz[self.tri[:, 0]],
        )
        acc = np.zeros((weld.max() + 1, 3))
        np.add.at(acc, weld[self.tri].ravel(), np.repeat(fn, 3, axis=0))
        self.normal = (acc / (np.linalg.norm(acc, axis=1, keepdims=True) + 1e-12))[weld]

    def curved(self, t, w, round_=0.75):
        """Phong tessellation: a point of triangle t at weights w, rounded towards the vertex tangent planes."""
        c = self.xyz[self.tri[t]]
        n = self.normal[self.tri[t]]
        p = np.einsum("ij,ijk->ik", w, c)
        proj = p[:, None] - np.einsum("ijk,ijk->ij", p[:, None] - c, n)[..., None] * n
        return (1 - round_) * p + round_ * np.einsum("ij,ijk->ik", w, proj)

    def at(self, chart):
        """3D points under chart positions (0..500). Returns points and a validity flag."""
        px = np.clip(np.round(chart / 500 * self.S - 0.5).astype(int), 0, self.S - 1)
        t = self.ids[px[:, 1], px[:, 0]]
        ok = t >= 0
        t = np.where(ok, t, 0)
        a, b, c = (self.uv[t, k] * 500 for k in range(3))
        p = chart
        den = (b[:, 1] - c[:, 1]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (
            a[:, 1] - c[:, 1]
        )
        den = np.where(np.abs(den) < 1e-12, 1e-12, den)
        w0 = (
            (b[:, 1] - c[:, 1]) * (p[:, 0] - c[:, 0])
            + (c[:, 0] - b[:, 0]) * (p[:, 1] - c[:, 1])
        ) / den
        w1 = (
            (c[:, 1] - a[:, 1]) * (p[:, 0] - c[:, 0])
            + (a[:, 0] - c[:, 0]) * (p[:, 1] - c[:, 1])
        ) / den
        w = np.clip(np.stack([w0, w1, 1 - w0 - w1], 1), 0, 1)
        w /= w.sum(1, keepdims=True)
        self.size = np.sqrt(
            np.linalg.norm(
                np.cross(
                    self.xyz[self.tri[t, 1]] - self.xyz[self.tri[t, 0]],
                    self.xyz[self.tri[t, 2]] - self.xyz[self.tri[t, 0]],
                ),
                axis=1,
            )
        )
        return self.curved(t, w), ok


def main(directory, out):
    marks = np.array(landmarks, float)
    warp = RBFInterpolator(
        marks[:, :2], marks[:, 2:], kernel="thin_plate_spline", smoothing=0.32
    )
    refs = {"Female": Reference(-0.9), "Male": Reference(0.9)}
    lo = (
        np.min([(r.s[r.face][r.mask > 0] - r.joint).min(0) for r in refs.values()], 0)
        - 3 * PITCH
    )
    hi = (
        np.max([(r.s[r.face][r.mask > 0] - r.joint).max(0) for r in refs.values()], 0)
        + 3 * PITCH
    )
    half = max(-lo[0], hi[0])
    lo[0], hi[0] = -half, half
    shape = tuple(int(x) for x in np.ceil((hi - lo) / PITCH) + 1)
    origin = lo
    packet, credits = {}, {}
    measured = {
        name: measure(refs["Male"], Donor(directory, name), warp) for name in NAMES
    }
    common = np.mean([measured[name][0] for name in NAMES], 0)
    for name, key in NAMES.items():
        ref = refs["Male"]
        d, info = measured[name]
        d = d - 0.25 * common
        q = np.rint(lattice(ref, d, origin, shape) / 0.000002)
        if np.abs(q).max() > 32767:
            raise ValueError("field overflow " + name)
        packet["m:" + key] = base64.b64encode(
            zlib.compress(q.astype("<i2").tobytes(), 9)
        ).decode()
        credits[key] = dict(
            title="Cast " + key[4:],
            source=name,
            sex=name.split("_")[0].lower(),
            license="MIT",
            copyright="Copyright (c) 2020 Microsoft",
            library="Microsoft Rocketbox Avatar Library",
            commit="0943055db6ec570bcef9f2c8b41c9e5467c808f9",
        )
    data = dict(
        credits=credits,
        layout=dict(origin=origin.tolist(), shape=shape, pitch=PITCH, anchor=[0, 0, 0]),
        packet=packet,
    )
    Path(out).write_text(json.dumps(data, separators=(",", ":")) + "\n")
    print("shape", shape, "bytes", Path(out).stat().st_size)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "directory", type=Path, help="Extracted .npz files from rocketbox-extract.py"
    )
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    main(args.directory, args.output)
