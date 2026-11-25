"""The head scans used as practice targets: where they come from and how they are loaded.

Every reference asset stays local. A raw scan is read from a cache folder that
git ignores, welded and turned upright. `prepare-targets.py` then places it on
the neutral editable head and writes the placed mesh back into the same cache.
Nothing derived from a scan is written into the repository: not the mesh, not
the fitted recipe and not a picture that shows it.
"""

import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np

import _paths  # noqa: F401  (adds scripts/human-benchmark to the import path)
from hb_mesh import read_glb
from hb_raster import visible_faces

ROOT = Path(__file__).resolve().parents[2]

SOURCES = {
    "lee-perry-smith": {
        "title": "Lee Perry-Smith head scan",
        "folder": "lee-perry-smith",
        "file": "LeePerrySmith.glb",
        "url": "https://raw.githubusercontent.com/mrdoob/three.js/r187/examples/models/gltf/LeePerrySmith/LeePerrySmith.glb",
        "sha256": "402b8a8ac9f03232e6d64b5962929703a069daf99d3c49ac8eb0e48bedc9c576",
        "page": "https://github.com/mrdoob/three.js/tree/r187/examples/models/gltf/LeePerrySmith",
        "license": "CC BY 3.0 Unported",
        "license_url": "https://creativecommons.org/licenses/by/3.0/",
        "attribution": "Infinite, 3D Head Scan by Lee Perry-Smith (www.triplegangers.com, www.ir-ltd.net), "
                       "licensed under CC BY 3.0. Modified: welded, scaled and placed on a 1.72 m editable human.",
        # The file has no unit. These guesses only start the search; the fit decides.
        "metres_per_unit": (0.044, 0.051, 0.058),
        "pitch_degrees": (0,),
        "blink": 1.0,
        "not_skin": {},
    },
    "lincoln-mills": {
        "title": "Abraham Lincoln life mask, Clark Mills 1865 (cast c. 1917)",
        "folder": "lincoln-mills",
        "file": "abraham-lincoln-mills-life-mask-150k-4096-high.glb",
        "url": "https://3d-api.si.edu/content/document/3d_package:c02c239d-5ebf-4a7a-a368-e2288bbf4b31/"
               "abraham-lincoln-mills-life-mask-150k-4096-high.glb",
        "sha256": "0df0969c3ea25085b66d2c0fd865b96f5b3310f25729f26def7977863ab28bac",
        "page": "https://npg.si.edu/object/npg_NPG.71.26",
        "license": "Listed as CC0 by the Smithsonian Open Access API; the 3D package itself says "
                   "\"(c) Smithsonian Institution. All rights reserved.\"",
        "license_url": "https://www.si.edu/openaccess",
        "attribution": "National Portrait Gallery, Smithsonian Institution; transfer from the National Museum of American History.",
        "draco": True,
        "flat_cut": True,  # the cast ends in a modelled flat base that is not anatomy
        "metres_per_unit": (0.001,),  # the package records millimetres
        "pitch_degrees": (-60, -45, -30, -15),
        "blink": 1.0,
        # Surface of the cast that is hair or a casting cap, not skin.
        "not_skin": {"chin and jaw": "beard", "cranium": "hair flattened under the casting cap",
                     "neck": "the cast ends under the jaw"},
    },
}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def weld(vertices, faces, decimals=6):
    """Merge vertices that share a position (texture seams split them) and drop collapsed faces."""
    span = np.ptp(vertices, axis=0).max()
    keys = np.round(vertices / span, decimals)
    _, first, inverse = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    faces = inverse.reshape(-1)[faces]
    keep = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 2] != faces[:, 0])
    return vertices[first], faces[keep]


def boundary_vertices(faces):
    """Vertices on an open edge of the mesh."""
    edges = np.sort(np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), axis=1)
    unique, count = np.unique(edges, axis=0, return_counts=True)
    return np.unique(unique[count == 1])


def outside_faces(vertices, faces):
    """Faces of a scan that can be seen from outside.

    Some head meshes carry a modelled mouth cavity or nostril tubes. Open edges
    (the cut under a bust) are covered with temporary lids so no view looks in
    from below, then every face that wins a pixel from one of 46 directions
    counts as outside. A hidden face whose three corners all belong to visible
    faces is kept: it is a triangle too small to win a pixel, not a cavity.
    """
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    unique, index, count = np.unique(np.sort(edges, axis=1), axis=0, return_index=True, return_counts=True)
    rim = edges[index[count == 1]]
    points, lids = [vertices], []
    if len(rim):
        group = np.arange(len(vertices))  # union-find over rim vertices, one group per loop

        def root(i):
            while group[i] != i:
                group[i] = group[group[i]]
                i = group[i]
            return i

        for a, b in rim:
            group[root(a)] = root(b)
        loop = np.array([root(a) for a in rim[:, 0]])
        for k, name in enumerate(np.unique(loop)):
            members = rim[loop == name]
            points.append(vertices[np.unique(members)].mean(0)[None])
            lids.append(np.column_stack([members[:, 1], members[:, 0], np.full(len(members), len(vertices) + k)]))
    shell = np.concatenate([faces, *lids])
    points = np.vstack(points)
    typical = np.median(np.linalg.norm(vertices[faces[:, 0]] - vertices[faces[:, 1]], axis=1))
    seen = visible_faces(points, shell, pixels_per_metre=float(np.clip(3.0 / typical, 1500.0, 4000.0)))[: len(faces)]
    used = np.zeros(len(vertices), dtype=bool)
    used[faces[seen]] = True
    return seen | used[faces].all(1)


def drop_flat_cut(vertices, faces, reach=0.02, facing=0.6, seed=3):
    """Remove the flat rim a hollow cast ends in, so the opening can be told from the skin.

    A life mask is a shell: an outer face, an inner face and a flat rim joining
    them. The rim's plane is the plane, among those of 400 triangles drawn by
    area, that has the most surface lying in it and facing along it; it is then
    refitted twice to everything near it. Faces within `reach` (a fraction of
    the mesh's size) of the plane that face along it are the rim. With the rim
    gone the shell has an open edge, and `outside_faces` then lids it and drops
    the inner face as hidden.
    """
    a, b, c = (vertices[faces[:, i]] for i in range(3))
    cross = np.cross(b - a, c - a)
    area = np.linalg.norm(cross, axis=1) / 2
    normal = cross / np.maximum(2 * area, 1e-20)[:, None]
    centre = (a + b + c) / 3
    size = np.ptp(vertices, axis=0).max()
    best = np.zeros(len(faces), dtype=bool)
    for face in np.random.default_rng(seed).choice(len(faces), 400, p=area / area.sum()):
        on_plane = (normal @ normal[face] > 0.9) & (np.abs((centre - centre[face]) @ normal[face]) < 0.01 * size)
        if area[on_plane].sum() > area[best].sum():
            best = on_plane
    for _ in range(2):
        weight = area[best] / area[best].sum()
        origin = weight @ centre[best]
        direction = weight @ normal[best]
        direction /= np.linalg.norm(direction)
        best = (normal @ direction > facing) & (np.abs((centre - origin) @ direction) < reach * size)
    return faces[~best], float(area[best].sum() / area.sum())


def largest_piece(faces):
    """Mask of the faces in the biggest edge-connected piece (drops loose fragments)."""
    group = np.arange(faces.max() + 1)
    for _ in range(256):
        before = group.copy()
        np.minimum.at(group, faces.reshape(-1), np.repeat(group[faces].min(1), 3))
        group = group[group]
        if (group == before).all():
            break
    label = group[faces[:, 0]]
    names, counts = np.unique(label, return_counts=True)
    return label == names[counts.argmax()]


def _quaternion(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def load_raw(name, cache):
    """Welded vertices in the file's own unit, Y up as the publisher shows it, and faces."""
    source = SOURCES[name]
    folder = Path(cache) / source["folder"]
    path = folder / source["file"]
    if not path.exists():
        raise FileNotFoundError(f"Download {source['url']} to {path}")
    if sha256(path) != source["sha256"]:
        raise ValueError(f"{path} is not the file this study was measured on.")
    if source.get("draco"):
        prefix = folder / "decoded"
        if not prefix.with_suffix(".positions.f32").exists():
            subprocess.run(["node", str(Path(__file__).with_name("decode-draco.mjs")), str(path), str(prefix)], check=True)
        vertices = np.fromfile(prefix.with_suffix(".positions.f32"), "<f4").reshape(-1, 3).astype(np.float64)
        faces = np.fromfile(prefix.with_suffix(".indices.u32"), "<u4").reshape(-1, 3).astype(np.int64)
        document = folder / "document.json"
        if document.exists():  # the publisher's display orientation
            model = json.loads(document.read_text(encoding="utf-8"))["models"][0]
            vertices = vertices @ _quaternion(model["rotation"]).T
    else:
        vertices, faces, _, _ = read_glb(path)
    vertices, faces = weld(vertices, faces)
    if source.get("flat_cut"):
        faces, _ = drop_flat_cut(vertices, faces)
    return vertices, faces


def manifest_path(cache):
    return Path(cache) / "manifest.json"


def manifest(cache):
    path = manifest_path(cache)
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"targets": {}}


def placed_path(name, cache):
    """Where the placed target mesh lives, inside the local cache."""
    return Path(cache) / "placed" / f"{name}.glb"


def load_placed(name, cache):
    """The target on the neutral editable head, in metres. Returns None if it is not prepared here."""
    path = placed_path(name, cache)
    if not path.exists():
        return None
    vertices, faces, _, _ = read_glb(path)
    return vertices, faces
