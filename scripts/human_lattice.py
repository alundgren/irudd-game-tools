"""Geodesic control weights for freeform editing on the CC0 human cage."""

from collections import defaultdict
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree


def lattice(points, faces, count, bone_ids, names, encode):
    body = points[:count]
    cells = defaultdict(list)
    for i, v in enumerate(body):
        name = names[bone_ids[i, 0]]
        step = (
            0.022
            if name == "head"
            else 0.021
            if "hand_" in name
            or any(k in name for k in ["index", "ring", "thumb", "middle", "pinky"])
            else 0.057
        )
        cells[(step, *np.floor(v / step).astype(int))].append(i)
    anchors = []
    for key, vs in cells.items():
        center = body[vs].mean(0)
        anchors.append(vs[np.argmin(((body[vs] - center) ** 2).sum(1))])
    anchors = np.array(sorted(anchors))
    edges = np.concatenate((faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]))
    edges = np.unique(np.sort(edges, axis=1), axis=0)
    lengths = np.maximum(
        1e-6, np.linalg.norm(body[edges[:, 0]] - body[edges[:, 1]], axis=1)
    )
    graph = coo_matrix(
        (
            np.tile(lengths, 2),
            (np.r_[edges[:, 0], edges[:, 1]], np.r_[edges[:, 1], edges[:, 0]]),
        ),
        shape=(count, count),
    ).tocsr()
    nearest = np.zeros((count, 4), dtype=np.int32)
    dist = np.full((count, 4), np.inf)
    for start in range(0, len(anchors), 96):
        batch = dijkstra(
            graph, indices=anchors[start : start + 96], directed=False, limit=0.36
        ).T
        candidates = np.concatenate((dist, batch), axis=1)
        keep = np.argpartition(candidates, 3, axis=1)[:, :4]
        local = keep - 4 + start
        ix = keep < 4
        local[ix] = nearest[np.nonzero(ix)[0], keep[ix]]
        nearest = local
        dist = np.take_along_axis(candidates, keep, axis=1)
    missing = np.all(~np.isfinite(dist), axis=1)
    tree = cKDTree(body[anchors])
    if missing.any():
        dist[missing], nearest[missing] = tree.query(body[missing], k=4)
    weights = 1 / np.maximum(dist, 0.0025) ** 2.0
    weights /= weights.sum(1, keepdims=True)
    d, near = tree.query(points[count:], k=4)
    w = 1 / np.maximum(d, 0.0025) ** 2
    w /= w.sum(1, keepdims=True)
    encode("controlIds", anchors, "<u2")
    encode("controlRefs", np.vstack((nearest, near)), "<u2")
    encode("controlWeights", np.rint(65535 * np.vstack((weights, w))), "<u2")
    print(len(anchors), "surface control vertices")
