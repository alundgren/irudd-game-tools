"""Shared pieces of the scan hair study: sources, face landmarks and the fit of a scan head to the native head."""
import sys
from pathlib import Path
import numpy as np

# The scans, the fitted heads and every intermediate file stay in the ignored cache; only these scripts and the
# packed result are part of the repository.
here = Path(__file__).resolve().parents[2] / '.reference-cache' / 'scan-hair11'
person = here.parent / 'scan-person11'
sys.path.insert(0, str(person))
import render as R  # noqa: E402  (the coordinator's renderer and native head port; needs the repo root as cwd)

# Face-mesh points that stay put between people and expressions: eye corners, nose bridge and base, brow ridge,
# cheekbones, the sides of the face by the ears, and the chin.
STABLE = [33, 133, 263, 362, 168, 6, 197, 2, 98, 327, 70, 300, 107, 336, 10, 151, 9, 116, 345, 234, 454, 127, 356, 152, 148, 377, 172, 397, 132, 361]


def source(name):
    """A scan as (xyz, faces, face uv, image), y up and facing where its landmarks say."""
    folder = here / 'source' / name
    if not folder.exists():
        return R.donor(name)
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    obj = next(folder.glob('*.obj'))
    rows = obj.read_text().splitlines()
    xyz = np.array([line.split()[1:4] for line in rows if line.startswith('v ')], dtype='f')
    uv = np.array([line.split()[1:3] for line in rows if line.startswith('vt ')], dtype='f')
    faces = np.array([[v.split('/')[:2] for v in line.split()[1:]] for line in rows if line.startswith('f ')], int) - 1
    xyz = xyz[:, [0, 2, 1]].copy(); xyz[:, 2] *= -1
    return xyz, faces[:, :, 0], uv[faces[:, :, 1]], Image.open(next(folder.glob('*diffuse.png')))


def landmarker():
    import mediapipe as mp
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision
    lm = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(base_options=python.BaseOptions(model_asset_path=str(person / 'face.task')), min_face_detection_confidence=.38))
    return lambda rgb: lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))


def face_marks(head, detect, cache=None):
    """The 468 face-mesh points on a head in its own space, from the view that sees the face most squarely,
    refined once from an upright close view."""
    if cache is not None and cache.exists():
        return np.load(cache)['xyz']
    best = None
    for yaw in [0, 30, -30, 60, -60, 180, 150, 210, 120, 240, 90, 270]:
        rgb, world, _ = head.render(yaw)
        result = detect(rgb)
        if not result.face_landmarks:
            continue
        pt = np.array([(v.x, v.y) for v in result.face_landmarks[0]]) * rgb.shape[0]
        at = np.round(pt).astype(int).clip(0, rgb.shape[0] - 1)
        rank = np.linalg.norm(pt[33] - pt[263]) - abs(np.linalg.norm(pt[1] - pt[33]) - np.linalg.norm(pt[1] - pt[263]))
        if best is None or rank > best[0]:
            best = (rank, world[at[:, 1], at[:, 0], :3])
    if best is None:
        raise RuntimeError('no face found')
    first = best[1]
    for _ in range(2):
        unit = lambda v: v / np.linalg.norm(v)
        x = unit(first[263] - first[33]); up = unit(first[10] - first[152]); z = unit(np.cross(x, up)); y = unit(np.cross(z, x))
        axes = np.stack([x, y, z]); centre = (first[33] + first[263]) / 2 - .012 * y
        rgb, world, _ = head.render(axes=axes, center=centre, size=1024, scale=.135)
        import cv2
        result = detect(cv2.resize(rgb, (640, 640), interpolation=cv2.INTER_AREA))
        if not result.face_landmarks:
            break
        pt = np.array([[v.x * 1024 - .5, v.y * 1024 - .5] for v in result.face_landmarks[0]])
        at = np.rint(pt).astype(int).clip(0, 1023)
        first = world[at[:, 1], at[:, 0], :3]
    if cache is not None:
        np.savez(cache, xyz=first)
    return first


def similarity(a, b):
    """Scale, rotation and shift taking points a onto b in the least-squares sense (Umeyama)."""
    ma, mb = a.mean(0), b.mean(0)
    A, B = a - ma, b - mb
    U, S, Vt = np.linalg.svd(B.T @ A / len(a))
    D = np.eye(3); D[2, 2] = np.sign(np.linalg.det(U @ Vt))
    Rm = U @ D @ Vt
    s = np.trace(np.diag(S) @ D) / (A ** 2).sum(1).mean()
    return s, Rm, mb - s * Rm @ ma
