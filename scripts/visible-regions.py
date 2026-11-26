"""Measure the visible pixels of named regions in a static workshop game GLB.

Render the primary skinned character mesh orthographically at a fixed pixel height. Separate facial meshes and props are excluded. Count the pixels each region
would cover alone, and the pixels whose nearest triangle belongs to that region.
Usage: python scripts/visible-regions.py model.glb "right hand" "left hand"
"""
import argparse
import json
from pathlib import Path
from runpy import run_path

import numpy as np


def measure(mesh, names, yaw, height):
    angle = np.radians(yaw)
    vertices = mesh.rest.astype(float)
    scale = (height - 1) / np.ptp(vertices[:, 1])
    x = (vertices[:, 0] * np.cos(angle) - vertices[:, 2] * np.sin(angle)) * scale
    y = (vertices[:, 1].max() - vertices[:, 1]) * scale
    z = vertices[:, 0] * np.sin(angle) + vertices[:, 2] * np.cos(angle)
    x -= x.min()
    width = int(np.ceil(x.max())) + 1
    triangles = mesh.triangles
    ids = mesh.region_indices[triangles]
    region = np.where(ids[:, 1] == ids[:, 2], ids[:, 1], ids[:, 0])
    tx, ty, tz = x[triangles], y[triangles], z[triangles]
    pixels, depths, owners = [], [], []
    for first in range(0, len(triangles), 128):
        a, b, d = (v[first:first + 128] for v in (tx, ty, tz))
        left, top = np.floor(a.min(1)).astype(int), np.floor(b.min(1)).astype(int)
        dx = np.arange(int(np.ceil((a.max(1) - left).max())) + 1)
        dy = np.arange(int(np.ceil((b.max(1) - top).max())) + 1)
        xx = left[:, None, None] + dx[None, None, :]
        yy = top[:, None, None] + dy[None, :, None]
        ex = (xx + .5) - a[:, 0, None, None]
        ey = (yy + .5) - b[:, 0, None, None]
        ax, bx = (a[:, i, None, None] - a[:, 0, None, None] for i in (1, 2))
        ay, by = (b[:, i, None, None] - b[:, 0, None, None] for i in (1, 2))
        det = ax * by - bx * ay
        denominator = np.where(np.abs(det) > 1e-10, det, 1)
        u, v = (ex * by - ey * bx) / denominator, (ey * ax - ex * ay) / denominator
        hit = (np.abs(det) > 1e-10) & (u >= 0) & (v >= 0) & (u + v <= 1)
        hit &= (xx >= 0) & (xx < width) & (yy >= 0) & (yy < height)
        i, j, k = np.nonzero(hit)
        pixels.append((top[i] + j) * width + left[i] + k)
        depths.append(d[i, 0] + u[i,j,k] * (d[i,1] - d[i,0]) + v[i,j,k] * (d[i,2] - d[i,0]))
        owners.append(region[first + i])
    pixel, depth, owner = map(np.concatenate, (pixels, depths, owners))
    order = np.lexsort((-depth, pixel))
    front = order[np.r_[True, np.diff(pixel[order]) != 0]]
    result = {}
    for name in names:
        index = mesh.region_names.index(name)
        total = len(np.unique(pixel[owner == index]))
        seen = pixel[front[owner[front] == index]]
        result[name] = {"projected": total, "visible": len(seen),
                        "fraction": round(len(seen)/total, 3) if total else None}
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", type=Path)
    parser.add_argument("regions", nargs="+")
    parser.add_argument("--height", type=int, default=256)
    parser.add_argument("--angles", type=float, nargs="+", default=[0, 35, 90, 145, 180])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 16 <= args.height <= 1024:
        parser.error("Choose a figure height between 16 and 1024 pixels.")
    glb = run_path(str(Path(__file__).with_name("measure-garments.py")))["WorkshopMesh"](args.model)
    if glb.region_indices is None or any(name not in glb.region_names for name in args.regions):
        parser.error("Choose named regions from a workshop game-detail GLB.")
    views = {str(yaw): measure(glb, args.regions, yaw, args.height) for yaw in args.angles}
    text = json.dumps({"figureHeightPx": args.height, "mesh": "Character surface", "otherMeshCount": len(glb.gltf["meshes"]) - 1, "azimuthDegrees": views}, indent=2)
    if args.output:
        args.output.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
