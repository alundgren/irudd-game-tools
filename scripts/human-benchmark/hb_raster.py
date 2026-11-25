"""Orthographic hardware rasterization with a NumPy fallback.

It serves three jobs: finding which triangles are visible from outside (so the
metrics ignore mouth interiors and other enclosed geometry), silhouettes and
thickness maps, and the clay and heat-map pictures in the report.
"""

import numpy as np

from hb_mesh import vertex_normals
from hb_gpu import hardware_renderer


def view_basis(azimuth_deg, elevation_deg=0.0):
    """Rows are the camera right, up and towards-camera axes. Azimuth 0 looks at the front."""
    az, el = np.radians(azimuth_deg), np.radians(elevation_deg)
    toward = np.array([np.sin(az) * np.cos(el), np.sin(el), np.cos(az) * np.cos(el)])
    right = np.array([np.cos(az), 0.0, -np.sin(az)])
    up = np.cross(toward, right)
    return np.stack([right, up, toward])


def rasterize(vertices, faces, basis, center, pixels_per_metre, width, height, chunk=6_000_000):
    """Return frontmost face ID, barycentric weights and camera depth for each pixel."""
    renderer = hardware_renderer()
    if renderer is not None and len(vertices):
        return renderer.draw(vertices, faces, basis, center, pixels_per_metre, width, height)
    return rasterize_numpy(vertices, faces, basis, center, pixels_per_metre, width, height, chunk)


def rasterize_numpy(vertices, faces, basis, center, pixels_per_metre, width, height, chunk=6_000_000):
    """Software fallback with the same coordinates, depth convention and background."""
    cam = (np.asarray(vertices) - center) @ basis.T
    x = cam[:, 0] * pixels_per_metre + width / 2
    y = height / 2 - cam[:, 1] * pixels_per_metre
    z = cam[:, 2]
    fx, fy, fz = x[faces], y[faces], z[faces]
    x0 = np.clip(np.floor(fx.min(1)).astype(np.int64), 0, width - 1)
    x1 = np.clip(np.ceil(fx.max(1)).astype(np.int64), 0, width - 1)
    y0 = np.clip(np.floor(fy.min(1)).astype(np.int64), 0, height - 1)
    y1 = np.clip(np.ceil(fy.max(1)).astype(np.int64), 0, height - 1)
    onscreen = (fx.max(1) >= 0) & (fx.min(1) <= width) & (fy.max(1) >= 0) & (fy.min(1) <= height)
    w = np.where(onscreen, x1 - x0 + 1, 0)
    h = np.where(onscreen, y1 - y0 + 1, 0)
    count = w * h
    face_id = np.full(width * height, -1, dtype=np.int64)
    depth = np.full(width * height, -np.inf)
    bary = np.zeros((width * height, 3))
    order = np.flatnonzero(count > 0)
    ends = np.cumsum(count[order])
    start = 0
    while start < len(order):
        stop = np.searchsorted(ends, (ends[start - 1] if start else 0) + chunk, side="right")
        stop = max(stop, start + 1)
        tri = order[start:stop]
        n = count[tri]
        owner = np.repeat(np.arange(len(tri)), n)
        offset = np.arange(n.sum()) - np.repeat(np.cumsum(n) - n, n)
        t = tri[owner]
        px = x0[t] + offset % w[t]
        py = y0[t] + offset // w[t]
        cx, cy = px + 0.5, py + 0.5
        ax, ay, bx, by, qx, qy = fx[t, 0], fy[t, 0], fx[t, 1], fy[t, 1], fx[t, 2], fy[t, 2]
        area = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax)
        with np.errstate(divide="ignore", invalid="ignore"):
            w0 = ((bx - cx) * (qy - cy) - (by - cy) * (qx - cx)) / area
            w1 = ((qx - cx) * (ay - cy) - (qy - cy) * (ax - cx)) / area
            w2 = 1 - w0 - w1
        inside = (np.abs(area) > 1e-12) & (w0 >= -1e-9) & (w1 >= -1e-9) & (w2 >= -1e-9)
        t, px, py, w0, w1, w2 = t[inside], px[inside], py[inside], w0[inside], w1[inside], w2[inside]
        d = w0 * fz[t, 0] + w1 * fz[t, 1] + w2 * fz[t, 2]
        pixel = py * width + px
        rank = np.lexsort((-d, pixel))
        pixel, t, d = pixel[rank], t[rank], d[rank]
        first = np.ones(len(pixel), dtype=bool)
        first[1:] = pixel[1:] != pixel[:-1]
        pixel, t, d = pixel[first], t[first], d[first]
        b = np.column_stack([w0[rank][first], w1[rank][first], w2[rank][first]])
        win = d > depth[pixel]
        face_id[pixel[win]], depth[pixel[win]], bary[pixel[win]] = t[win], d[win], b[win]
        start = stop
    return face_id.reshape(height, width), bary.reshape(height, width, 3), depth.reshape(height, width)


def sphere_views(rings=(-60, -30, 0, 30, 60), per_ring=(6, 10, 12, 10, 6)):
    views = [(0.0, 89.0), (0.0, -89.0)]
    for elevation, n in zip(rings, per_ring):
        views += [(360.0 * i / n + 7.0 * (elevation != 0), float(elevation)) for i in range(n)]
    return views


def visible_faces(vertices, faces, pixels_per_metre=450.0):
    """Faces that win the depth test from at least one of 46 directions around the figure."""
    vertices = np.asarray(vertices)
    center = (vertices.min(0) + vertices.max(0)) / 2
    radius = np.linalg.norm(vertices - center, axis=1).max()
    size = int(np.ceil(2 * radius * pixels_per_metre)) + 4
    seen = np.zeros(len(faces), dtype=bool)
    for azimuth, elevation in sphere_views():
        ids, _, _ = rasterize(vertices, faces, view_basis(azimuth, elevation), center, pixels_per_metre, size, size)
        seen[np.unique(ids[ids >= 0])] = True
    return seen


CLAY = np.array([0.74, 0.72, 0.70])
BACKGROUND = np.array([0.96, 0.96, 0.95])


def shade(vertices, faces, basis, center, pixels_per_metre, width, height,
          vertex_colors=None, base_color=CLAY, background=BACKGROUND, supersample=2):
    """Smooth-shaded clay picture, float RGB in 0..1, with optional per-vertex colours."""
    import cv2

    s = supersample
    renderer = hardware_renderer()
    if renderer is not None and len(vertices):
        normals = vertex_normals(np.asarray(vertices, dtype=np.float64), faces)
        colors = np.broadcast_to(base_color, normals.shape) if vertex_colors is None else np.asarray(vertex_colors)
        image, hit, depth = renderer.shade(vertices, faces, basis, center, pixels_per_metre * s,
                                           width * s, height * s, normals, colors, background)
        if s > 1:
            image = cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)
        return image, hit, depth
    ids, bary, depth = rasterize(vertices, faces, basis, center, pixels_per_metre * s, width * s, height * s)
    hit = ids >= 0
    normals = vertex_normals(np.asarray(vertices, dtype=np.float64), faces) @ basis.T
    n = np.einsum("pk,pkd->pd", bary[hit], normals[faces[ids[hit]]])
    n /= np.maximum(np.linalg.norm(n, axis=1), 1e-12)[:, None]
    n[n[:, 2] < 0] *= -1  # two-sided
    key = np.array([-0.45, 0.55, 0.70])
    fill = np.array([0.65, 0.10, 0.50])
    key, fill = key / np.linalg.norm(key), fill / np.linalg.norm(fill)
    light = 0.30 + 0.62 * np.clip(n @ key, 0, None) + 0.20 * np.clip(n @ fill, 0, None)
    light *= 0.80 + 0.20 * n[:, 2]  # gentle rim darkening that reads as form
    if vertex_colors is None:
        color = np.broadcast_to(base_color, (hit.sum(), 3))
    else:
        color = np.einsum("pk,pkd->pd", bary[hit], np.asarray(vertex_colors)[faces[ids[hit]]])
    image = np.broadcast_to(background, (height * s, width * s, 3)).copy()
    image[hit] = np.clip(color * light[:, None], 0, 1)
    if s > 1:
        image = cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)
    return image, hit, depth
