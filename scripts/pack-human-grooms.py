"""Compile artist-authored CC0 MakeHuman Community hair and facial hair as fitted cards with embedded WebP maps.

python scripts/pack-human-grooms.py SOURCE_FOLDER character-view/human-grooms-data.json [NAME...]

SOURCE_FOLDER holds the unpacked assets (any depth), one folder per asset with its .mhclo, .obj and maps, as
fetched from the official `hair01_cc0` and `bodyparts05_cc0` packs and the community asset index. Each groom
keeps its authored cards, combing and painted strands. The record has the shape `human-library.js` already
fits and trims (see pack-human-library.py), plus the credit of its author. pack-human-grooms-finish.mjs is run
on the result before it replaces the library.
"""

import base64
import io
import json
import pathlib
import re
import subprocess
import sys
import zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
from human_cutout import cutout

Image.MAX_IMAGE_PIXELS = None

# System assets record their CC0 release. Community assets must carry CC0 both in
# the asset index and in the mesh-clothing file distributed with the original art.
GROOMS = {
    "short_layered": dict(folder="short01", author="MakeHuman team", system=True,
        source="https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html", pack="makehuman_system_assets_cc0"),
    "short_receding": dict(folder="short01", author="MakeHuman team", system=True, recede=True,
        source="https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html", pack="makehuman_system_assets_cc0"),
    "cloud_waves": dict(folder="cortu_strawberry_cloud_hair", author="Cortu Johnstone",
                        source="http://www.makehumancommunity.org/node/2808", pack="hair01_cc0"),
    "bob_blunt": dict(folder="toigo_blunt_bob", author="MargaretToigo",
                      source="http://www.makehumancommunity.org/node/1669", pack="hair01_cc0"),
    "bob_blunt_fringe": dict(folder="toigo_blunt_bob_with_bangs", author="MargaretToigo",
                             source="http://www.makehumancommunity.org/node/1681", pack="hair01_cc0"),
    "bob_curled": dict(folder="toigo_curled_under_bob", author="MargaretToigo",
                       source="http://www.makehumancommunity.org/node/1677", pack="hair01_cc0"),
    "bob_inverted": dict(folder="toigo_inverted_bob", author="MargaretToigo",
                         source="http://www.makehumancommunity.org/node/1673", pack="hair01_cc0"),
    "bun_tied": dict(folder="ponytail01", author="MakeHuman team", system=True, coil=True,
        source="https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html", pack="makehuman_system_assets_cc0"),
    "long_centre": dict(folder="long01", author="MakeHuman team", system=True,
                        source="https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html",
                        pack="makehuman_system_assets_cc0"),
    "pixie_swept": dict(folder="short03", author="MakeHuman team", system=True,
                        source="https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html",
                        pack="makehuman_system_assets_cc0"),
    "ponytail_low": dict(folder="ponytail01", author="MakeHuman team", system=True,
                         source="https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html",
                         pack="makehuman_system_assets_cc0"),
    "moustache_viking": dict(folder="rehmanpolanski_moustache_viking", author="RehmanPolanski", facial=True,
                             source="http://www.makehumancommunity.org/node/2615", pack="bodyparts05_cc0"),
}


def encode(values, dtype):
    return base64.b64encode(zlib.compress(np.asarray(values, dtype=dtype).tobytes(), 9)).decode()


def read_fit(path, count):
    """Anchors, weights and offsets (metres) of each card vertex on the hm08 body, and the skin its author hid."""
    lines = path.read_text(encoding="utf8", errors="replace").splitlines()
    scale = {}
    for line in lines:
        m = re.match(r"([xyz])_scale\s+(\d+)\s+(\d+)\s+([\d.]+)", line)
        if m:
            scale[m.group(1)] = (int(m.group(2)), int(m.group(3)), float(m.group(4)))
    refs, weights, offsets, hide = [], [], [], []
    for line in lines[lines.index("verts 0") + 1:]:
        fields = line.split()
        if not fields or not fields[0].isdigit():
            continue
        if len(fields) == 1:
            fields = fields * 3 + [1, 0, 0, 0, 0, 0]
        if len(fields) != 9:
            raise ValueError(path.name + " has an unsupported binding")
        refs.extend(map(int, fields[:3]))
        weights.extend(map(float, fields[3:6]))
        offsets.extend(float(x) * 0.1 for x in fields[6:9])
        if len(refs) == 3 * count:
            break
    assert len(refs) == 3 * count, path.name
    if "delete_verts" in lines:
        for line in lines[lines.index("delete_verts") + 1:]:
            if not line.strip():
                continue
            if not line.strip()[0].isdigit():
                break
            for first, last in re.findall(r"(\d+)(?:\s*-\s*(\d+))?", line):
                hide.extend(range(int(first), int(last or first) + 1))
    licence = next((re.sub(r"^#?\s*license:?\s*", "", l, flags=re.I) for l in lines if re.match(r"#?\s*license", l, re.I)), "")
    if not licence:
        licence = next((line.lstrip("# ").strip() for line in lines[:12] if "CC0" in line), "")
    return refs, weights, offsets, hide, scale, licence


def read_mesh(path):
    count, tex, corners, texcorners, points = 0, [], [], [], []
    for line in path.read_text(errors="replace").splitlines():
        f = line.split()
        if f[:1] == ["v"]:
            count += 1
            points.append([float(x) for x in f[1:4]])
        elif f[:1] == ["vt"]:
            tex.append([float(f[1]), float(f[2])])
        elif f[:1] == ["f"]:
            poly = [x.split("/") for x in f[1:]]
            for j in range(1, len(poly) - 1):
                for v in (poly[0], poly[j], poly[j + 1]):
                    corners.append(int(v[0]) - 1)
                    texcorners.append(int(v[1]) - 1)
    return count, tex, corners, texcorners, np.array(points)


def strand_tone(im, size):
    """The painted strands as light and dark under a tint, with the author's opacity."""
    im = im.copy()
    im.thumbnail((size, size), Image.Resampling.LANCZOS)
    gray = np.asarray(im.convert("L"), dtype=float)
    alpha = np.asarray(im.getchannel("A"))
    # The middle strand takes the tint as chosen: a black wig and a blond one both pack to the same value,
    # so a grey or dyed tint reads as that colour and not as its shadow.
    middle = max(8.0, float(np.median(gray[alpha > 128])))
    tone = np.clip(gray / middle, 0.05, 4) ** 0.6
    # A game atlas holds this map at a third of its size. Locks and partings a few texels wide survive that;
    # single hairs do not, so the lock-scale light and dark is drawn a little stronger than painted.
    soft = np.asarray(Image.fromarray(np.clip(tone * 120, 0, 255).astype("uint8")).filter(ImageFilter.GaussianBlur(size / 110)), dtype=float) / 120
    tone = tone + 0.55 * (tone - soft)
    value = Image.fromarray(np.clip(tone * 188, 58, 255).astype("uint8"))
    return Image.merge("RGBA", (value, value, value, im.getchannel("A")))


def strand_relief(image):
    """Comb narrow fibres along the light and dark locks painted by the artist.

    A structure tensor estimates the unsigned tangent. Integrating the same
    noise forwards and backwards removes any dependence on its sign. The
    resulting grooves affect the material normal and break up the painted
    edge, including where a formerly continuous card meets bare skin.
    """
    values = np.asarray(image, dtype=np.float32) / 255
    tone, alpha = values[..., 0], values[..., 3]
    inside = alpha > .24
    nearest = ndimage.distance_transform_edt(~inside, return_distances=False, return_indices=True)
    tone = tone[tuple(nearest)]
    gy, gx = np.gradient(ndimage.gaussian_filter(tone, 1.6))
    smooth = lambda x: ndimage.gaussian_filter(x, 4.)
    angle = .5*np.arctan2(2*smooth(gx*gy), smooth(gx*gx - gy*gy)) + np.pi/2
    dx, dy = np.cos(angle), np.sin(angle)
    noise = ndimage.gaussian_filter(np.random.default_rng(3183).standard_normal(tone.shape).astype("f4"), .85)
    y0, x0 = np.indices(tone.shape, dtype="f4")
    field = noise.copy()
    for sign in [-1, 1]:
        x, y = x0.copy(), y0.copy()
        tx, ty = sign*dx, sign*dy
        for _ in range(12):
            x += 1.4*tx
            y += 1.4*ty
            coords = [y, x]
            def sample(a):
                return ndimage.map_coordinates(a, coords, order=1, mode="nearest", prefilter=False)
            field += sample(noise)
            nx, ny = sample(dx), sample(dy)
            orient = np.where(nx*tx + ny*ty >= 0, 1., -1.)
            tx, ty = nx*orient, ny*orient
    strands = np.tanh(field / max(.0001, 1.65*field[inside].std()))
    relief = .76*strands + 1.6*(tone - ndimage.gaussian_filter(tone, 4.))
    ry, rx = np.gradient(relief)
    normals = np.stack((-rx, ry, np.ones_like(rx)), axis=-1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
    distance = ndimage.distance_transform_edt(inside)
    # Thin the last few millimetres in the strand direction. Keep the
    # author's existing transparency wherever it cuts deeper into the lock.
    margin = np.clip((distance + 2. + 6.*strands) / 5., 0, 1)
    gray = np.clip(tone + .145*strands, .07, 1.)
    rgba = np.stack([gray, gray, gray, np.minimum(alpha, margin)], axis=-1)
    return (Image.fromarray(np.rint(255*rgba).astype("uint8")),
            Image.fromarray(np.rint(127.5+127.5*normals).astype("uint8")))


def beard_texture(strands, normal):
    """Feather the contact edge and append three narrow fans of fine terminal hairs."""
    rgb = np.asarray(strands).copy()
    alpha = rgb[:,:,3]/255.
    distance = ndimage.distance_transform_edt(alpha > .28)
    light = rgb[:,:,0]/255.
    fibres = light - ndimage.gaussian_filter(light,3)
    # Adjacent whiskers reach different distances into the cheek. This
    # breaks up the hard perimeter of a single mapped beard shell.
    edge = np.clip((distance - 4 + 26*fibres)/14,0,1)
    rgb[:,:,3] = np.rint(255*np.minimum(alpha,edge))
    w,h = strands.size
    strip = 144
    atlas = Image.new("RGBA",(w+strip,h))
    atlas.paste(Image.fromarray(rgb),(0,0))
    relief = Image.new("RGB",atlas.size,(128,128,255))
    relief.paste(normal,(0,0))
    rng=np.random.default_rng(82914)
    rects=[]
    for j in range(3):
        tile=Image.new("RGBA",(128,192))
        draw=ImageDraw.Draw(tile)
        for _ in range(48):
            foot=rng.normal(64,21)
            fan=rng.normal(0,13)
            top=rng.uniform(8,56)
            bottom=rng.uniform(112,182)
            bend=rng.uniform(-11,11)
            width=rng.uniform(.8,2.2)
            tone=int(rng.uniform(136,253))
            left=[]; right=[]
            for t in np.linspace(0,1,12):
                x=foot+t*fan+bend*np.sin(t*np.pi)
                y=top+(bottom-top)*t
                radius=width*(1-t**1.5)
                left.append((x-radius,y)); right.append((x+radius,y))
            draw.polygon(left+right[::-1],fill=(tone,tone,tone,255))
        y=10+j*202
        atlas.paste(tile,(w+8,y))
        rects.append([(w+8)/(w+strip),1-y/h,128/(w+strip),192/h])
    coverage=Image.fromarray(rgb[:,:,3]).resize((32,32),Image.Resampling.BOX)
    return atlas,relief,{"mainWidth":w/(w+strip),"fans":rects,"coverage":np.asarray(coverage).ravel().tolist()}


def recede(im, points, tex, corners, texcorners):
    """Take the hairline back: clear the painted hair where it lies over the temples and the front of the crown.

    The horseshoe wraps around the occiput and the temples and ends in a few
    millimetres of thinning hair. It is drawn in the space of the head and carried into the map through each
    card's own coordinates, so cards that overlap on the head are cut along the same line.
    """
    low, high = points.min(axis=0), points.max(axis=0)
    size3 = high - low
    centre = low + size3 * [0.5, 0.42, 0.49]
    x,y,z = ((points-centre) / (high-centre)).T
    azimuth = np.abs(np.arctan2(x,z))
    elevation = np.arctan2(y, np.hypot(x,z))
    # A continuous horseshoe runs from the bare forehead to the occiput.
    # Lower at the front temples, higher as it turns round the back.
    limit = np.interp(np.degrees(azimuth), [0,35,55,75,90,115,140,180], [-52,-52,-28,5,22,39,54,62])
    below = np.radians(limit) - elevation
    gone = np.clip(-below / 0.055, -1, 1)
    lie = 0.24 + 0.76 * np.clip((below + .08)/.38, 0, 1)
    size = 1024
    field = np.full((size, size), np.nan, dtype=np.float32)
    uv = np.asarray(tex)
    for c in range(0, len(corners), 3):
        t = uv[texcorners[c:c + 3]] * [size - 1, size - 1]
        t[:, 1] = size - 1 - t[:, 1]
        g = gone[corners[c:c + 3]]
        x0, x1 = int(max(0, np.floor(t[:, 0].min()))), int(min(size - 1, np.ceil(t[:, 0].max())))
        y0, y1 = int(max(0, np.floor(t[:, 1].min()))), int(min(size - 1, np.ceil(t[:, 1].max())))
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        d = (t[1, 1] - t[2, 1]) * (t[0, 0] - t[2, 0]) + (t[2, 0] - t[1, 0]) * (t[0, 1] - t[2, 1])
        if abs(d) < 1e-9:
            continue
        a = ((t[1, 1] - t[2, 1]) * (xs - t[2, 0]) + (t[2, 0] - t[1, 0]) * (ys - t[2, 1])) / d
        b = ((t[2, 1] - t[0, 1]) * (xs - t[2, 0]) + (t[0, 0] - t[2, 0]) * (ys - t[2, 1])) / d
        inside = (a >= -0.02) & (b >= -0.02) & (a + b <= 1.02)
        value = a * g[0] + b * g[1] + (1 - a - b) * g[2]
        patch = field[y0:y1 + 1, x0:x1 + 1]
        patch[inside] = np.fmax(patch[inside], value[inside])
    # Texels beside a card take the card's own value, so a sampled edge does not bring back a line of cleared hair.
    for _ in range(8):
        blank = np.isnan(field)
        if not blank.any():
            break
        near = np.stack([np.roll(field, step, axis) for axis in (0, 1) for step in (1, -1)])
        spread = np.where(np.isnan(near).all(axis=0), np.nan, np.nanmax(np.where(np.isnan(near), -np.inf, near), axis=0))
        field = np.where(blank, spread, field)
    field = np.nan_to_num(field, nan=-1.0)
    keep = Image.fromarray((np.clip(0.5 - field * 0.5, 0, 1) * 255).astype("uint8")).resize(im.size, Image.Resampling.BILINEAR)
    alpha = np.asarray(im.getchannel("A"), dtype=np.float32) * (np.asarray(keep, dtype=np.float32) / 255)
    out = im.copy()
    out.putalpha(Image.fromarray(alpha.astype("uint8")))
    return out, lie


def coil_tail(points, corners, refs, weights, offsets):
    """Wind the complete rear locks into a chignon around their tie point."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    t = np.asarray(corners).reshape(-1, 3)
    graph = coo_matrix((np.ones(t.size), (t.ravel(), np.roll(t, 1, axis=1).ravel())), shape=(len(points), len(points)))
    n, component = connected_components(graph, directed=False)
    # The separate locks whose entire length is behind the scalp share a tie.
    tail = np.zeros(len(points), bool)
    for i in range(n):
        group = component == i
        if points[group, 2].max() < 0 and points[group, 1].min() < 5.65:
            tail[group] = True
    v = points[tail]
    low, high = v[:, 1].min(), v[:, 1].max()
    u = np.clip((high - v[:, 1]) / (high - low), 0, 1)
    root = np.median(v[u < 0.06], axis=0)
    # Estimate the source cross-section down the tail; preserve the shape and
    # UVs of each lock as its former straight centreline becomes a spiral.
    stations = np.linspace(0, 1, 14)
    centre = np.array([np.median(v[np.abs(u - s) < .065],axis=0) for s in stations])
    dx = v[:,0] - np.interp(u, stations, centre[:,0])
    dz = v[:,2] - np.interp(u, stations, centre[:,2])
    angle = u * 2 * np.pi * 1.18
    radius = 0.36 * (1 - .49 * u)
    compression = 1 - .24 * u
    # Start at the tie, escape rearward, then tuck the tips against the scalp.
    x = root[0] + (radius + dx * compression) * np.cos(angle) - .27 * (1 - np.minimum(u * 5, 1))
    y = root[1] - (radius + dx * compression) * np.sin(angle)
    z = root[2] + .12 * np.minimum(1, u * 6) - .25 * np.sin(np.pi * np.minimum(1, u * 1.1))**.65 - .10 * u + dz * compression
    moved = np.column_stack((x,y,z))
    root_index = np.flatnonzero(tail)[np.argmin(np.linalg.norm(v-root, axis=1))]
    r = np.reshape(refs,(-1,3)).copy()
    w = np.reshape(weights,(-1,3)).copy()
    o = np.reshape(offsets,(-1,3)).copy()
    r[tail], w[tail] = r[root_index], w[root_index]
    o[tail] = o[root_index] + .1*(moved - points[root_index])
    return r.ravel().tolist(), w.ravel().tolist(), o.ravel().tolist()


def pack_one(name, spec, root, index):
    folder = next(p for p in root.rglob(spec["folder"]) if p.is_dir())
    clo = next(folder.glob("*.mhclo"))
    text = clo.read_text(encoding="utf8", errors="replace")
    obj = folder / next(l.split(None, 1)[1].strip() for l in text.splitlines() if l.startswith("obj_file"))
    mat = folder / next(l.split(None, 1)[1].strip() for l in text.splitlines() if l.startswith("material"))
    diffuse = folder / next(l.split(None, 1)[1].strip() for l in mat.read_text(errors="replace").splitlines() if l.startswith("diffuseTexture"))
    count, tex, corners, texcorners, points = read_mesh(obj)
    refs, weights, offsets, hide, scale, file_licence = read_fit(clo, count)
    if spec.get("facial"):
        hide = []
    if spec.get("system"):
        # A system asset carries its release in its own header.
        if "explicitly released as CC0" not in text:
            raise ValueError(name + " does not carry the system CC0 release")
        file_licence = "CC0 (system asset release, September 2020)"
    elif index.get(spec["source"].rsplit("/", 1)[1], {}).get("license") != "CC0":
        raise ValueError(name + " is not CC0 in the community asset index")
    im = Image.open(diffuse).convert("RGBA")
    if "CC0" not in file_licence.upper():
        raise ValueError(name + ": no CC0 release in the groom header")
    # A few grooms repeat their picture outside the first UV square. Bake
    # the repetitions into one tile before normalising to the portable atlas.
    uv_array = np.array(tex)
    low = np.floor(uv_array.min(axis=0))
    span = np.maximum(1, np.ceil(uv_array.max(axis=0)) - low).astype(int)
    if np.any(span > 1):
        width, height = im.size
        tiled = Image.new("RGBA", (width*span[0], height*span[1]))
        for y in range(span[1]):
            for x in range(span[0]):
                tiled.paste(im, (x*width, y*height))
        im = tiled
        tex = ((uv_array-low)/span).tolist()
    if spec.get("recede"):
        im, lie = recede(im, points, tex, corners, texcorners)
        offsets = (np.asarray(offsets).reshape(-1, 3) * lie[:, None]).ravel().tolist()
    if spec.get("coil"):
        refs, weights, offsets = coil_tail(points, corners, refs, weights, offsets)
    record = dict(
        **cutout(corners, texcorners, tex, im, encode),
        refs=encode(refs, "<u2"),
        weights=encode(weights, "<f4"),
        offsets=encode(offsets, "<f4"),
        # MakeClothes scales each offset by a span of the wearer's head; the finish step resolves it on this body.
        scale={k: list(v) for k, v in scale.items()},
        uv=encode(np.rint(np.array(tex) * 65535).clip(0, 65535), "<u2"),
        corners=encode(corners, "<u2"),
        uvCorners=encode(texcorners, "<u2"),
        hide=encode(hide, "<u2"),
        facial=bool(spec.get("facial")),
        credit=dict(author=spec["author"], licence="CC0 1.0", source=spec["source"], pack=spec["pack"],
                    fileLicenceLine=file_licence),
    )
    if name == "cloud_waves":
        record["smoothCards"] = True
    strands, normal = strand_relief(strand_tone(im, spec.get("size", 768)))
    for key, image in [("texture", strands), ("normal", normal)]:
        buf = io.BytesIO()
        image.save(buf, format="WEBP", quality=92, method=6)
        record[key] = "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()
    print(name, count, "points", len(corners) // 3, "triangles", im.size, "file licence:", file_licence or "none", flush=True)
    return record


def pack(root, out, names):
    index = json.loads(next(root.parent.rglob("assets.json")).read_text(encoding="utf8"))
    library = {name: pack_one(name, spec, root, index) for name, spec in GROOMS.items() if not names or name in names}
    # The library is finished beside its place and moved in whole, so nothing reads a half-packed file.
    draft = out.with_name(out.name + ".draft")
    draft.write_text(json.dumps(library, separators=(",", ":")) + chr(10))
    subprocess.run(["node", str(pathlib.Path(__file__).with_name("pack-human-grooms-finish.mjs")), str(draft)], check=True)
    draft.replace(out)
    print(out.stat().st_size, "bytes")


if __name__ == "__main__":
    pack(pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3:])
