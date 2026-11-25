"""Pack the Blender Studio Rain head as an artist-made face family for the editable adult.

  python scripts/pack-human-studio-head.py RAIN.npz NATIVE.json TEXTURES_DIR [--scale 0.9] [--preview DIR]

RAIN.npz comes from scripts/studio-head-extract.py, NATIVE.json from scripts/studio-head-native.mjs and
TEXTURES_DIR is the `textures` folder of the Rain v3 download. All three are third-party or derived
working material and stay under the ignored .reference-cache/ directory. The packed result,
character-view/human-studio-head-data.json, carries the credit and licence of its source.

Rain Rig (CC) Blender Foundation | studio.blender.org, CC BY 4.0,
https://studio.blender.org/characters/rain/v3/

What is packed, all in the frame of the native default adult (metres, Y up, facing +Z):

  control points   every vertex of the artist's head, placed on the native adult, each with the point of
                   the native skin it corresponds to. The editor moves a control point by what the native
                   skin does at that point, so every head control moves the artist's head.
  skin             the part of the head drawn, cut inside the native head and laid onto the native skin
                   toward the cut, where it is sewn to the native neck.
  expressions      Blink, Smile and BrowLift posed with the artist's own face rig.
  eyes, brows, lashes, hair   the matching pieces, tied to the control points they sit on.
  paint            skin, eye and hair colour maps with the source colour they are re-tinted from.
"""
import argparse, base64, json, zlib
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

Image.MAX_IMAGE_PIXELS = None
root = Path(__file__).resolve().parents[1]

# name: (kind, source pick, native pick), in centimetres. 'f' picks are (x, y) seen from the front and land on
# the first skin a ray from the front meets; 's' picks are (z, y) seen from the side; 'p' is a plain point.
# Picks off the middle are mirrored.
LANDMARKS = {
    'eyeInner': ('f', (2.7, 146.9), (1.92, 160.95)), 'eyeOuter': ('f', (7.9, 147.1), (4.36, 161.05)),
    'eyeTop': ('f', (5.3, 148.95), (3.1, 161.5)), 'eyeBottom': ('f', (5.3, 145.45), (3.1, 160.42)),
    'browInner': ('f', (2.2, 149.8), (1.5, 162.0)), 'browPeak': ('f', (5.5, 150.4), (3.3, 162.4)), 'browOuter': ('f', (9.0, 149.3), (5.3, 162.0)),
    'nasion': ('f', (0, 147.3), (0, 161.2)), 'noseTip': ('f', (0, 142.9), (0, 157.5)), 'alar': ('f', (2.5, 142.5), (1.8, 157.2)),
    'subnasale': ('f', (0, 141.5), (0, 156.5)), 'bridge': ('f', (0, 145.0), (0, 159.3)),
    'mouthCorner': ('f', (3.3, 139.2), (2.4, 154.3)), 'lipTop': ('f', (0, 140.0), (0, 155.2)), 'lipBottom': ('f', (0, 137.9), (0, 153.2)),
    'chin': ('f', (0, 136.2), (0, 151.0)), 'cheek': ('f', (6.0, 142.5), (3.9, 157.2)), 'jawSide': ('f', (7.0, 139.0), (5.0, 154.0)),
    'cheekbone': ('f', (8.6, 145.0), (5.6, 159.3)), 'forehead': ('f', (0, 153.5), (0, 166.0)), 'foreheadSide': ('f', (6.0, 153.5), (4.2, 166.0)),
    'hairline': ('f', (0, 158.0), (0, 169.3)), 'temple': ('f', (9.6, 151.0), (6.3, 163.6)),
    'earCentre': ('s', (3.0, 146.0), (5.3, 159.3)), 'earTop': ('s', (1.6, 149.8), (4.6, 161.4)), 'earLobe': ('s', (4.4, 142.6), (6.0, 157.1)),
    'earBack': ('s', (0.2, 146.5), (4.0, 159.5)),
    'jawAngle': ('s', (5.0, 139.5), (6.5, 153.3)), 'sideSkull': ('s', (0, 154.0), (3.0, 166.0)), 'behindEar': ('s', (-3.0, 145.0), (1.0, 159.0)),
    'top': ('p', (0, 162.39, 2.0), (0, 171.9, 3.5)), 'back': ('p', (0, 150.0, -8.99), (0, 163.5, -4.9)), 'crownBack': ('p', (0, 158.5, -6.2), (0, 169.5, -2.6)),
    'underChin': ('p', (0, 134.6, 9.0), (0, 149.3, 9.5)), 'nape': ('p', (0, 141.0, -5.4), (0, 157.3, -2.6)),
}
# The landmarks that hold the lower face over the native neck.
SEATED = ('chin', 'underChin', 'jawAngle', 'mouthCorner', 'nape', 'earLobe')
EXPRESSIONS = ('Blink', 'Smile', 'BrowLift')
CREDIT = {
    'credit': 'Rain Rig (CC) Blender Foundation | studio.blender.org',
    'source': 'https://studio.blender.org/characters/rain/v3/',
    'license': 'https://creativecommons.org/licenses/by/4.0/',
    'changes': 'Head, eyes, brows, lashes and hair fitted to an editable adult; neck joined to the adult body; colour maps resized and re-tinted.',
}


def ray(P, T, origin, direction):
    a, b, c = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    e1, e2 = b - a, c - a
    h = np.cross(direction, e2)
    det = (e1 * h).sum(1)
    ok = np.abs(det) > 1e-12
    f = np.where(ok, 1 / np.where(ok, det, 1), 0)
    s = origin - a
    u = f * (s * h).sum(1)
    q = np.cross(s, e1)
    v = f * (q @ direction)
    t = f * (e2 * q).sum(1)
    hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0)
    return origin + direction * t[hit].min() if hit.any() else None


def place(P, T, kind, pick):
    pick = np.array(pick) / 100
    if kind == 'p':
        return [pick] if abs(pick[0]) < 1e-9 else [pick, pick * [-1, 1, 1]]
    if kind == 'f':
        out = [ray(P, T, np.array([sx * pick[0], pick[1], 1.0]), np.array([0, 0, -1.])) for sx in ([1] if abs(pick[0]) < 1e-9 else [1, -1])]
    else:
        out = [ray(P, T, np.array([sx * 1.0, pick[1], pick[0]]), np.array([-sx, 0, 0.])) for sx in (1, -1)]
    if any(o is None for o in out):
        raise RuntimeError(f'No skin under the {kind} pick {pick}.')
    return out


def landmarks(source, tri, native, native_tri, source_eyes, native_eyes):
    A, B, names = [], [], []
    for name, (kind, a, b) in LANDMARKS.items():
        for k, (x, y) in enumerate(zip(place(source, tri, kind, a), place(native, native_tri, kind, b))):
            A.append(x)
            B.append(y)
            names.append(name)
    A += list(source_eyes)
    B += list(native_eyes)
    names += ['eyeball', 'eyeball']
    return np.array(A), np.array(B), names


def thin_plate(A, B):
    """The smoothest map taking the points A to B."""
    n = len(A)
    K = np.linalg.norm(A[:, None] - A[None], axis=2) + 1e-6 * np.eye(n)
    Pm = np.hstack([np.ones((n, 1)), A])
    M = np.zeros((n + 4, n + 4))
    M[:n, :n] = K
    M[:n, n:] = Pm
    M[n:, :n] = Pm.T
    W = np.linalg.solve(M, np.vstack([B, np.zeros((4, 3))]))
    return lambda X: np.linalg.norm(X[:, None] - A[None], axis=2) @ W[:n] + np.hstack([np.ones((len(X), 1)), X]) @ W[n:]


def closest_on(a, b, c, p):
    ab, ac, ap = b - a, c - a, p - a
    d1, d2 = (ab * ap).sum(1), (ac * ap).sum(1)
    bp = p - b
    d3, d4 = (ab * bp).sum(1), (ac * bp).sum(1)
    cp = p - c
    d5, d6 = (ab * cp).sum(1), (ac * cp).sum(1)
    vc = d1 * d4 - d3 * d2
    vb = d5 * d2 - d1 * d6
    va = d3 * d6 - d5 * d4
    den = va + vb + vc
    den = np.where(np.abs(den) < 1e-30, 1, den)
    w = np.stack([1 - vb / den - vc / den, vb / den, vc / den], 1)
    z, one = np.zeros(len(p)), np.ones(len(p))

    def use(mask, values):
        w[mask] = values[mask]
    t = np.clip(d1 / np.where(d1 - d3 == 0, 1, d1 - d3), 0, 1)
    use((vc <= 0) & (d1 >= 0) & (d3 <= 0), np.stack([1 - t, t, z], 1))
    t = np.clip(d2 / np.where(d2 - d6 == 0, 1, d2 - d6), 0, 1)
    use((vb <= 0) & (d2 >= 0) & (d6 <= 0), np.stack([1 - t, z, t], 1))
    num = d4 - d3
    t = np.clip(num / np.where(num + d5 - d6 == 0, 1, num + d5 - d6), 0, 1)
    use((va <= 0) & (num >= 0) & (d5 - d6 >= 0), np.stack([z, 1 - t, t], 1))
    use((d1 <= 0) & (d2 <= 0), np.stack([one, z, z], 1))
    use((d3 >= 0) & (d4 <= d3), np.stack([z, one, z], 1))
    use((d6 >= 0) & (d5 <= d6), np.stack([z, z, one], 1))
    return w[:, :1] * a + w[:, 1:2] * b + w[:, 2:] * c, w


def closest(P, T, X, k=24):
    """For each X the closest point of a triangle mesh: triangle, corner shares, point, distance."""
    _, near = cKDTree(P[T].mean(1)).query(X, k=k)
    best = np.full(len(X), np.inf)
    tri = np.zeros(len(X), int)
    share = np.zeros((len(X), 3))
    point = np.zeros((len(X), 3))
    for j in range(k):
        t = near[:, j]
        q, w = closest_on(P[T[t, 0]], P[T[t, 1]], P[T[t, 2]], X)
        d = np.linalg.norm(q - X, axis=1)
        m = d < best
        best[m], tri[m], share[m], point[m] = d[m], t[m], w[m], q[m]
    return tri, share, point, best


def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def components(count, tri):
    parent = np.arange(count)

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for a, b, c in tri:
        ra, rb, rc = find(a), find(b), find(c)
        parent[rb] = ra
        parent[rc] = ra
    return np.array([find(i) for i in range(count)])


def boundary_loops(tri):
    """Open edges of a triangle mesh as closed loops of vertices, each in the winding of its triangles."""
    edges = {}
    for a, b, c in tri:
        for u, v in ((a, b), (b, c), (c, a)):
            edges[(u, v)] = edges.get((u, v), 0) + 1
    following = {u: v for (u, v) in edges if (v, u) not in edges}
    loops = []
    while following:
        start = next(iter(following))
        loop = [start]
        at = following.pop(start)
        while at != start and at in following:
            loop.append(at)
            at = following.pop(at)
        loops.append(loop)
    return loops


def packed(array, kind):
    return base64.b64encode(zlib.compress(np.ascontiguousarray(array, kind).tobytes(), 9)).decode()


def linear(c):
    c = np.asarray(c, float)
    return np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)


def flood(image, empty):
    """Carry the painted colour out over the unpainted background so that filtering never reads it."""
    _, (iy, ix) = ndimage.distance_transform_edt(empty, return_indices=True)
    return image[iy, ix]


def colour_map(path, side, box=None):
    image = Image.open(path).convert('RGB')
    if box:
        w, h = image.size
        image = image.crop((round(box[0] * w), round(box[1] * h), round(box[2] * w), round(box[3] * h)))
    work = np.asarray(image.resize((min(image.size[0], 2048),) * 2, Image.Resampling.LANCZOS))
    empty = work.max(2) < 6
    if empty.any() and not empty.all():
        work = flood(work, empty)
    small = np.asarray(Image.fromarray(work).resize((side, side), Image.Resampling.LANCZOS))
    tone = np.median(linear(np.asarray(image.resize((512, 512)))[~np.asarray(Image.fromarray(empty).resize((512, 512)))] / 255), 0)
    return small, tone


def bent_tail(points):
    """The tied hair is modelled standing straight back. Bend it from the tie down to the nape."""
    p = points.copy()
    length = np.maximum(0, -p[:, 2] - .107)
    angle = 1.23 * (1 - np.exp(-length / .11))
    rise = p[:, 1] - 1.58
    moved = length > 0
    p[moved, 2] = -(.107 + np.cos(angle) * length + np.sin(angle) * rise)[moved]
    p[:, 1] = np.where(moved, 1.58 - np.sin(angle) * length + np.cos(angle) * rise, p[:, 1])
    return p


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('rain')
    parser.add_argument('native')
    parser.add_argument('textures')
    parser.add_argument('--scale', type=float, default=.84)
    parser.add_argument('--band', type=float, default=.024, help='metres over which the skin settles onto the native neck')
    parser.add_argument('--out', default=str(root / 'character-view/human-studio-head-data.json'))
    args = parser.parse_args()
    R = np.load(args.rain)
    N = json.loads(Path(args.native).read_text())
    native = np.array(N['positions']).reshape(-1, 3)
    native_tri = np.array(N['tri']).reshape(-1, 3)
    bone = np.array(N['bone'])
    skin = np.isin(bone, [i for i, name in enumerate(N['names']) if name == 'head' or name.startswith('neck')])
    native_tri, bone = native_tri[skin], bone[skin]
    on_head = bone == N['head']
    source = R['head/points'].astype(float)
    tri = R['head/tri']
    count = len(source)

    # Where each point of the source head lies on the native skin.
    A, B, names = landmarks(source, tri, native, native_tri, [R['eyeL'][0].astype(float), R['eyeR'][0].astype(float)],
                            [np.array(e['centre']) for e in sorted(N['eyes'], key=lambda e: -e['centre'][0])])
    warp = thin_plate(A, B)
    at, share, meets, off = closest(native, native_tri, warp(source))
    print(f'correspondence: warped source to native skin, mean {off.mean() * 1000:.1f} mm, 95% {np.percentile(off, 95) * 1000:.1f} mm')

    # The source head on the native adult: its own shape, a little smaller, seated on the native jaw and nape.
    seated = np.array([name in SEATED for name in names])
    shift = B[seated].mean(0) - args.scale * A[seated].mean(0)
    shift[0] = 0
    put = lambda p: args.scale * np.asarray(p, float) + shift
    placed = put(source)

    # The native head ends under the jaw, where the neck is a separate piece. Cut the source head inside that
    # edge and settle it onto the native skin toward the cut.
    head_vertices = np.zeros(len(native), bool)
    head_vertices[np.unique(native_tri[on_head])] = True
    other = np.zeros(len(native), bool)
    other[np.unique(native_tri[~on_head])] = True
    edge = native[head_vertices & other]
    reach = cKDTree(edge).query(meets)[0]
    inside = on_head[at]
    kept = np.array([all(inside[v] and reach[v] > .006 for v in t) for t in tri])
    group = components(count, tri[kept])
    sizes = np.bincount(group[np.unique(tri[kept])], minlength=count)
    kept &= group[tri[:, 0]] == sizes.argmax()
    settle = np.where(inside, 1 - smooth(reach, .006, .006 + args.band), 1)
    # The ears keep the artist's shape: the native ear is smaller and would flatten the lobe.
    weights = R['head/groupWeights']
    group_names = [str(n) for n in R['head/groupNames']]
    ear = np.zeros(count)
    for v, g, w in weights[np.isin(weights[:, 1], [i for i, name in enumerate(group_names) if name.startswith('DEF-Ear_')])]:
        ear[int(v)] += w
    settle = np.where(inside, settle * (1 - smooth(ear, .05, .5)), settle)
    # The artist's lips are already full, so they take only part of the adult's lip changes.
    lips = np.zeros(count)
    for v, g, w in weights[np.isin(weights[:, 1], [i for i, name in enumerate(group_names) if name.startswith('DEF-Lip_')])]:
        lips[int(v)] += w
    lips = smooth(lips, .05, .6)
    control = placed + (meets - placed) * settle[:, None]
    print(f'skin: {kept.sum()} of {len(tri)} triangles, {int((settle[np.unique(tri[kept])] > 0).sum())} points settle onto the native skin')

    # Vertices of the drawn skin: one per source vertex and texture coordinate.
    uv = R['head/uv'].astype(float)
    uv[..., 0] -= np.floor(uv[..., 0].min())
    lookup, render_source, render_uv, index = {}, [], [], []
    for t in np.flatnonzero(kept):
        for k in range(3):
            key = (int(tri[t, k]), round(float(uv[t, k, 0]), 5), round(float(uv[t, k, 1]), 5))
            if key not in lookup:
                lookup[key] = len(render_source)
                render_source.append(key[0])
                render_uv.append(key[1:])
            index.append(lookup[key])
    index = np.array(index).reshape(-1, 3)
    smooth_tri = tri[kept]
    loops = boundary_loops(smooth_tri)
    neck = min(loops, key=lambda loop: reach[loop].mean())
    print('open edges:', [(len(loop), round(float(reach[loop].mean() * 1000), 1)) for loop in loops], '-> neck loop of', len(neck))

    lids = {}
    for side in 'LR':
        ids = [i for i, name in enumerate(group_names) if name.startswith('DEF-Eyelid_') and name.endswith('.' + side)]
        rows = weights[np.isin(weights[:, 1], ids) & (weights[:, 2] > .3)]
        lids[side] = np.unique(rows[:, 0].astype(int))

    data = {
        **CREDIT,
        'name': 'Rain',
        'height': N['height'],
        'scale': args.scale,
        'count': count,
        'control': packed(control, '<f4'),
        'meets': packed(meets, '<f4'),
        'settle': packed(np.round(settle * 255), 'u1'),
        'lips': packed(np.round(lips * 255), 'u1'),
        'triangles': packed(tri, '<u2'),
        'skin': {
            'source': packed(render_source, '<u2'), 'uv': packed(render_uv, '<f4'), 'index': packed(index, '<u2'),
            'smooth': packed(smooth_tri, '<u2'), 'neck': packed(neck, '<u2'),
        },
        'expressions': {name: packed(R['head/' + name] * args.scale * (1 - settle[:, None]), '<f4') for name in EXPRESSIONS},
        'lids': {side: packed(ids, '<u2') for side, ids in lids.items()},
        'eyeCentres': {side: put(R['eye' + side][0]).tolist() for side in 'LR'},
        'eyeAxis': (R['eyeL'][1] - R['eyeL'][0]).astype(float).tolist(),
        'pieces': {},
    }

    # The pieces that belong to the head, each vertex tied to the control points of the skin under it.
    def piece(key, points, moving=False, colour=False, facing=None):
        points = points.astype(float)
        t3 = R[key + '/tri']
        uvs = R[key + '/uv'].astype(float)
        keep = np.ones(len(t3), bool)
        if facing is not None:
            keep = facing(points[t3].mean(1))
        lookup, src, coords, idx = {}, [], [], []
        for t in np.flatnonzero(keep):
            for k in range(3):
                found = (int(t3[t, k]), round(float(uvs[t, k, 0]), 5), round(float(uvs[t, k, 1]), 5))
                if found not in lookup:
                    lookup[found] = len(src)
                    src.append(found[0])
                    coords.append(found[1:])
                idx.append(lookup[found])
        src = np.array(src)
        ties, shares, _, _ = closest(source, tri, points[src])
        entry = {
            'points': packed(put(points[src]), '<f4'), 'uv': packed(coords, '<f4'), 'index': packed(idx, '<u2'),
            'ties': packed(tri[ties], '<u2'), 'shares': packed(shares, '<f4'), 'vertices': len(src), 'triangles': len(idx) // 3,
        }
        if moving:
            entry['expressions'] = {name: packed(R[key + '/' + name][src] * args.scale, '<f4') for name in EXPRESSIONS}
        if colour:
            entry['colour'] = packed(R[key + '/colour'][src], '<f4')
        return entry, src

    centres = {1: R['eyeL'][0].astype(float), -1: R['eyeR'][0].astype(float)}
    side = R['eyes/side']
    eye_points = R['eyes/points'].astype(float)
    # The back of each ball never shows, even at the end of a turn.
    front = lambda mid: np.array([(m - centres[1 if m[0] > 0 else -1])[2] for m in mid]) > -.012
    # Each pupil is a hole in the iris with a loose card behind it, which the source shader darkens. A game
    # model cannot rely on the card, so the hole is closed with the middle of the painted pupil and the card
    # is left out.
    eye_uv, eye_tri = R['eyes/uv'], R['eyes/tri']
    part = components(len(eye_points), eye_tri)
    cards = np.isin(part, [label for label in np.unique(part) if (part == label).sum() <= 8])
    solid = ~cards[eye_tri[:, 0]]
    eye_tri, eye_uv = eye_tri[solid], eye_uv[solid]
    pupil_uv = np.array([.453, .46], np.float32)
    for hole in boundary_loops(eye_tri):
        middle = len(eye_points)
        eye_points = np.vstack([eye_points, eye_points[hole].mean(0) - [0, 0, .0006]])
        side = np.append(side, side[hole[0]])
        fan = np.array([[middle, hole[(k + 1) % len(hole)], hole[k]] for k in range(len(hole))])
        eye_tri = np.vstack([eye_tri, fan])
        eye_uv = np.vstack([eye_uv, np.tile(pupil_uv, (len(fan), 3, 1))])
    R = {**{key: R[key] for key in R.files}, 'eyes/uv': eye_uv, 'eyes/tri': eye_tri}
    eyes, eye_source = piece('eyes', eye_points, facing=front)
    eyes['side'] = packed(side[eye_source], 'i1')
    data['pieces']['eyes'] = eyes
    data['pieces']['brows'] = piece('brows', R['brows/points'], moving=True, colour=True)[0]
    data['pieces']['lashes'] = piece('lashes', R['lashes/points'], moving=True, colour=True)[0]
    for key in ('hair_main', 'hair_ponytail', 'hair_strand'):
        points = R[key + '/points'].astype(float)
        data['pieces'][key] = piece(key, bent_tail(points) if key == 'hair_ponytail' else points)[0]
    data['pieces']['hairband'] = piece('hairband', R['hairband/points'], colour=True)[0]

    textures = Path(args.textures)
    head_map, _ = colour_map(textures / 'TEX-rain_body_diffuse.1003.png', 768)
    # The colour the skin map has where the head meets the native neck. Re-tinting from it makes the join exact
    # and leaves the face as much lighter, redder or duller than the neck as the artist painted it.
    seam = np.array([[u, v] for u, v, c in zip(*np.array(render_uv).T, render_source) if settle[c] > .5])
    at_seam = head_map[np.clip(((1 - seam[:, 1]) * 768).astype(int), 0, 767), np.clip((seam[:, 0] * 768).astype(int), 0, 767)]
    skin_tone = np.median(linear(at_seam / 255), 0)
    hair_map, hair_tone = colour_map(textures / 'TEX-rain_hair_diffuse.png', 512)
    # The iris fills a quarter of the eye map. Keep the half of the map around it.
    eye_box = (.2, .28, .7, .78)
    eye_map, _ = colour_map(textures / 'TEX-rain_eyes.png', 256, eye_box)
    spread = eye_map.max(2).astype(float) - eye_map.min(2)
    painted_iris = np.median(eye_map[spread > .3 * np.maximum(eye_map.max(2), 1)], 0)
    data['paint'] = {
        'skin': {'side': 768, 'pixels': packed(head_map, 'u1'), 'tone': skin_tone.tolist()},
        'hair': {'side': 512, 'pixels': packed(hair_map, 'u1'), 'tone': hair_tone.tolist()},
        'eyes': {'side': 256, 'pixels': packed(eye_map, 'u1'), 'box': eye_box, 'iris': painted_iris.tolist()},
    }
    Path(args.out).write_text(json.dumps(data))
    total = sum(p['triangles'] for p in data['pieces'].values()) + len(index)
    print(f'wrote {args.out}: {Path(args.out).stat().st_size / 1e6:.2f} MB, {len(render_source)} skin vertices, {len(index)} skin triangles, {total} triangles with every piece')
    print('skin tone', np.round(skin_tone, 3), 'hair tone', np.round(hair_tone, 3))
    for name, p in data['pieces'].items():
        print(' ', name, p['vertices'], p['triangles'])


if __name__ == '__main__':
    main()
