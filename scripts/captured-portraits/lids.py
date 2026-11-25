import numpy as np, sys, json, base64, zlib

sys.path.insert(0, "scripts")
import rocketbox_face_surface as nat
from inputs import CACHE as p, FRAMES

out = {}
edge = lambda x: np.clip(x, 0, 1) ** 2 * (3 - 2 * np.clip(x, 0, 1))
for f in [p / (n + "-registration.npz") for n in FRAMES]:
    m = np.load(f)
    key = f.stem[:7]
    frame = FRAMES[f.stem.removesuffix("-registration")]
    verts = nat.evaluate(frame)
    shift = np.zeros_like(verts)
    landmarks = m["landmarks"][:468]
    orig = m["reference"][:468]
    idx = [
        i
        for i in [
            1,
            4,
            6,
            9,
            127,
            356,
            234,
            454,
            93,
            323,
            123,
            352,
            136,
            365,
            103,
            332,
            101,
            330,
        ]
        if np.linalg.norm(orig[i]) > 0.1 and np.linalg.norm(landmarks[i]) > 0.1
    ]
    scale = np.linalg.norm(orig[idx] - orig[idx].mean(0)) / np.linalg.norm(
        landmarks[idx] - landmarks[idx].mean(0)
    )
    for ids in [
        [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
        [
            263,
            249,
            390,
            373,
            374,
            380,
            381,
            382,
            362,
            398,
            384,
            385,
            386,
            387,
            388,
            466,
        ],
    ]:
        xy = lambda mat: mat[ids] * np.array([1, -1]) * 0.27 / 1024
        src = xy(m["native_marks"])
        target = xy(m["scan_marks"]) * scale
        center = (src[0] + src[8]) * 0.5
        target -= 0.5 * (target[0] + target[8])
        src -= center
        # Make the measured opening editable and prevent squints in the scan from shutting the eye.
        for k, limits in enumerate([(0.95, 1.19), (0.77, 1.13)]):
            ratio = np.ptp(target[:, k]) / np.ptp(src[:, k])
            target[:, k] *= np.clip(ratio, *limits) / ratio
        nativeX = (
            (m["native_marks"][ids[0], 0] + m["native_marks"][ids[8], 0]) * 0.5
            + 0.5
            - 512
        ) / 512 * 0.135 + m["reference_origin"][0]
        ring = next(
            v
            for v in [verts[6756:6784], verts[13352:13380]]
            if (v.mean(0)[0] > 0) == (nativeX > 0)
        )
        center3 = (ring.max(0) + ring.min(0)) * 0.5
        vec = verts - center3
        r = np.sqrt(
            (vec[:, 0] / 0.025) ** 2
            + (vec[:, 1] / 0.019) ** 2
            + (vec[:, 2] / 0.018) ** 2
        )
        sel = r < 1.25
        # A thin lid has inner and outer skin less than one millimetre apart. Fit the
        # opening as a continuous scale, tilt, and arch so both layers move together.
        span = np.maximum(np.ptp(src, axis=0), 0.001)
        ratio = np.clip(np.ptp(target, axis=0) / span, [0.95, 0.77], [1.19, 1.13])
        tilt = np.clip(
            (target[8, 1] - target[0, 1] - (src[8, 1] - src[0, 1]))
            / (src[8, 0] - src[0, 0]),
            -0.12,
            0.12,
        )
        xy = vec[sel, :2]
        arch = 1 - np.minimum(1, (xy[:, 0] / (0.5 * span[0])) ** 2)
        middle = np.clip((np.mean(target[:, 1]) - np.mean(src[:, 1])), -0.0008, 0.0008)
        disp = xy * (ratio - 1)
        disp[:, 1] += tilt * xy[:, 0] + middle * arch
        gain = edge((1.25 - r[sel]) / 0.57)
        shift[sel, :2] += 0.0035 * np.tanh(disp / 0.0035) * gain[:, None]
    for ids in nat.meta["eyeGroups"]:
        shift[ids] = 0
    use = np.flatnonzero(np.max(abs(shift), axis=1) > 0.00002)
    enc = lambda a: base64.b64encode(zlib.compress(a.tobytes(), 9)).decode()
    out["scan" + key[3:]] = dict(
        ids=enc(use.astype("<u2")),
        shift=enc(np.rint(shift[use] / 0.000002).astype("<i2")),
    )
    print(key, len(use), flush=True)
(p / "captured-lids.json").write_text(json.dumps(out, separators=(",", ":")))
