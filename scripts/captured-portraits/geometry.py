"""Fit donor contours and visible soft tissue on the editable subdivision cage."""

from pathlib import Path
import sys, json, base64, zlib
import numpy as np, cv2
from scipy import sparse
from scipy.interpolate import RBFInterpolator
from scipy.sparse.linalg import factorized
from scipy.spatial import cKDTree
import importlib.util
from inputs import CACHE as p, FRAMES

sys.path.insert(0, str(Path.cwd() / "scripts"))
import rocketbox_face_surface as nat

spec = importlib.util.spec_from_file_location(
    "cast", "scripts/pack-human-cast-shapes.py"
)
cast = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cast)
selnames = FRAMES


def step(z):
    z = np.clip(z, 0, 1)
    return z * z * (3 - 2 * z)


def enc(a):
    return base64.b64encode(zlib.compress(a.tobytes(), 9)).decode()


def norm(a):
    return np.linalg.norm(a, axis=-1)


def fit(name, frame):
    m = np.load(p / (name + "-registration.npz"))
    ref = cast.Reference(frame)
    cage = ref.cage
    verts = ref.s
    n = m["reference"]
    d = m["landmarks"]
    outer = [
        10,
        152,
        127,
        356,
        234,
        454,
        93,
        323,
        136,
        365,
        103,
        332,
        148,
        377,
        172,
        397,
        58,
        288,
    ]
    interior = [
        1,
        4,
        6,
        9,
        123,
        352,
        101,
        330,
        94,
        195,
        168,
        50,
        280,
        117,
        346,
        187,
        411,
        199,
        175,
        17,
        0,
        61,
        291,
        105,
        334,
        46,
        276,
        71,
        301,
        197,
        205,
        425,
    ]
    ni = (n - m["reference_origin"]) @ m["native_axes"].T
    di = (d - m["scan_origin"]) @ m["scan_axes"].T
    good = lambda i: norm(ni[i]) < 0.145 and norm(di[i]) < 0.165
    marks = np.array([i for i in interior + outer if good(i)])
    nxy = (m["native_marks"] + 0.5 - 512) * np.array([1, -1]) * 0.135 / 512
    dxy = (m["scan_marks"] + 0.5 - 512) * np.array([1, -1]) * 0.135 / 512
    nx, dx = nxy[marks].mean(0), dxy[marks].mean(0)
    sc = np.sqrt(np.sum((nxy[marks] - nx) ** 2) / np.sum((dxy[marks] - dx) ** 2))
    shift = nx - sc * dx
    core = [i for i in interior if good(i)]
    depth = np.median(ni[core, 2] - sc * di[core, 2])

    def aligned(points):
        local = (points - m["scan_origin"]) @ m["scan_axes"].T * sc
        local += np.array([*shift, depth])
        return m["reference_origin"] + local @ m["native_axes"]

    xyz = aligned(d)
    base = n[marks]
    moves = xyz[marks] - base
    moves[:, 2] = np.where(np.isin(marks, outer), 0, moves[:, 2])
    moves[:, 2] = 0.009 * np.tanh(moves[:, 2] / 0.009)
    headCenter = n[1]
    anchors = (
        np.array(
            [
                [0, -0.13, -0.12],
                [0.11, -0.09, -0.07],
                [-0.11, -0.09, -0.07],
                [0.10, 0.07, -0.14],
                [-0.10, 0.07, -0.14],
                [0, 0.15, -0.09],
                [0, -0.10, -0.19],
                [0, 0.0, -0.2],
            ]
        )
        + headCenter
    )
    field = RBFInterpolator(
        np.vstack([base, anchors]) * 1000,
        np.vstack([moves, np.zeros_like(anchors)]),
        kernel="thin_plate_spline",
        smoothing=100,
    )

    def broad(x):
        xx = x - headCenter
        w = (
            step((xx[:, 1] + 0.124) / 0.046)
            * step((0.156 - xx[:, 1]) / 0.050)
            * step((xx[:, 2] + 0.158) / 0.062)
            * step((0.12 - abs(xx[:, 0])) / 0.030)
        )
        out = np.zeros_like(x)
        keep = w > 0
        out[keep] = field(x[keep] * 1000) * w[keep, None]
        return out * np.minimum(1, 0.012 / np.maximum(0.00001, norm(out)))[:, None]

    baseline = broad(verts)
    xf, yf = ref.chart[:, 1] * 541 / 512 - 0.5, (1 - ref.chart[:, 0] / 512) * 591 - 0.5

    def read(a):
        return cv2.remap(
            a.astype("f"),
            xf.astype("f")[:, None],
            yf.astype("f")[:, None],
            cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE,
        ).squeeze(1)

    src = read(m["native"])
    scan = read(m["donor"])
    fp = verts[ref.face]
    actual = aligned(scan) - fp
    dense = (
        read(m["weight"])
        * step((0.003 - norm(src - fp)) / 0.002)
        * step((0.020 - norm(actual - baseline[ref.face])) / 0.009)
    )
    diff = actual - baseline[ref.face]
    dist, near = cKDTree(fp).query(fp, k=120)
    wt = np.exp(-(dist**2) / (2 * 0.0045**2)) * dense[near]
    adjust = (
        np.einsum("ij,ijk->ik", wt, diff[near]) / np.maximum(1e-10, wt.sum(1))[:, None]
    )
    amount = norm(adjust)
    adjust *= (0.006 * np.tanh(amount / 0.006) / np.maximum(0.000001, amount))[:, None]
    uv = ref.chart
    lip = 1 - step(
        (np.hypot((uv[:, 0] - 256) / 55, (uv[:, 1] - 350) / 32) - 0.65) / 0.6
    )
    dense *= 1 - 0.8 * lip
    desired = baseline.copy()
    desired[ref.face] += 0.8 * dense[:, None] * adjust
    socket_moves = broad(np.array(ref.eyes))
    socket_moves[:, 2] = np.mean(socket_moves[:, 2])
    for eye, move in zip(ref.eyes, socket_moves):
        rr = norm(verts - eye)
        w = 1 - step((rr - 0.016) / 0.012)
        desired = desired * (1 - w[:, None]) + move * w[:, None]
    ids = np.arange(nat.meta["bodyVertices"])
    roi = norm(cage[ids] - headCenter) < 0.23
    roi &= (cage[ids, 1] > headCenter[1] - 0.15) & (
        abs(cage[ids, 0] - headCenter[0]) < 0.145
    )
    ids = ids[roi]
    nbody = nat.meta["bodyVertices"]
    off = nat.unpack("subOffsets", "<u4")
    ind = nat.unpack("subRefs", "<u2")
    val = nat.unpack("subFactors", "<f4")
    A = sparse.csr_matrix((val, ind, off), shape=(len(verts), nbody))[:, ids]
    keep = A.getnnz(axis=1) > 0
    A = A[keep]
    dy = desired[keep]
    ds, nb = cKDTree(cage[ids]).query(cage[ids], k=9)
    weights = np.exp(-np.minimum(20, ds[:, 1:] ** 2 / (2 * 0.004**2)))
    weights /= np.maximum(1e-18, weights.sum(1))[:, None]
    L = sparse.eye(len(ids)) - sparse.csr_matrix(
        (weights.ravel(), (np.repeat(np.arange(len(ids)), 8), nb[:, 1:].ravel())),
        shape=(len(ids), len(ids)),
    )
    system = (A.T @ A + 4 * L.T @ L + 0.055 * sparse.eye(len(ids))).tocsc()
    solve = factorized(system)
    data = A.T @ dy + 0.055 * broad(cage[ids])
    delta = np.stack([solve(data[:, j]) for j in range(3)], axis=1)
    whole = np.zeros_like(cage)
    whole[ids] = delta
    for group, move in zip(nat.meta["eyeGroups"], socket_moves):
        whole[group] = move
    use = np.flatnonzero(np.max(abs(whole), axis=1) > 0.000023)
    pred = A @ delta
    print(
        name,
        len(use),
        "residual mm",
        np.percentile(norm(pred - dy) * 1000, [50, 90, 99]).round(2),
        "max mm",
        norm(whole).max() * 1000,
        flush=True,
    )
    return dict(
        ids=enc(use.astype("<u2")),
        shift=enc(np.rint(whole[use] / 0.000002).astype("<i2")),
    )


out = {"scan" + n[3:7]: fit(n, frame) for n, frame in selnames.items()}
(p / "captured-geometry.json").write_text(json.dumps(out, separators=(",", ":")))
