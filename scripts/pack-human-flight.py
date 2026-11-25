import json, numpy as np
from pathlib import Path
from scipy.sparse import coo_matrix, csgraph
import argparse
import subprocess
import tempfile

parser = argparse.ArgumentParser(
    description="Adapt the CC0 FlightHelmet sample glTF to an editable adult head."
)
parser.add_argument(
    "source", type=Path, help="Directory containing FlightHelmet.gltf and its textures"
)
parser.add_argument("output", type=Path)
args = parser.parse_args()
source = args.source
g = json.loads((source / "FlightHelmet.gltf").read_bytes())
b = (source / g["buffers"][0]["uri"]).read_bytes()


def read(index):
    a = g["accessors"][index]
    v = g["bufferViews"][a["bufferView"]]
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[a["type"]]
    d = np.dtype({5123: "<u2", 5125: "<u4", 5126: "<f4"}[a["componentType"]])
    if "byteStride" in v:
        return np.ndarray(
            (a["count"], n),
            dtype=d,
            buffer=b,
            offset=v.get("byteOffset", 0) + a.get("byteOffset", 0),
            strides=(v["byteStride"], d.itemsize),
        ).copy()
    return np.frombuffer(
        b,
        dtype=d,
        count=a["count"] * n,
        offset=v.get("byteOffset", 0) + a.get("byteOffset", 0),
    ).reshape(-1, n)


def parts():
    for node in g["nodes"]:
        mesh = g["meshes"][node["mesh"]]
        p = mesh["primitives"][0]
        attr = p["attributes"]
        xyz = read(attr["POSITION"])
        N = read(attr["NORMAL"])
        uv = read(attr["TEXCOORD_0"])
        faces = read(p["indices"]).reshape(-1, 3)
        world = np.eye(4)
        if "matrix" in node:
            world = np.array(node["matrix"]).reshape(4, 4).T
        if any(k in node for k in ("rotation", "translation", "scale")):
            raise ValueError(node)
        xyz = xyz @ world[:3, :3].T + world[:3, 3]
        _, idx = np.unique(np.round(xyz, 5), axis=0, return_inverse=True)
        ids = idx[faces]
        n = int(idx.max()) + 1
        graph = coo_matrix(
            (np.ones(3 * len(ids)), (ids.ravel(), np.roll(ids, 1, 1).ravel())),
            shape=(n, n),
        )
        _, labels = csgraph.connected_components(graph, directed=False)
        tri = labels[ids[:, 0]]
        keys = sorted(np.unique(tri), key=lambda k: -(tri == k).sum())
        for rank, k in enumerate(keys):
            yield node["name"], rank, xyz, N, uv, faces[tri == k], p["material"]


import base64, zlib
from PIL import Image


def encoded(a):
    return base64.b64encode(zlib.compress(a.tobytes(), 9)).decode()


def texture(index, side, srgb=False):
    image = Image.open(
        source / g["images"][g["textures"][index]["source"]]["uri"]
    ).convert("RGB")
    image.thumbnail((side, side), Image.Resampling.LANCZOS)
    step = 4 if srgb else 6
    planes = np.moveaxis(np.asarray(image).astype(np.float32), 2, 0)
    planes = np.minimum(255, np.rint(planes / step) * step).astype(np.uint8)
    planes[:, :, 1:] = planes[:, :, 1:] - planes[:, :, :-1]
    return encoded(planes)


out = []
for name, rank, xyz, norm, uv, f, mi in parts():
    goggles = (
        name == "Lenses_low"
        or name == "GlassPlastic_low"
        and rank == 0
        or name == "MetalParts_low"
        and rank < 4
        or name == "LeatherParts_low"
        and rank in (5, 10)
        or name == "RubberWood_low"
        and rank == 9
    )
    cap = (
        name == "LeatherParts_low"
        and rank in (0, 1, 2, 3, 7, 8, 9, 12)
        or name == "GlassPlastic_low"
        and rank in (1, 2)
        or name == "MetalParts_low"
        and rank in (4, 5, 8, 9, 10, 11, 12, 13, 14, 15)
    )
    if not cap and not goggles:
        continue
    idx, inv = np.unique(f, return_inverse=True)
    coords = xyz[idx].copy()
    normal = norm[idx].copy()
    if goggles:
        angle = np.deg2rad(37)
        axis = np.array(
            [[np.cos(angle), np.sin(angle)], [-np.sin(angle), np.cos(angle)]]
        )
        coords[:, 0] *= 0.94
        coords[:, 1] = 0.562 + 0.88 * (coords[:, 1] - 0.562)
        origin = np.array([0.556, -0.029])
        coords[:, 1:] = (coords[:, 1:] - origin) @ axis.T + origin
        normal[:, 1:] = normal[:, 1:] @ axis.T
    coords = (coords - np.array([0, 0.596, -0.011])) / np.array([0.105, 0.109, 0.121])
    points = np.concatenate([coords, normal, uv[idx]], axis=1)
    out.append(
        dict(
            part=name,
            rank=rank,
            mi=mi,
            vertices=encoded(np.int16(np.rint(points * 10000))),
            indices=encoded(inv.astype(np.uint16)),
        )
    )
surfaces = []
for i, m in enumerate(g["materials"]):
    if not any(e["mi"] == i for e in out):
        surfaces.append(None)
        continue
    size = 512 if "Leather" in m["name"] else 256
    mat = m["pbrMetallicRoughness"]
    surfaces.append(
        dict(
            name=m["name"],
            size=size,
            color=texture(mat["baseColorTexture"]["index"], size, True),
            normal=texture(m["normalTexture"]["index"], size),
            orm=texture(mat["metallicRoughnessTexture"]["index"], size),
        )
    )
with tempfile.TemporaryDirectory() as tmp:
    full = Path(tmp) / "geometry.json"
    full.write_text(
        json.dumps(dict(parts=out, surfaces=surfaces), separators=(",", ":"))
    )
    subprocess.run(
        [
            "node",
            str(Path(__file__).with_name("pack-human-flight-finish.mjs")),
            str(full),
            str(args.output),
        ],
        check=True,
    )
