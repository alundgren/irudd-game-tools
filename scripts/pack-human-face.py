"""Bake the CC0 eye, eyelash and eyebrow proxies from makehuman_system_assets_cc0.zip.

Each eye is the source's outer shell with its cornea dome, kept as one opaque surface with
flat front-on texture coordinates for a generated iris. Brows become tapered strands traced
along the artist's strokes and lashes are grown from the lid edge of the source cards, so
they need no transparency and keep their form in clay and game exports.

Usage: python scripts/pack-human-face.py extracted_system_pack character-view/human-face-data.json
"""
import base64
import json
import pathlib
import sys
import zlib

import numpy as np
from PIL import Image
from scipy import ndimage


def encode(values, dtype):
    return base64.b64encode(zlib.compress(np.asarray(values, dtype=dtype).tobytes(), 9)).decode()


def read_proxy(folder, name):
    lines = (folder / (name + ".mhclo")).read_text(encoding="utf8").splitlines()
    refs, weights, offsets = [], [], []
    for line in lines[lines.index("verts 0") + 1:]:
        f = line.split()
        if not f:
            continue
        if not f[0].isdigit():
            break
        if len(f) == 1:
            f = f * 3 + [1, 0, 0, 0, 0, 0]
        refs.append(f[:3])
        weights.append(f[3:6])
        offsets.append([0.1 * float(v) for v in f[6:9]])
    points, tex, corners, uv_indices = [], [], [], []
    for line in (folder / (name + ".obj")).read_text().splitlines():
        f = line.split()
        if f[:1] == ["v"]:
            points.append(list(map(float, f[1:4])))
        if f[:1] == ["vt"]:
            tex.append(list(map(float, f[1:3])))
        if f[:1] == ["f"]:
            vs = [x.split("/") for x in f[1:]]
            for i in range(1, len(vs) - 1):
                for v in [vs[0], vs[i], vs[i + 1]]:
                    corners.append(int(v[0]) - 1)
                    uv_indices.append(int(v[1]) - 1)
    return dict(refs=np.array(refs, int), weights=np.array(weights, float), offsets=np.array(offsets),
                points=np.array(points), tex=np.array(tex), corners=np.array(corners), uv=np.array(uv_indices))


def binding(p):
    return dict(refs=encode(p["refs"], "<u2"), weights=encode(p["weights"], "<f4"), offsets=encode(p["offsets"], "<f4"))


def eyes(root):
    p = read_proxy(root / "eyes" / "high-poly", "high-poly")
    alpha = np.asarray(Image.open(root / "eyes" / "materials" / "brown_eye.png").convert("RGBA").getchannel("A"))
    points, tri = p["points"], p["corners"].reshape(-1, 3)
    uv = p["tex"][p["uv"].reshape(-1, 3)].mean(1)
    x = np.clip((uv[:, 0] * alpha.shape[1]).astype(int), 0, alpha.shape[1] - 1)
    y = np.clip(((1 - uv[:, 1]) * alpha.shape[0]).astype(int), 0, alpha.shape[0] - 1)
    shell = tri[alpha[y, x] < 32]
    used = np.unique(shell)
    planar = np.full((len(points), 2), 0.5)
    for side in (1, -1):
        ids = used[points[used, 0] * side > 0]
        box = points[ids]
        middle = (box.min(0) + box.max(0)) / 2
        radius = (box[:, :2].max(0) - box[:, :2].min(0)).max() / 2
        planar[ids] = 0.5 + (box[:, :2] - middle[:2]) / (2 * radius)
    renumber = np.full(len(points), -1)
    renumber[used] = np.arange(len(used))
    print("eyes", len(shell), "triangles", len(used), "vertices")
    return dict(refs=encode(p["refs"][used], "<u2"), weights=encode(p["weights"][used], "<f4"),
                offsets=encode(p["offsets"][used], "<f4"), uv=encode(planar[used], "<f4"),
                corners=encode(renumber[shell], "<u2"))


def trace(image, spacing, max_width, min_length, seed, max_length=400, hairs=False):
    """Follow the painted strokes. Returns polylines of (x, y, half width) in pixels."""
    rgba = np.asarray(image.convert("RGBA"), float) / 255
    alpha = rgba[..., 3]
    soft = ndimage.gaussian_filter(alpha, 1.1)
    ink = ndimage.gaussian_filter(alpha * (1 - rgba[..., :3].mean(-1)), 0.8) if hairs else soft
    gy, gx = np.gradient(ink)
    blur = 2.0 if hairs else 3.2
    tensor = [ndimage.gaussian_filter(v, blur) for v in (gx * gx, gx * gy, gy * gy)]
    angle = 0.5 * np.arctan2(2 * tensor[1], tensor[0] - tensor[2]) + np.pi / 2
    field = np.stack([np.cos(angle), np.sin(angle)], -1)
    mask = soft > 0.3
    reach = soft > (0.3 if hairs else 0.16)
    depth = ndimage.distance_transform_edt(mask)
    covered = np.zeros_like(mask)
    h, w = mask.shape
    rng = np.random.default_rng(seed)
    order = np.argwhere(mask & (depth >= 1))
    rank = rng.random(len(order)) if hairs else -depth[order[:, 0], order[:, 1]] + rng.random(len(order)) * 0.8
    order = order[np.argsort(rank)]
    outward = None
    if hairs:
        labels, count = ndimage.label(mask)
        outward = np.zeros((count + 1, 2))
        for k in range(1, count + 1):
            ys, xs = np.nonzero(labels == k)
            if len(xs) < 200:
                continue
            left, right = xs < np.percentile(xs, 25), xs > np.percentile(xs, 75)
            thick_left = depth[ys[left], xs[left]].mean() > depth[ys[right], xs[right]].mean()
            outward[k] = [1 if thick_left else -1, -0.35]

    def sample(grid, p):
        return grid[int(np.clip(round(p[1]), 0, h - 1)), int(np.clip(round(p[0]), 0, w - 1))]

    def walk(start, direction, steps):
        path, p, d = [], np.array(start, float), direction
        for _ in range(steps):
            v = sample(field, p)
            if v @ d < 0:
                v = -v
            if v @ d < 0.93:
                break
            d = v
            p = p + d
            if not (0 <= p[0] < w and 0 <= p[1] < h) or not sample(reach, p):
                break
            path.append(p.copy())
        return path

    strands = []
    yy, xx = np.mgrid[-spacing:spacing + 1, -spacing:spacing + 1]
    stamp = xx * xx + yy * yy <= spacing * spacing
    for y, x in order:
        if covered[y, x]:
            continue
        first = sample(field, (x, y))
        if hairs:
            if first @ outward[labels[y, x]] < 0:
                first = -first
            length = int(max_length * (0.55 + 0.45 * rng.random()))
            line = [np.array([x, y], float)] + walk((x, y), first, length)
        else:
            line = walk((x, y), -first, max_length)[::-1] + [np.array([x, y], float)] + walk((x, y), first, max_length)
        for p in line:
            py, px = int(round(p[1])), int(round(p[0]))
            y0, y1, x0, x1 = max(0, py - spacing), min(h, py + spacing + 1), max(0, px - spacing), min(w, px + spacing + 1)
            covered[y0:y1, x0:x1] |= stamp[y0 - py + spacing:y1 - py + spacing, x0 - px + spacing:x1 - px + spacing]
        if len(line) < min_length:
            continue
        line = np.array(line)
        widths = np.array([min(max_width, max(0.5, sample(depth, p))) for p in line])
        third = max(1, len(line) // 3)
        if not hairs and widths[:third].mean() < widths[-third:].mean():
            line, widths = line[::-1], widths[::-1]
        strands.append(np.column_stack([line, widths]))
    return strands


def ribbons(strands, points_per_strand, rng):
    """Resample each stroke to a tapered ribbon. Returns pixel vertices, faces and per-vertex data."""
    vertices, faces, along, roots = [], [], [], []
    for index in rng.permutation(len(strands)):
        s = strands[index]
        t = np.linspace(0, len(s) - 1, points_per_strand)
        line = np.column_stack([np.interp(t, np.arange(len(s)), s[:, k]) for k in range(3)])
        tangent = np.gradient(line[:, :2], axis=0)
        tangent /= np.linalg.norm(tangent, axis=1, keepdims=True) + 1e-9
        normal = np.column_stack([-tangent[:, 1], tangent[:, 0]])
        root = len(vertices)
        base = max(line[0, 2], 0.8)
        for k in range(points_per_strand - 1):
            fraction = k / (points_per_strand - 1)
            half = max(0.45, min(line[k, 2], base) * (1 - 0.55 * fraction))
            for sign in (-1, 1):
                vertices.append(line[k, :2] + sign * half * normal[k])
                along.append(fraction)
                roots.append(root)
        vertices.append(line[-1, :2])
        along.append(1)
        roots.append(root)
        for k in range(points_per_strand - 2):
            a = root + 2 * k
            faces.extend([(a, a + 1, a + 2), (a + 1, a + 3, a + 2)])
        a = root + 2 * (points_per_strand - 2)
        faces.append((a, a + 1, a + 2))
    return np.array(vertices), np.array(faces), np.array(along), np.array(roots)


def locate(card, uv):
    """Barycentric card coordinates for texture points. Returns one entry per card island hit."""
    tri = card["corners"].reshape(-1, 3)
    tu = card["tex"][card["uv"].reshape(-1, 3)]
    a, b, c = tu[:, 0], tu[:, 1], tu[:, 2]
    det = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (b[:, 1] - a[:, 1])
    hits = []
    for p in uv:
        w1 = ((p[0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (c[:, 0] - a[:, 0]) * (p[1] - a[:, 1])) / det
        w2 = ((b[:, 0] - a[:, 0]) * (p[1] - a[:, 1]) - (p[0] - a[:, 0]) * (b[:, 1] - a[:, 1])) / det
        w0 = 1 - w1 - w2
        worst = np.minimum(np.minimum(w0, w1), w2)
        inside = np.nonzero(worst > -1e-6)[0]
        if not len(inside):
            inside = [int(np.argmax(worst))] if worst.max() > -0.04 else []
        hits.append([(tri[i], np.clip([w0[i], w1[i], w2[i]], 0, 1)) for i in inside])
    return hits


def strands(root, folder, name, spacing, max_width, min_length, points_per_strand, seed, **options):
    card = read_proxy(root / folder / name, name)
    image = Image.open(root / folder / name / (name + ".png"))
    size = image.size[0]
    traced = trace(image, spacing, max_width, min_length, seed, **options)
    pixels, faces, along, roots = ribbons(traced, points_per_strand, np.random.default_rng(seed))
    uv = np.column_stack([pixels[:, 0] / size, 1 - pixels[:, 1] / size])
    hits = locate(card, uv)
    parents, blend, index, t, base, tri_out = [], [], {}, [], [], []
    islands = card_islands(card)
    per_strand = 2 * (points_per_strand - 2) + 1
    for first in range(0, len(faces), per_strand):
        group = faces[first:first + per_strand]
        corners = np.unique(group)
        options = {}
        for corner in corners:
            for tri, w in hits[corner]:
                options.setdefault(islands[tri[0]], {})[corner] = (tri, w)
        for island, found in options.items():
            if len(found) < len(corners):
                continue
            for corner in corners:
                index[(corner, island)] = len(parents)
                parents.append(found[corner][0])
                blend.append(found[corner][1])
                t.append(along[corner])
                base.append((roots[corner], island))
            tri_out.extend([[index[(corner, island)] for corner in face] for face in group])
    base = [index.get(key, i) for i, key in enumerate(base)]
    print(name, len(traced), "strokes", len(tri_out), "triangles")
    out = dict(**binding(card), triRefs=encode(parents, "<u2"), triWeights=encode(blend, "<f4"),
               triIndices=encode(tri_out, "<u4"), along=encode(np.rint(np.array(t) * 255), "u1"),
               root=encode(base, "<u2"), points=points_per_strand)
    return out


def card_islands(card):
    parent = list(range(len(card["points"])))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for a, b, c in card["corners"].reshape(-1, 3):
        parent[find(b)] = find(a)
        parent[find(c)] = find(a)
    return [find(i) for i in range(len(parent))]


def card_rows(card, members):
    """The two long edges of a strip of quads, as ordered texture polylines."""
    tri = card["corners"].reshape(-1, 3)
    tex = card["uv"].reshape(-1, 3)
    uv_of, uses = {}, {}
    for face, face_uv in zip(tri, tex):
        if face[0] not in members:
            continue
        for k in range(3):
            uv_of[face[k]] = card["tex"][face_uv[k]]
            edge = tuple(sorted((face[k], face[(k + 1) % 3])))
            uses[edge] = uses.get(edge, 0) + 1
    border = [e for e, n in uses.items() if n == 1]
    links = {}
    for a, b in border:
        links.setdefault(a, []).append(b)
        links.setdefault(b, []).append(a)
    loop = [border[0][0]]
    while True:
        options = [v for v in links[loop[-1]] if len(loop) < 2 or v != loop[-2]]
        if options[0] == loop[0] or len(loop) > len(links):
            break
        loop.append(options[0])
    points = np.array([uv_of[v] for v in loop])
    before, after = np.roll(points, 1, 0) - points, np.roll(points, -1, 0) - points
    turn = np.einsum("ij,ij->i", before, after) / (np.linalg.norm(before, axis=1) * np.linalg.norm(after, axis=1))
    corners = sorted(np.argsort(-turn)[:4])
    sides = []
    for k in range(4):
        i, j = corners[k], corners[(k + 1) % 4]
        sides.append(points[i:j + 1] if j > i else np.vstack([points[i:], points[:j + 1]]))
    sides.sort(key=len)
    first, second = sides[2], sides[3]
    if np.linalg.norm(first[0] - second[0]) > np.linalg.norm(first[0] - second[-1]):
        second = second[::-1]
    return first, second


def along_line(line, fraction):
    steps = np.r_[0, np.cumsum(np.linalg.norm(np.diff(line, axis=0), axis=1))]
    return np.array([np.interp(fraction * steps[-1], steps, line[:, k]) for k in range(2)])


def lashes(root, per_centimetre=19, seed=7):
    """Grow lashes from the lid edge of each source card.

    The painted lashes give the direction of growth and how long the row is at each
    point. Each hair is rooted on the card's lid edge, so it can be re-aimed, shortened
    or thinned later without leaving the lid.
    """
    name = "eyelashes01"
    card = read_proxy(root / "eyelashes" / name, name)
    image = Image.open(root / "eyelashes" / name / (name + ".png")).convert("RGBA")
    size = image.size[0]
    alpha = np.asarray(image, float)[..., 3] / 255
    soft = ndimage.gaussian_filter(alpha, 1.1)
    depth = ndimage.distance_transform_edt(soft > 0.3)
    gy, gx = np.gradient(soft)
    tensor = [ndimage.gaussian_filter(v, 5) for v in (gx * gx, gx * gy, gy * gy)]
    angle = 0.5 * np.arctan2(2 * tensor[1], tensor[0] - tensor[2]) + np.pi / 2
    field = np.stack([np.cos(angle), np.sin(angle)], -1)
    pixel = lambda uv: np.array([uv[0] * size, (1 - uv[1]) * size])
    sample = lambda grid, p: grid[int(np.clip(round(p[1]), 0, size - 1)), int(np.clip(round(p[0]), 0, size - 1))]
    islands = np.array(card_islands(card))
    rng = np.random.default_rng(seed)
    parents, blend, t_out, base, low, faces = [], [], [], [], [], []
    heights = {i: card["points"][islands == i][:, 1].mean() for i in set(islands)}
    middle = np.median(list(heights.values()))
    for island in sorted(set(islands)):
        members = set(np.nonzero(islands == island)[0])
        rows = card_rows(card, members)
        ink = [np.mean([sample(depth, pixel(along_line(a, f)) * 0.88 + pixel(along_line(b, f)) * 0.12)
                        for f in np.linspace(0.05, 0.95, 60)]) for a, b in (rows, rows[::-1])]
        lid, tips = (rows[0], rows[1]) if ink[0] > ink[1] else (rows[1], rows[0])
        sub = dict(card, corners=card["corners"].reshape(-1, 3)[[c in members for c in card["corners"][::3]]].ravel(),
                   uv=card["uv"].reshape(-1, 3)[[c in members for c in card["corners"][::3]]].ravel())
        stations = np.linspace(0, 1, 48)
        reach = []
        for f in stations:
            a, b = pixel(along_line(lid, f)), pixel(along_line(tips, f))
            inked = [k for k in np.linspace(0, 1, 60) if sample(soft, a + (b - a) * k) > 0.16]
            reach.append(max(inked) if inked else 0)
        reach = ndimage.gaussian_filter1d(np.array(reach), 1.5, mode="nearest")
        lid_points = card["points"][list(members)]
        width = np.ptp(lid_points[:, 0]) * 10
        count = int(round(width * per_centimetre))
        def side(f):
            q = pixel(along_line(lid, f)) * 0.9 + pixel(along_line(tips, f)) * 0.1
            hit = locate(sub, np.array([[q[0] / size, 1 - q[1] / size]]))[0]
            return abs((card["points"][hit[0][0]] * np.asarray(hit[0][1])[:, None]).sum(0)[0]) if hit else 0
        outer_last = side(0.9) > side(0.1)
        for n in range(count):
            f = (n + 0.15 + 0.7 * rng.random()) / count
            out = f if outer_last else 1 - f
            if out < 0.1 or out > 0.985:
                continue
            a, b = pixel(along_line(lid, f)), pixel(along_line(tips, f))
            taper = min(1, 0.45 + 6 * (out - 0.1), 0.6 + 8 * (0.985 - out))
            length = np.interp(f, stations, reach) * np.linalg.norm(b - a) * (0.62 + 0.38 * rng.random()) * taper
            if length < 5:
                continue
            p, d, line = a + (b - a) * 0.02, (b - a) / np.linalg.norm(b - a), []
            for _ in range(int(length)):
                line.append(p.copy())
                v = sample(field, p)
                if v @ d < 0:
                    v = -v
                d = d * 0.82 + v * 0.18 if v @ d > 0.5 else d
                d /= np.linalg.norm(d)
                p = p + d
            line = np.array(line)
            thickness = 1.25 + 0.5 * rng.random()
            stroke = np.column_stack([line, np.linspace(thickness, thickness * 0.35, len(line))])
            pixels, tri, along, roots = ribbons([stroke], 4, rng)
            uv = np.column_stack([pixels[:, 0] / size, 1 - pixels[:, 1] / size])
            hits = locate(sub, uv)
            if any(not h for h in hits):
                continue
            first = len(parents)
            for k, hit in enumerate(hits):
                parents.append(hit[0][0])
                blend.append(hit[0][1])
                t_out.append(along[k])
                base.append(first)
                low.append(heights[island] < middle)
            faces.extend((tri + first).tolist())
    print(name, len(set(base)), "lashes", len(faces), "triangles")
    return dict(**binding(card), triRefs=encode(parents, "<u2"), triWeights=encode(blend, "<f4"),
                triIndices=encode(faces, "<u4"), along=encode(np.rint(np.array(t_out) * 255), "u1"),
                root=encode(base, "<u2"), lower=encode(low, "u1"), points=4)


def pack(root, out):
    assets = {"eyes": eyes(root)}
    for name in ["eyebrow001", "eyebrow003"]:
        assets[name] = strands(root, "eyebrows", name, 2, 1.1, 9, 3, 11, max_length=36, hairs=True)
    assets["eyelashes01"] = lashes(root)
    out.write_text(json.dumps(assets, separators=(",", ":")) + "\n")
    print(out.stat().st_size, "bytes")


if __name__ == "__main__":
    pack(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]))
