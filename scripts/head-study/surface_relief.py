"""Compare surface relief on registered orthographic depth views, in real units."""
import numpy as np
from scipy.ndimage import binary_erosion, gaussian_filter


def depth_detail(target, variants, crop, pixels_per_metre):
    """Measure normals and 0.8–2.5 mm band-pass relief on identical visible support.

    A discontinuity can be the rim of a nostril or an open eye. Exclude a
    kernel's width around holes and depth jumps in any image. The returned
    coverage makes changes to that support visible beside the error.
    """
    fine_sigma = .0008 * pixels_per_metre
    broad_sigma = .0025 * pixels_per_metre
    radius = max(1, int(np.ceil(2 * broad_sigma)) + 1)
    support = crop.copy()
    fields = []
    for image in [target, *variants]:
        depth = np.where(np.isfinite(image), image, 0.0)
        continuous = np.isfinite(image)
        for axis in [0, 1]:
            edge = np.abs(np.diff(depth, axis=axis)) > .004
            a, b = [slice(None)] * 2, [slice(None)] * 2
            a[axis] = slice(None, -1)
            b[axis] = slice(1, None)
            continuous[tuple(a)] &= ~edge
            continuous[tuple(b)] &= ~edge
        support &= binary_erosion(continuous, structure=np.ones((2*radius+1, 2*radius+1)))
        fine = gaussian_filter(depth, fine_sigma, truncate=2.0)
        broad = gaussian_filter(depth, broad_sigma, truncate=2.0)
        dy, dx = np.gradient(fine * pixels_per_metre)
        normals = np.stack([-dx, -dy, np.ones_like(depth)], axis=-1)
        normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
        fields.append((normals, 1000 * (fine-broad)))
    count = int(support.sum())
    if count < 20:
        raise ValueError("Too little continuous skin for the surface-detail comparison.")
    ref_normals, ref = fields[0]
    scores = []
    for normals, relief in fields[1:]:
        cosine = np.sum(normals[support] * ref_normals[support], axis=-1)
        degrees = np.degrees(np.arccos(np.clip(cosine, -1, 1)))
        delta = relief[support] - ref[support]
        amplitude = np.abs(relief[support]) - np.abs(ref[support])
        scores.append({
            "normalMeanDeg": float(np.mean(degrees)),
            "normalP90Deg": float(np.percentile(degrees, 90)),
            "reliefErrorP90Mm": float(np.percentile(np.abs(delta), 90)),
            "excessReliefP95Mm": float(np.percentile(np.maximum(amplitude, 0), 95)),
            "missingReliefP95Mm": float(np.percentile(np.maximum(-amplitude, 0), 95)),
        })
    return {"pixels": count, "cropFraction": count / int(crop.sum())}, scores
