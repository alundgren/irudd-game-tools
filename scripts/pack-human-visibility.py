"""Bake ambient visibility from the workshop's own neutral, unstyled head.

Run from the repository after pnpm install --frozen-lockfile with numpy, scipy, Pillow and moderngl.
Uses the same hardware rasterizer and software fallback as the 3D benchmark.
"""
import base64
import io
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "human-benchmark"))
from hb_mesh import vertex_normals
from hb_raster import rasterize, view_basis


def neutral_head():
    script = """
      import {evaluateHuman, smoothHumanSurface} from './character-view/human-surface.js';
      const s = smoothHumanSurface(evaluateHuman({height: 1.72}));
      const faces = [], textureFaces = [];
      for (let i = 0; i < 3*s.bodyTriangles; i += 3) {
        if ([0,1,2].every(k => s.positions[s.indices[i+k]*3+1] < 1.43)) continue;
        faces.push(...s.indices.subarray(i,i+3));
        textureFaces.push(...s.uvFaces.subarray(i,i+3));
      }
      console.log(JSON.stringify({positions:Array.from(s.positions), faces, uv:Array.from(s.uv), textureFaces}));
    """
    data = json.loads(subprocess.check_output(["node", "--input-type=module", "-e", script], cwd=ROOT))
    ids, triangles = np.unique(data["faces"], return_inverse=True)
    positions = np.array(data["positions"]).reshape(-1, 3)[ids]
    return positions, triangles.reshape(-1, 3), np.array(data["uv"]).reshape(-1, 2), np.array(data["textureFaces"]).reshape(-1, 3)


def ambient_visibility(vertices, faces, samples=192, size=512):
    normals = vertex_normals(vertices, faces)
    centre = (vertices.max(0) + vertices.min(0)) / 2
    density = (size - 8) / np.linalg.norm(np.ptp(vertices, axis=0))
    total = np.zeros(len(vertices))
    blocked = np.zeros_like(total)
    for index in range(samples):
        basis = view_basis(np.degrees(index * 2.39996322972865),
                           np.degrees(np.arcsin(1 - 2 * (index + 0.5) / samples)))
        _, _, depth = rasterize(vertices, faces, basis, centre, density, size, size)
        cam = (vertices - centre) @ basis.T
        x = np.clip(np.floor(size/2 + cam[:, 0]*density).astype(int), 0, size-1)
        y = np.clip(np.floor(size/2 - cam[:, 1]*density).astype(int), 0, size-1)
        gap = depth[y, x] - cam[:, 2]
        weight = np.maximum(0, normals @ basis[2])
        bias = 0.0006 + 0.0007 / np.maximum(0.15, weight)
        hit = np.clip((gap-bias)/0.0018, 0, 1) * np.clip((0.045-gap)/0.020, 0, 1)
        blocked += weight * hit
        total += weight
    return 1 - blocked / np.maximum(total, 1e-9)


def face_chart(visibility, faces, uv, texture_faces, bounds):
    left, top, right, bottom = bounds
    w, h = right-left, bottom-top
    pixels = uv.astype(float) / 65535 * 2048
    pixels[:, 0] -= left
    pixels[:, 1] = 2048 - pixels[:, 1] - top
    inside = ((pixels[:, 0] >= -1) & (pixels[:, 0] <= w+1) &
              (pixels[:, 1] >= -1) & (pixels[:, 1] <= h+1))
    keep = inside[texture_faces].all(axis=1)
    xy = pixels[texture_faces[keep]].reshape(-1, 2)
    points = np.column_stack((xy[:, 0]-w/2, h/2-xy[:, 1], np.zeros(len(xy))))
    ids, weights, _ = rasterize(points, np.arange(len(xy)).reshape(-1, 3),
                                np.eye(3), np.zeros(3), 1, w, h)
    mask = ids >= 0
    image = np.ones((h, w))
    image[mask] = (weights[mask] * visibility[faces[keep][ids[mask]]]).sum(axis=1)
    dist, nearest = distance_transform_edt(~mask, return_indices=True)
    pad = (~mask) & (dist <= 4)
    image[pad] = image[nearest[0][pad], nearest[1][pad]]
    yy, xx = np.indices((h, w))
    fade = np.minimum.reduce([xx, w-1-xx, yy, h-1-yy]).clip(0, 4) / 4
    return Image.fromarray(np.uint8(np.round(255 * (1 - (1-image)*fade).clip(0, 1))))


if __name__ == "__main__":
    folder = ROOT / "character-view"
    layout = json.loads((folder / "human-complexion-data.json").read_text())
    vertices, faces, uv, texture_faces = neutral_head()
    image = face_chart(ambient_visibility(vertices, faces), faces, uv, texture_faces, layout["rect"])
    png = io.BytesIO()
    image.save(png, format="PNG", optimize=True)
    asset = {
        "source": "Hemispherical visibility of the workshop neutral adult face, derived from its CC0 MakeHuman/MPFB production mesh.",
        "map": "data:image/png;base64," + base64.b64encode(png.getvalue()).decode(),
    }
    (folder / "human-face-visibility.json").write_text(json.dumps(asset, separators=(",", ":")) + "\n", encoding="utf-8")
