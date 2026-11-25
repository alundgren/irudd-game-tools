"""Project CC0 MakeHuman eyebrow paint into the editable face UV layout.

Usage: python scripts/pack-human-brows.py SYSTEM_ZIP MPFB_BASE_FOLDER OUTPUT_JSON
The projection runs on the neutral head. In the game the paint deforms on the
same skin as the sculpt, the raised brow hairs, scars, and expressions.
"""
import base64
import io
import json
import runpy
import sys
import tempfile
import zipfile
import zlib
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates
from scipy.spatial import cKDTree

here = Path(__file__).resolve().parent
skin = runpy.run_path(str(here / "pack-human-complexion.py"))
face = runpy.run_path(str(here / "pack-human-face.py"))
read_proxy = face["read_proxy"]


def project_brow(card, alpha, verts, faces, uv, tex, rect, fibres=None):
    # Flatten the authored brow cards onto the closest patch of skin.
    position = (verts[card["refs"]] * card["weights"][..., None]).sum(1) + card["offsets"]
    triangles = verts[faces]
    tree = cKDTree(triangles.mean(1))
    projected = []
    for point in position:
        _, ids = tree.query(point, 16)
        a, b, c = triangles[ids].transpose(1, 0, 2)
        bary, dist = skin["closest_on_triangles"](point, a, b, c)
        best = dist.argmin()
        projected.append(bary[best] @ uv[tex[ids[best]]])
    # Pixel centres use the same convention as fitFaceLayout.
    density = 2
    projected = (np.array(projected) * [2048, -2048] + [-rect[0], 2048 - rect[1]]) * density
    width, height = (np.array(rect[2:]) - rect[:2]) * density
    target = np.zeros((height, width), dtype=np.uint8)
    for vertices, source_uv in zip(card["corners"].reshape(-1,3), card["uv"].reshape(-1,3)):
        t = projected[vertices]
        lo = np.maximum(0, np.floor(t.min(0)).astype(int))
        hi = np.minimum([width, height], np.ceil(t.max(0)).astype(int))
        if (lo >= hi).any():
            continue
        basis = (t[1:] - t[0]).T
        if abs(np.linalg.det(basis)) < 0.001:
            continue
        yy, xx = np.mgrid[lo[1]:hi[1], lo[0]:hi[0]]
        coords = np.stack([xx + .5 - t[0,0], yy + .5 - t[0,1]], 0)
        u, v = np.einsum("ij,jkl->ikl", np.linalg.inv(basis), coords)
        weights = np.stack([1-u-v, u, v], 0)
        source = np.einsum("ij,ikl->jkl", card["tex"][source_uv], weights)
        values = map_coordinates(alpha, [(1-source[1]) * (alpha.shape[0]-1), source[0] * (alpha.shape[1]-1)], order=1)
        view = target[lo[1]:hi[1], lo[0]:hi[0]]
        np.maximum(view, np.where(weights.min(0) >= -.001, values, 0), out=view)
    img = Image.fromarray(target)
    bounds = img.getbbox()
    assert bounds and img.histogram()[0] < width * height - 1000
    cut = img.crop(bounds)
    mask = Image.new("RGBA", cut.size, "white")
    mask.putalpha(cut)
    buf = io.BytesIO()
    mask.save(buf, "PNG", optimize=True)
    result = {"x": bounds[0], "y": bounds[1], "url": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()}
    if fibres:
        # The scar parts actual strand roots. Project their fitted card
        # coordinates by the same map used to paint the brows.
        def field(key, dtype):
            return np.frombuffer(zlib.decompress(base64.b64decode(fibres[key])), dtype)
        points = (projected[field("triRefs", "<u2").reshape(-1, 3)] *
                  field("triWeights", "<f4").reshape(-1, 3, 1)).sum(axis=1)
        roots = field("root", "<u2")
        starts = np.flatnonzero(roots == np.arange(len(roots)))
        assert np.all(roots[starts + 4] == starts)
        lines = np.stack([(points[starts] + points[starts+1])/2,
                          (points[starts+2] + points[starts+3])/2, points[starts+4]], axis=1)
        packed = np.rint(np.clip(lines / [width, height], 0, 1) * 65535).astype("<u2")
        result.update(strokes=base64.b64encode(zlib.compress(packed.tobytes(),9)).decode(), fibres=fibres)
    return result


def pack(archive, mpfb, out):
    rect = json.loads((out.parent / "human-complexion-data.json").read_text())["rect"]
    verts, uv, faces, tex, _ = skin["read_base"](mpfb)
    maps = {}
    with zipfile.ZipFile(archive) as src, tempfile.TemporaryDirectory() as tmp:
        for number in [1, 3, 5, 6, 9, 11, 12]:
            name = f"eyebrow{number:03d}"
            prefix = f"eyebrows/{name}/{name}"
            assert "CC0" in src.read(prefix + ".mhmat").decode()
            folder = Path(tmp) / "eyebrows" / name
            folder.mkdir(parents=True)
            assert "CC0" in src.read(prefix + ".mhclo").decode()
            for ext in [".mhclo", ".obj", ".png"]:
                (folder / (name + ext)).write_bytes(src.read(prefix + ext))
            card = read_proxy(folder, name)
            fibres = None if number in (1, 3) else face["strands"](
                Path(tmp), "eyebrows", name, 2, 1.1, 9, 3, 11, max_length=36, hairs=True)
            alpha = np.asarray(Image.open(io.BytesIO(src.read(prefix + ".png"))).convert("RGBA").getchannel("A"))
            maps[name] = project_brow(card, alpha, verts, faces, uv, tex, rect, fibres)
    out.write_text(json.dumps(maps, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    pack(*map(Path, sys.argv[1:]))
