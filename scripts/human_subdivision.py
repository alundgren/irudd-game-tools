"""One Catmull-Clark step on the welded CC0 quad cage; compile sparse stencils."""

from collections import defaultdict

import numpy as np


def subdivision(polygons, tex_polygons, uv, body_n, bone_ids, weights, encode):
    edge_faces = defaultdict(list)
    vertex_faces = defaultdict(list)
    neighbours = defaultdict(set)

    def edge(a, b):
        return tuple(sorted((a, b)))

    for f, poly in enumerate(polygons):
        for i, a in enumerate(poly):
            b = poly[(i + 1) % len(poly)]
            edge_faces[edge(a, b)].append(f)
            vertex_faces[a].append(f)
            neighbours[a].add(b)
            neighbours[b].add(a)
    edge_ids = {e: body_n + i for i, e in enumerate(edge_faces)}
    face_offset = body_n + len(edge_ids)
    stencils = []
    for a in range(body_n):
        boundary = [b for b in neighbours[a] if len(edge_faces[edge(a, b)]) == 1]
        row = defaultdict(float)
        if len(boundary) == 2:
            row[a] = 0.75
            for b in boundary:
                row[b] += 0.125
        elif boundary or not neighbours[a]:
            row[a] = 1
        else:
            n = len(vertex_faces[a])
            row[a] = (n - 2) / n
            for b in neighbours[a]:
                row[b] += 1 / (n * n)
            for f in vertex_faces[a]:
                for b in polygons[f]:
                    row[b] += 1 / (n * n * len(polygons[f]))
        stencils.append(row)
    for (a, b), faces in edge_faces.items():
        row = defaultdict(float)
        if len(faces) == 2:
            row[a] = row[b] = 0.25
            for f in faces:
                for v in polygons[f]:
                    row[v] += 0.25 / len(polygons[f])
        else:
            row[a] = row[b] = 0.5
        stencils.append(row)
    for poly in polygons:
        stencils.append({v: 1 / len(poly) for v in poly})
    corners = []
    tex = list(uv)
    tex_ids = {
        tuple(np.rint(np.array(x) * 65535).astype(int)): i for i, x in enumerate(tex)
    }
    tex_corners = []

    def tex_id(point):
        key = tuple(np.rint(np.asarray(point) * 65535).astype(int))
        if key not in tex_ids:
            tex_ids[key] = len(tex)
            tex.append(point)
        return tex_ids[key]

    for f, (poly, face_uv) in enumerate(zip(polygons, tex_polygons)):
        texcoords = np.array([uv[i] for i in face_uv])
        center = tex_id(texcoords.mean(0))
        mids = [
            tex_id((p + texcoords[(i + 1) % len(poly)]) / 2)
            for i, p in enumerate(texcoords)
        ]
        for i, a in enumerate(poly):
            out = [
                a,
                edge_ids[edge(a, poly[(i + 1) % len(poly)])],
                face_offset + f,
                edge_ids[edge(poly[i - 1], a)],
            ]
            tu = [face_uv[i], mids[i], center, mids[i - 1]]
            for k in [0, 1, 2, 0, 2, 3]:
                corners.append(out[k])
                tex_corners.append(tu[k])
    offsets = [0]
    refs = []
    coeffs = []
    bones = []
    blended = []
    for row in stencils:
        total = sum(row.values())
        assert abs(total - 1) < 1e-6
        refs.extend(row)
        coeffs.extend(row.values())
        offsets.append(len(refs))
        influences = defaultdict(float)
        for v, factor in row.items():
            for b, w in zip(bone_ids[v], weights[v]):
                if w:
                    influences[int(b)] += float(w) * factor
        top = sorted(influences.items(), key=lambda x: -x[1])[:4]
        denom = sum(w for _, w in top)
        bi = [b for b, _ in top]
        bw = [round(65535 * w / denom) for _, w in top]
        bw[0] += 65535 - sum(bw)
        bones.extend(bi + [0] * (4 - len(bi)))
        blended.extend(bw + [0] * (4 - len(bw)))
    encode(
        "subParent",
        [f for f, poly in enumerate(polygons) for _ in range(len(poly) * 2)],
        "<u2",
    )
    encode("quadIds", [p + [p[-1]] * (4 - len(p)) for p in polygons], "<u2")
    encode("subOffsets", offsets, "<u4")
    encode("subRefs", refs, "<u2")
    encode("subFactors", coeffs, "<f4")
    encode("subIndices", corners, "<u4")
    encode("subUV", np.rint(np.clip(tex, 0, 1) * 65535), "<u2")
    encode("subFaceUV", tex_corners, "<u4")
    encode("subBones", bones, "u1")
    encode("subWeights", blended, "<u2")
    return np.asarray(tex)
