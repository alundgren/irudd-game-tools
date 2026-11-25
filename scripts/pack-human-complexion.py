"""Pack face-only complexion data from the CC0 system skins and the MPFB base mesh.

Everything is stored for the face rectangle of the skin layout. Outside the face mask the
detail maps are white and the fields are empty, so the body keeps a smooth plain surface.

- maps: local skin detail from four system skins, with the pigment removed.
- fields: three images of smooth zones measured on the base head (lips, lids, relief,
  blush, gloss, beard growth, under-eye, eye socket).
- brows, lids: the packed brow strands and lash roots, projected into the skin layout so
  the editor can paint them in any hair colour.

Run pack-human-face.py first. This reads its output from beside the destination.

Usage: python scripts/pack-human-complexion.py SYSTEM MPFB character-view/human-complexion-data.json
"""
import base64
import io
import json
import pathlib
import sys
import zipfile
import zlib

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage
from scipy.spatial import cKDTree

SIZE = 2048


def webp(array, quality=88):
    buf = io.BytesIO()
    Image.fromarray(array).save(buf, format="WEBP", quality=quality, method=4)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def open_skin(library, name):
    """Open a CC0 MakeHuman skin PNG from either a directory or a .download zip archive."""
    if library.is_file():
        with zipfile.ZipFile(library) as zf:
            prefix = f"skins/{name}/"
            entry = next(n for n in sorted(zf.namelist()) if n.startswith(prefix) and n.endswith(".png"))
            return Image.open(io.BytesIO(zf.read(entry))).convert("RGB")
    return Image.open(next((library / "skins" / name).glob("*.png"))).convert("RGB")


def detail_maps(library, detail_mask, box):
    """Pack 4 signed, 128-centered CC0 skin detail maps (R=pores, G=wrinkles/mid, B=organic chroma).

    Every channel is band-separated, zero-mean inside the clean face mask, soft-clamped so
    isolated blemishes or hairs never blow out, and faded smoothly to exact 128 at the border.
    """
    names = [
        "young_caucasian_female",
        "middleage_caucasian_female",
        "old_caucasian_male",
        "old_asian_female",
    ]
    out = []
    valid = detail_mask > 0.5
    for name in names:
        im = open_skin(library, name).crop(box)
        rgb = np.asarray(im, dtype=float) / 255.0
        lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
        # R: fine pore & micro-grain relief (high-pass, sigma 4.5 px in 2048 space).
        lum_fine = ndimage.gaussian_filter(lum, 4.5)
        fine = np.log((lum + 0.08) / (lum_fine + 0.08))
        fine -= np.median(fine[valid])
        pore_ch = np.tanh(fine / 0.11)

        # G: anatomical wrinkles & mid-fine skin structure (band-pass 2.2..12.5 px).
        lum_s = ndimage.gaussian_filter(lum, 2.2)
        lum_m = ndimage.gaussian_filter(lum, 12.5)
        wrinkle = np.log((lum_s + 0.08) / (lum_m + 0.08))
        wrinkle -= np.median(wrinkle[valid])
        wrinkle_ch = np.tanh(wrinkle / 0.14)

        # B: modest organic red-green warmth variation (band-pass 4..34 px, zero-mean).
        rg = np.log((rgb[..., 0] + 0.08) / (rgb[..., 1] + 0.08))
        mottle = ndimage.gaussian_filter(rg, 4.0) - ndimage.gaussian_filter(rg, 34.0)
        mottle -= np.median(mottle[valid])
        mottle_ch = np.tanh(mottle / 0.045)

        packed = np.empty((*lum.shape, 3), dtype="uint8")
        packed[..., 0] = np.rint(np.clip(128.0 + 96.0 * detail_mask * pore_ch, 0, 255)).astype("uint8")
        packed[..., 1] = np.rint(np.clip(128.0 + 96.0 * detail_mask * wrinkle_ch, 0, 255)).astype("uint8")
        packed[..., 2] = np.rint(np.clip(128.0 + 88.0 * detail_mask * mottle_ch, 0, 255)).astype("uint8")
        out.append(webp(packed, 90))
    return out


def read_base(mpfb):
    vertices, uv, faces, face_uv, groups, group = [], [], [], [], {}, None
    for line in (mpfb / "3dobjs" / "base.obj").read_text().splitlines():
        f = line.split()
        if not f:
            continue
        if f[0] == "v":
            vertices.append([float(x) * .1 for x in f[1:4]])
        elif f[0] == "vt":
            uv.append([float(x) for x in f[1:3]])
        elif f[0] == "g":
            group = f[1]
        elif f[0] == "f":
            ids = [int(s.split("/")[0]) - 1 for s in f[1:]]
            tex = [int(s.split("/")[1]) - 1 for s in f[1:]]
            groups.setdefault(group, set()).update(ids)
            if group == "body":
                for k in range(1, len(ids) - 1):
                    faces.append([ids[0], ids[k], ids[k + 1]])
                    face_uv.append([tex[0], tex[k], tex[k + 1]])
    return np.array(vertices), np.array(uv), np.array(faces), np.array(face_uv), groups


def closest_on_triangles(p, a, b, c):
    """Closest point to p on each triangle, as barycentric weights and distance."""
    ab, ac, ap = b - a, c - a, p - a
    d1, d2 = (ab * ap).sum(1), (ac * ap).sum(1)
    d00, d01, d11 = (ab * ab).sum(1), (ab * ac).sum(1), (ac * ac).sum(1)
    denom = d00 * d11 - d01 * d01 + 1e-20
    v = np.clip((d11 * d1 - d01 * d2) / denom, 0, 1)
    w = np.clip((d00 * d2 - d01 * d1) / denom, 0, 1)
    over = np.maximum(v + w, 1)
    v, w = v / over, w / over
    weights = np.column_stack([1 - v - w, v, w])
    points = a * weights[:, :1] + b * weights[:, 1:2] + c * weights[:, 2:]
    return weights, np.linalg.norm(points - p, axis=1)


def pack(library, mpfb, destination):
    mask = Image.open(mpfb / "textures" / "mpfb_face.jpg").convert("L")
    pixels = np.asarray(mask)
    rows, cols = np.nonzero(pixels > 40)
    box = (int(cols.min() - 8), int(rows.min() - 8), int(cols.max() + 9), int(rows.max() + 9))
    width, height = box[2] - box[0], box[3] - box[1]
    crop = lambda name: np.asarray(Image.open(mpfb / "textures" / name).convert("L").crop(box), float) / 255
    face_mask = crop("mpfb_face.jpg")

    V, UV, F, FT, groups = read_base(mpfb)
    pixel = np.column_stack([UV[:, 0] * SIZE - box[0], (1 - UV[:, 1]) * SIZE - box[1]])
    inside = np.all((pixel[FT] > -4).all(2) & (pixel[FT] < [width + 4, height + 4]).all(2), axis=1)
    faces, face_uv = F[inside], FT[inside]
    used = np.unique(faces)

    normal = np.zeros_like(V)
    cross = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    for k in range(3):
        np.add.at(normal, F[:, k], cross)
    normal /= np.linalg.norm(normal, axis=1, keepdims=True) + 1e-12

    # Landmarks measured on the base head. All zone sizes follow the eye spacing.
    eyes = [V[sorted(groups["helper-" + s + "-eye"])].mean(0) for s in "lr"]
    eye_y, eye_x = eyes[0][1], abs(eyes[0][0])
    unit = 2 * eye_x / .0615
    p = V[used]
    front = p[np.abs(p[:, 0]) < .004 * unit]
    nose = front[np.argmax(front[:, 2] - 3 * np.abs(front[:, 1] - (eye_y - .04 * unit)))]
    lips = crop("mpfb_lips.jpg")
    sample = lambda field, ids: field[np.clip(pixel[ids, 1].astype(int), 0, height - 1), np.clip(pixel[ids, 0].astype(int), 0, width - 1)]
    lip_vertices = np.unique(faces[sample(lips, face_uv).min(1) > .5])
    mouth = V[lip_vertices].mean(0)
    below = front[(front[:, 1] < mouth[1] - .026 * unit) & (front[:, 2] > mouth[2] - .03 * unit)]
    chin = below[np.argmax(below[:, 2])]
    print("landmarks eye", eyes[0].round(4), "nose", nose.round(4), "mouth", mouth.round(4), "chin", chin.round(4))

    x, y, z = np.abs(p[:, 0]), p[:, 1], p[:, 2]
    blob = lambda cx, cy, sx, sy: np.exp(-(((x - cx) / (sx * unit)) ** 2 + ((y - cy) / (sy * unit)) ** 2))
    step = lambda v, a, b: np.clip((v - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((v - a) / (b - a), 0, 1))
    blush = np.clip(
        .85 * blob(.039 * unit, eye_y - .036 * unit, .028, .021)
        + .45 * blob(0, nose[1] + .003 * unit, .016, .015)
        + .18 * blob(0, chin[1], .018, .014),
        0, 1,
    )
    under = blob(eye_x * 1.02, eye_y - .0145 * unit, .016, .0065) * step(eye_y - .004 * unit - y, 0, .004 * unit)
    socket = blob(eye_x, eye_y + .001 * unit, .023, .014)
    ridge = np.exp(-((x / (.0075 * unit)) ** 2)) * step(y, nose[1] - .005 * unit, nose[1] + .008 * unit) * step(eye_y + .008 * unit - y, 0, .012 * unit)
    # Broad anatomical sebum/sheen zones: forehead & brow ridge, nose bridge/tip/wings,
    # malar cheekbones, philtrum/cupid's bow, chin, and a gentle mid-face base transition.
    gloss = np.clip(
        .78 * blob(0, eye_y + .044 * unit, .044, .024)
        + .48 * blob(.028 * unit, eye_y + .022 * unit, .022, .011)
        + .95 * ridge
        + .90 * blob(0, nose[1], .012, .011)
        + .50 * blob(.015 * unit, nose[1] - .004 * unit, .009, .008)
        + .75 * blob(.044 * unit, eye_y - .022 * unit, .024, .015)
        + .55 * blob(0, mouth[1] + .013 * unit, .012, .008)
        + .65 * blob(0, chin[1] + .004 * unit, .018, .013)
        + .22 * blob(0, eye_y - .025 * unit, .068, .068),
        0, 1,
    )
    # Clean skin mask for CC0 detail extraction: keeps pores/wrinkles/chroma inside bare
    # facial skin and cuts out the source textures' painted hairline, temples, eye cavities, and nostrils.
    scalp_cut = 1 - step(y, eye_y + .055 * unit, eye_y + .073 * unit)
    temple_cut = 1 - step(y, eye_y + .014 * unit, eye_y + .042 * unit) * step(x, .047 * unit, .064 * unit)
    ear_cut = step(z, nose[2] - .088 * unit, nose[2] - .062 * unit)
    eye_cut = 1 - .92 * blob(eye_x, eye_y, .018, .0095)
    nostril_cut = 1 - .88 * blob(.0095 * unit, nose[1] - .007 * unit, .0085, .0065)
    detail_keep = scalp_cut * temple_cut * ear_cut * eye_cut * nostril_cut
    # Beard growth: under the nose, around the mouth and along the jaw toward the ear.
    line = nose[1] - .012 * unit + .5 * np.maximum(0, x - .024 * unit)
    beard = step(line - y, 0, .012 * unit) * (1 - .55 * blob(.03 * unit, mouth[1] + .012 * unit, .012, .012))

    # Facial hair zones. Lips are cut out of all of them further down.
    lip_points = V[lip_vertices]
    lip_low, corner = lip_points[:, 1].min(), np.abs(lip_points[:, 0]).max()
    reach = np.clip(x / corner, 0, 1.6)
    # Above the mouth, from under the nose and out past the corners, where it turns down.
    moustache = (step(nose[1] - .005 * unit - .75 * np.maximum(0, x - .008 * unit) - y, 0, .004 * unit)
                 * step(y, mouth[1] - .003 * unit - .003 * unit * reach ** 2, mouth[1] + .001 * unit)
                 # Not the underside of the nose.
                 * step(normal[used][:, 1], -.6, -.25)
                 * (1 - step(x, corner + .003 * unit, corner + .012 * unit)))
    chin_zone = step(lip_low - .001 * unit - y, 0, .004 * unit) * (1 - step(x, .02 * unit, .031 * unit))
    # The cheek line stays low along the jaw and climbs to the sideburn in front of the ear.
    climb = np.clip((x - .028 * unit) / (.044 * unit), 0, 1) ** 2.2
    cheek_line = mouth[1] - .002 * unit + (eye_y - .02 * unit - mouth[1]) * climb - .012 * unit * np.clip(1 - x / (.028 * unit), 0, 1)
    side_zone = step(cheek_line - y, 0, .006 * unit) * step(x, .014 * unit, .026 * unit)

    # Relief: how far each point stands out of, or sinks into, the smoothed head.
    tree = cKDTree(V[sorted(groups["body"])])
    body = V[sorted(groups["body"])]
    relief = np.zeros(len(p))
    for sigma, gain in ((.004, .3), (.009, .4), (.02, .3)):
        near = tree.query_ball_point(p, 2.6 * sigma * unit)
        for i, ids in enumerate(near):
            q = body[ids]
            w = np.exp(-((q - p[i]) ** 2).sum(1) / (2 * (sigma * unit) ** 2))
            relief[i] += gain * (normal[used[i]] @ (p[i] - (q * w[:, None]).sum(0) / w.sum())) / (sigma * unit)

    # Draw each field into the skin layout.
    order = {v: i for i, v in enumerate(used)}
    corner = np.vectorize(order.get)(faces)
    names = ["blush", "under", "socket", "gloss", "beard", "relief", "moustache", "chin", "side", "detail_keep"]
    values = np.column_stack([blush, under, socket, gloss, beard, relief, moustache, chin_zone, side_zone, detail_keep])
    canvas = np.zeros((height, width, len(names)))
    weight = np.zeros((height, width))
    for tri, tex in zip(corner, face_uv):
        a, b, c = pixel[tex]
        lo = np.floor(np.minimum(np.minimum(a, b), c)).astype(int)
        hi = np.ceil(np.maximum(np.maximum(a, b), c)).astype(int)
        lo, hi = np.maximum(lo, 0), np.minimum(hi, [width - 1, height - 1])
        if (hi < lo).any():
            continue
        gx, gy = np.meshgrid(np.arange(lo[0], hi[0] + 1) + .5, np.arange(lo[1], hi[1] + 1) + .5)
        det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])
        if abs(det) < 1e-9:
            continue
        w1 = ((gx - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (gy - a[1])) / det
        w2 = ((b[0] - a[0]) * (gy - a[1]) - (gx - a[0]) * (b[1] - a[1])) / det
        w0 = 1 - w1 - w2
        hit = (w0 >= -.02) & (w1 >= -.02) & (w2 >= -.02)
        ys, xs = (gy[hit] - .5).astype(int), (gx[hit] - .5).astype(int)
        canvas[ys, xs] = w0[hit][:, None] * values[tri[0]] + w1[hit][:, None] * values[tri[1]] + w2[hit][:, None] * values[tri[2]]
        weight[ys, xs] = 1
    # Fill the eye and mouth openings and seams from their surroundings, then soften.
    missing = weight == 0
    nearest = ndimage.distance_transform_edt(missing, return_distances=False, return_indices=True)
    canvas = canvas[nearest[0], nearest[1]]
    zone_names = ["moustache", "chin", "side"]
    field = {name: ndimage.gaussian_filter(canvas[..., k], 5 if name == "beard" else 1.6) * (1 if name in zone_names else face_mask)
             for k, name in enumerate(names)}
    # A head is convex overall. Measure relief against the typical face surface.
    field["relief"] = (field["relief"] - np.median(field["relief"][face_mask > .5])) * face_mask
    byte = lambda v: np.rint(np.clip(v, 0, 1) * 255).astype("uint8")
    lids = crop("mpfb_eyelids.jpg") * face_mask
    lips = lips * face_mask
    # Facial hair zones as small grids. Geometry and paint both sample them by position in
    # the face rectangle, so they serve any mesh density and need no image decoding.
    clear = 1 - np.clip(ndimage.gaussian_filter(lips, 1.2) * 1.6, 0, 1)
    grid = (width // 3, height // 3)
    growth = {"size": list(grid), **{
        name: base64.b64encode(zlib.compress(np.asarray(
            Image.fromarray(byte(field[name] * clear)).resize(grid, Image.Resampling.BOX)).tobytes(), 9)).decode()
        for name in zone_names}}
    # The mouth lining has its own island outside the face rectangle. Record where, so the
    # editor can point it at a dark patch of the face paint.
    centre = V[F].mean(1)
    lining = ((np.abs(centre[:, 0]) < .035 * unit) & (np.abs(centre[:, 1] - mouth[1]) < .03 * unit)
              & (centre[:, 2] > mouth[2] - .06 * unit) & ~inside)
    layout = np.column_stack([UV[:, 0] * SIZE, (1 - UV[:, 1]) * SIZE])
    # A few faces at the lip seam belong to other islands. Keep the main cluster.
    middle = np.median(layout[FT[lining]].mean(1), axis=0)
    lining &= (np.abs(layout[FT].mean(1) - middle) < 260).all(1)
    island = layout[FT[lining]].reshape(-1, 2)
    mouth_box = [int(island[:, 0].min()) - 2, int(island[:, 1].min()) - 2, int(island[:, 0].max()) + 3, int(island[:, 1].max()) + 3]
    spot = layout[FT]
    within = ((spot[..., 0] > mouth_box[0]) & (spot[..., 0] < mouth_box[2]) & (spot[..., 1] > mouth_box[1]) & (spot[..., 1] < mouth_box[3])).any(1)
    others = centre[within & ~lining]
    # The paint for it goes in the emptiest part of the rectangle, away from every face.
    empty = ndimage.distance_transform_edt((weight == 0) & (face_mask < .004))
    at = np.unravel_index(np.argmax(empty), empty.shape)
    # Centre and half size of the square, in pixels of the rectangle. Coordinates beyond the
    # rectangle read its border, so the square keeps a margin from it.
    half, margin = float(empty[at]) / 4.3, 10
    patch = [float(np.clip(at[1] + .5, half + margin, width - half - margin)),
             float(np.clip(at[0] + .5, half + margin, height - half - margin)), half]
    print("mouth lining", int(lining.sum()), "faces in", mouth_box, "and", len(others), "more of the cavity there, height",
          others[:, 1].min().round(3), others[:, 1].max().round(3), "depth", others[:, 2].min().round(3), others[:, 2].max().round(3),
          "| patch", np.round(patch, 4), "free radius", float(empty[at]), "pixels")

    centred = lambda v, gain: byte(.5 + gain * v)
    images = [
        np.dstack([byte(lips), byte(lids), centred(field["relief"], .9)]),
        np.dstack([byte(field["blush"]), byte(field["gloss"]), byte(field["beard"])]),
        np.dstack([byte(field["under"]), byte(field["socket"]), byte(face_mask)]),
    ]

    # Project the packed brow strands and lash roots onto the skin layout.
    face_data = json.loads((destination.parent / "human-face-data.json").read_text())
    decode = lambda text, kind: np.frombuffer(zlib.decompress(base64.b64decode(text)), kind)
    surface = cKDTree(V[used])
    incident = {}
    for i, tri in enumerate(faces):
        for v in tri:
            incident.setdefault(v, []).append(i)

    def to_layout(points):
        out = []
        for q in points:
            _, near = surface.query(q, 6)
            ids = np.unique([f for v in used[near] for f in incident[v]])
            weights, distance = closest_on_triangles(q, V[faces[ids, 0]], V[faces[ids, 1]], V[faces[ids, 2]])
            best = np.argmin(distance)
            out.append(weights[best] @ pixel[face_uv[ids[best]]] / [width, height])
        return np.array(out)

    def strand_points(part):
        refs, w, offsets = decode(part["refs"], "<u2").reshape(-1, 3), decode(part["weights"], "<f4").reshape(-1, 3), decode(part["offsets"], "<f4").reshape(-1, 3)
        card = (V[refs] * w[..., None]).sum(1) + offsets
        parents, blend = decode(part["triRefs"], "<u2").reshape(-1, 3), decode(part["triWeights"], "<f4").reshape(-1, 3)
        points = (card[parents] * blend[..., None]).sum(1)
        root = decode(part["root"], "<u2")
        return points, root

    quantise = lambda a: base64.b64encode(zlib.compress(np.rint(np.clip(a, 0, 1) * 65535).astype("<u2").tobytes(), 9)).decode()
    brows = {}
    brow_occ = np.zeros((height, width), dtype=float)
    for name in ["eyebrow001", "eyebrow003"]:
        points, root = strand_points(face_data[name])
        starts = np.nonzero(root == np.arange(len(root)))[0]
        per = 2 * face_data[name]["points"] - 1
        lines = []
        for s in starts:
            if s + per > len(points) or root[s + per - 1] != s:
                continue
            lines.append([(points[s] + points[s + 1]) / 2, (points[s + 2] + points[s + 3]) / 2, points[s + 4]])
        laid = to_layout(np.array(lines).reshape(-1, 3))
        brows[name] = quantise(laid)
        px = np.clip((laid[:, 0] * width).astype(int), 0, width - 1)
        py = np.clip((laid[:, 1] * height).astype(int), 0, height - 1)
        brow_occ[py, px] = 1.0
        print(name, len(lines), "strokes")
    brow_cut = 1.0 - np.clip(ndimage.gaussian_filter(brow_occ, 4.5) * 4.5, 0, 0.92)
    lid_cut = 1.0 - np.clip(ndimage.gaussian_filter(lids, 2.0) * 1.4, 0, 0.9)
    edge_fade = step(face_mask, 0.14, 0.72)
    detail_mask = np.clip(ndimage.gaussian_filter(field["detail_keep"], 3.0) * clear * lid_cut * brow_cut * edge_fade, 0, 1)
    points, root = strand_points(face_data["eyelashes01"])
    lower = decode(face_data["eyelashes01"]["lower"], "u1")
    starts = np.nonzero(root == np.arange(len(root)))[0]
    lid_lines = []
    for low in (0, 1):
        for side in (1, -1):
            row = np.array([(points[s] + points[s + 1]) / 2 for s in starts if lower[s] == low and points[s, 0] * side > 0])
            row = row[np.argsort(row[:, 0])]
            flat = to_layout(row)
            # Roots past the eye corner sit off the lid and land far away on the skin.
            # Keep the longest evenly spaced run.
            step_d = np.linalg.norm(np.diff(flat, axis=0), axis=1)
            breaks = np.concatenate([[-1], np.nonzero(step_d > 4 * np.median(step_d))[0], [len(step_d)]])
            longest = np.argmax(np.diff(breaks))
            flat = flat[breaks[longest] + 1:breaks[longest + 1] + 1]
            print("lid margin", "lower" if low else "upper", len(flat), "of", len(row), "roots")
            # Smooth the scatter of single roots into a clean margin.
            flat = np.column_stack([ndimage.uniform_filter1d(flat[:, k], 5, mode="nearest") for k in range(2)])
            lid_lines.append(dict(lower=bool(low), points=quantise(flat[::2])))
    destination.write_text(json.dumps({
        # human-complexion.js refuses a file packed any other way than it reads.
        "encoding": {"name": "signed-detail", "neutral": 128},
        "rect": box, "maps": detail_maps(library, detail_mask, box), "fields": [webp(im) for im in images],
        "brows": brows, "lids": lid_lines, "growth": growth, "mouth": {"island": mouth_box, "patch": patch},
    }, separators=(",", ":")) + "\n")
    print(destination.stat().st_size, "bytes")
    return images, field, clear


if __name__ == "__main__":
    pack(*map(pathlib.Path, sys.argv[1:4]))
