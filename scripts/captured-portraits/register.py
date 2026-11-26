"""Register an upright image and world map of each scan to the editable face chart."""

import io
import cv2
import numpy as np
from PIL import Image
from inputs import CACHE as p, FRAMES
from render import Head, editable, donor
import base64, json, mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from scipy.interpolate import RBFInterpolator
from scipy.ndimage import distance_transform_edt

lm = vision.FaceLandmarker.create_from_options(
    vision.FaceLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(p / "face.task")),
        min_face_detection_confidence=0.38,
    )
)
norm = lambda v: v / np.linalg.norm(v)


def upright(h, name):
    first = np.load(p / (name + "-marks.npz"))["xyz"][:, :3]
    if name.startswith("native"):
        axes = np.eye(3)
        center = 0.5 * (first[33] + first[263])
        center[0] = 0
        center[1] -= 0.012
    else:
        sample = [
            10,
            152,
            127,
            356,
            234,
            454,
            93,
            323,
            123,
            352,
            1,
            4,
            6,
            195,
            168,
            9,
            94,
            136,
            365,
            58,
            288,
            103,
            332,
            67,
            297,
            101,
            330,
            109,
            338,
        ]
        ref = np.load(p / "native-m-marks.npz")["xyz"][sample, :3]
        src = first[sample]
        good = (np.linalg.norm(src, axis=1) > 0.1) & (np.linalg.norm(ref, axis=1) > 0.1)
        src, ref = src[good], ref[good]
        rc = ref.mean(0)
        sc = src.mean(0)
        u, _, v = np.linalg.svd((src - sc).T @ (ref - rc))
        rot = u @ v
        if np.linalg.det(rot) < 0:
            u[:, -1] *= -1
            rot = u @ v
        axes = rot.T
        center = 0.5 * (first[33] + first[263]) - 0.012 * axes[1]
    rgb, world, uv = h.render(axes=axes, center=center, size=1024, scale=0.135)
    small = cv2.resize(rgb, (640, 640), interpolation=cv2.INTER_AREA)
    r = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=small))
    if not r.face_landmarks:
        raise ValueError(name)
    pt = np.array([[v.x * 1024 - 0.5, v.y * 1024 - 0.5] for v in r.face_landmarks[0]])
    if name.startswith("native"):
        for ring in [h.xyz[6756:6784], h.xyz[13352:13380]]:
            view = (ring - center) @ axes.T / 0.135
            pixels = np.stack(
                [(1 + view[:, 0]) * 512 - 0.5, (1 - view[:, 1]) * 512 - 0.5], -1
            )
            group = min(
                [eyeR, eyeL],
                key=lambda ids: np.linalg.norm(pt[ids].mean(0) - pixels.mean(0)),
            )
            cc = pixels.mean(0)
            coords = pixels - cc
            scale = np.ptp(coords, axis=0)

            def ang(c):
                return np.arctan2(c[:, 1] / scale[1], c[:, 0] / scale[0])

            aa = ang(coords)
            seq = np.argsort(aa)
            phi = ang(pt[group] - pt[group].mean(0))
            for k in [0, 1]:
                pt[group, k] = np.interp(phi, aa[seq], pixels[seq, k], period=2 * np.pi)
    xy = np.rint(pt).astype(int).clip(0, 1023)
    xyz = world[xy[:, 1], xy[:, 0], :3]
    return rgb, world, pt, xyz, axes, center


def native_uv(h):
    w, hg = 541, 591
    uv = h.uv.copy()
    uv[:, :, 0] = uv[:, :, 0] * 2048 - 1494 - 0.5
    uv[:, :, 1] = (1 - uv[:, :, 1]) * 2048 - 763 - 0.5
    uv = np.float32(uv)
    keep = (uv.max(axis=1) > 0).all(axis=1) & (uv.min(axis=1) < [w, hg]).all(axis=1)
    idx = np.flatnonzero(keep)
    ids = np.zeros((hg, w), np.int32)
    for i in idx:
        cv2.fillConvexPoly(ids, np.int32(np.round(uv[i] * 256)), int(i + 1), shift=8)
    tri = ids - 1
    yy, xx = np.mgrid[:hg, :w]
    a, b, c = uv[tri].transpose(2, 0, 1, 3)
    det = (b[:, :, 1] - c[:, :, 1]) * (a[:, :, 0] - c[:, :, 0]) + (
        c[:, :, 0] - b[:, :, 0]
    ) * (a[:, :, 1] - c[:, :, 1])
    det = np.where(abs(det) < 1e-7, 1, det)
    wa = (
        (b[:, :, 1] - c[:, :, 1]) * (xx - c[:, :, 0])
        + (c[:, :, 0] - b[:, :, 0]) * (yy - c[:, :, 1])
    ) / det
    wb = (
        (c[:, :, 1] - a[:, :, 1]) * (xx - c[:, :, 0])
        + (a[:, :, 0] - c[:, :, 0]) * (yy - c[:, :, 1])
    ) / det
    wt = np.stack([wa, wb, 1 - wa - wb], -1)
    return np.einsum("...ij,...i->...j", h.xyz[h.idx[tri]], wt), ids > 0


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def encode(arr):
    buf = io.BytesIO()
    Image.fromarray(np.uint8(arr.clip(0, 255).round())).save(
        buf, "WEBP", quality=97, method=4
    )
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def mapxy(img, coords):
    return cv2.remap(
        img,
        np.float32(coords[:, :, 0]),
        np.float32(coords[:, :, 1]),
        cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )


outline = [
    10,
    338,
    297,
    332,
    284,
    251,
    389,
    356,
    454,
    323,
    361,
    288,
    397,
    365,
    379,
    378,
    400,
    377,
    152,
    148,
    176,
    149,
    150,
    136,
    172,
    58,
    132,
    93,
    234,
    127,
    162,
    21,
    54,
    103,
    67,
    109,
]
eyeR = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246]
eyeL = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466]
mouth = [
    78,
    95,
    88,
    178,
    87,
    14,
    317,
    402,
    318,
    324,
    308,
    415,
    310,
    311,
    312,
    13,
    82,
    81,
    80,
    191,
]
names = [
    (name, "native-m" if frame > 0 else "native-f") for name, frame in FRAMES.items()
]
dest = p
if __name__ == "__main__":
    data = {}
    for name, mode in names:
        hn = Head(editable(0.9 if mode == "native-m" else -0.9))
        hd = Head(donor(name + "-lod0" if (p / (name + "-lod0")).is_dir() else name))
        nr, nw, npix, nxyz, axes, cen = upright(hn, mode)
        dr, dw, dpix, dxyz, daxes, dcen = upright(hd, name)
        npos, valid = native_uv(hn)
        coords = (npos - cen) @ axes.T / 0.135
        pixel = np.stack(
            [(1 + coords[:, :, 0]) * 512 - 0.5, (1 - coords[:, :, 1]) * 512 - 0.5], -1
        )
        keep = np.array(
            [
                i
                for i in range(468)
                if i == 0 or np.min(np.linalg.norm(npix[:i] - npix[i], axis=1)) > 1.3
            ]
        )
        rbf = RBFInterpolator(
            npix[keep] / 1024,
            (dpix - npix)[keep],
            smoothing=0.000013,
            kernel="thin_plate_spline",
            neighbors=40,
        )
        side = 24
        hh, ww = pixel.shape[:2]
        yy, xx = np.mgrid[:129, :129]
        plane = np.stack([xx, yy], -1) * 8
        shift = rbf(plane.reshape(-1, 2) / 1024).reshape(129, 129, 2)
        dxy = pixel + mapxy(np.float32(shift), pixel / 8)
        skin = mapxy(dr, dxy).astype("f")
        cut = np.zeros(dr.shape[:2], np.uint8)
        cv2.fillPoly(cut, [np.round(dpix[outline]).astype("i")], 1)
        interior = distance_transform_edt(cut)
        yy, xx = np.mgrid[:1024, :1024]
        edge = smooth((interior - 7) / 58)
        for poly in [eyeR, eyeL, mouth]:
            validRegion = np.ones_like(cut)
            cv2.fillPoly(validRegion, [np.round(dpix[poly]).astype("i")], 0)
            edge *= smooth((distance_transform_edt(validRegion) - 1.5) / 5)
        width = np.linalg.norm(dpix[33] - dpix[263])
        brows = 0.5 * (dpix[70] + dpix[300])
        edge *= smooth((yy - (brows[1] - 0.52 * width)) / (0.16 * width))
        if name.startswith("HSR0027"):
            edge *= smooth((yy - brows[1] - 0.012 * width) / (0.11 * width))
        strength = mapxy(np.float32(edge), dxy) * valid
        swatches = []
        for ix in [123, 352]:
            cx, cy = np.int32(dpix[ix])
            swatches.extend(dr[cy - 8 : cy + 9, cx - 8 : cx + 9].reshape(-1, 3))
        base = np.median(swatches, axis=0)
        linear = lambda c: np.where(
            c / 255 <= 0.04045, c / 255 / 12.92, ((c / 255 + 0.055) / 1.055) ** 2.4
        )
        ratio = np.log((linear(skin) + 0.0005) / (linear(base) + 0.0005))
        fine = ratio @ np.array([0.25, 0.60, 0.15])
        bump = fine - cv2.GaussianBlur(fine, (0, 0), 2)
        albedo = 128 + 51 * ratio.clip(-2.45, 1.65) * strength[:, :, None]
        coords3 = mapxy(dw[:, :, :3], dxy)
        depth = np.float32(coords3 @ daxes[2])
        valid = (strength > 0.03).astype("f")
        broad = cv2.GaussianBlur(depth * valid, (0, 0), 7) / np.maximum(
            0.001, cv2.GaussianBlur(valid, (0, 0), 7)
        )
        height = np.clip((depth - broad) / 0.0044, -0.45, 0.45) * 240 + 35 * bump.clip(
            -0.5, 0.5
        )
        material = np.stack(
            [128 + height * strength, 128 + np.zeros_like(fine), 255 * strength], -1
        )
        key = name[:7]
        data[key] = dict(
            paint=encode(albedo),
            surface=encode(material),
            source=name,
            base=base.astype(int).tolist(),
        )
        print(name, base, flush=True)
        Image.fromarray(dr).save(p / (name + "-aligned.jpg"), quality=97)
        np.savez_compressed(
            p / (name + "-registration.npz"),
            native=npos,
            donor=mapxy(dw[:, :, :3], dxy),
            weight=strength,
            reference=nxyz,
            landmarks=dxyz,
            native_axes=axes,
            scan_axes=daxes,
            native_marks=npix,
            scan_marks=dpix,
            reference_origin=cen,
            scan_origin=dcen,
        )
    (dest / "captured-raw-skin.json").write_text(
        json.dumps(data, separators=(",", ":"))
    )
