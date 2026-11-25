"""Trim proxy triangles to an opacity contour so clay GLBs keep a geometric outline."""

import numpy as np


def cutout(corners, uv_indices, uv, image, encode):
    alpha = np.asarray(image.getchannel("A").resize((384, 384)))
    uv = np.asarray(uv)
    parents = []
    weights = []
    texture = []
    indices = []
    for start in range(0, len(corners), 3):
        tri = corners[start : start + 3]
        st = uv[uv_indices[start : start + 3]]
        cache = {}

        def sample(v):
            u, t = v @ st
            return (
                float(
                    alpha[
                        int(np.clip((1 - t) * 383, 0, 383)),
                        int(np.clip(u * 383, 0, 383)),
                    ]
                )
                - 94
            )

        def emit(poly):
            ids = []
            for bary in poly:
                key = tuple(np.rint(bary * 4000).astype(int))
                if key not in cache:
                    cache[key] = len(parents)
                    parents.append(tri)
                    weights.append(bary)
                    texture.append(bary @ st)
                ids.append(cache[key])
            for j in range(1, len(ids) - 1):
                indices.extend((ids[0], ids[j], ids[j + 1]))

        def visit(b, values, depth):
            center_value = sample(sum(b) / 3)
            if min(*values, center_value) > 12:
                emit(b)
                return
            if max(*values, center_value) < -12:
                return
            if depth:
                a, c, d = b
                ac = (a + c) / 2
                cd = (c + d) / 2
                da = (d + a) / 2
                for row in [[a, ac, da], [ac, c, cd], [da, cd, d], [ac, cd, da]]:
                    visit(row, [sample(v) for v in row], depth - 1)
            else:
                poly = []
                for k, q in enumerate(b):
                    p = b[k - 1]
                    v, w = values[k - 1], values[k]
                    if (v >= 0) != (w >= 0):
                        poly.append(p + (q - p) * v / (v - w))
                    if w >= 0:
                        poly.append(q)
                emit(poly)

        b = list(np.eye(3))
        visit(b, [sample(v) for v in b], 3)
    return dict(
        faceRefs=encode(parents, "<u2"),
        faceWeights=encode(np.rint(np.array(weights) * 65535), "<u2"),
        faceUV=encode(np.rint(np.clip(texture, 0, 1) * 65535), "<u2"),
        faceIndices=encode(indices, "<u4"),
    )
