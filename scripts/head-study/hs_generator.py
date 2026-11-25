"""Python handle on the editable human's head (character-view/human-surface.js, human-fit.js).

The generator stays a black box behind head-bridge.mjs. This module adds what a
head study needs on top: which vertices belong to the head, and named facial
regions defined once on the neutral head so every stage is scored on the same
surface patches.
"""

import base64

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np

import _paths  # noqa: F401
from hb_raster import visible_faces
from hb_generator import source_hash

BRIDGE = Path(__file__).with_name("head-bridge.mjs")
LIVE = Path(__file__).resolve().parents[2] / "character-view"

REGIONS = ("ears", "eyes", "nose", "mouth", "chin and jaw", "cheeks", "brow and forehead", "cranium", "neck")


def _array(text, kind):
    return np.frombuffer(base64.b64decode(text), kind)


def snapshot(folder):
    """Copy the generator's modules to `folder`, so one run measures one version while others edit it."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for path in sorted(LIVE.iterdir()):
        if path.suffix in (".js", ".json") and not path.name.endswith(".test.js"):
            shutil.copy2(path, folder / path.name)
    return folder


class Generator:
    def __init__(self, folder=LIVE):
        self.folder = Path(folder).resolve()
        self.process = subprocess.Popen(["node", str(BRIDGE), str(self.folder)],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        info = self._ask({"describe": True})
        self.axes = [a["name"] for a in info["axes"]]
        self.low = {a["name"]: a["min"] for a in info["axes"]}
        self.high = {a["name"]: a["max"] for a in info["axes"]}
        self.initial = {a["name"]: a["initial"] for a in info["axes"]}
        self.body_vertices = info["bodyVertices"]
        self.control_ids = np.array(info["controlIds"])
        self.eye_groups = [np.array(group) for group in info["eyeGroups"]]
        self.cage_faces = _array(info["cage"]["faces"], "<u4").reshape(-1, 3).astype(np.int64)
        self.cage_weight = _array(info["cage"]["headWeight"], "<f4").reshape(-1, 2).astype(float)
        self.smooth_faces = _array(info["smooth"]["faces"], "<u4").reshape(-1, 3).astype(np.int64)
        self.smooth_weight = _array(info["smooth"]["headWeight"], "<f4").reshape(-1, 2).astype(float)
        self.smooth_pigments = _array(info["smooth"]["pigments"], "u1").reshape(-1, 4)
        self.source_sha256 = source_hash(self.folder)
        self.evaluations = 0

    def _ask(self, request):
        self.process.stdin.write((json.dumps(request) + "\n").encode())
        self.process.stdin.flush()
        reply = json.loads(self.process.stdout.readline())
        if "error" in reply:
            raise ValueError(reply["error"])
        return reply

    def recipe(self, values):
        """Clip to the legal ranges and round as the editor stores recipes."""
        return {name: round(float(np.clip(v, self.low[name], self.high[name])), 4) for name, v in values.items()}

    def evaluate(self, recipes, fits=None, blink=0.0):
        """Cage vertices in metres, shape [count, vertices, 3]."""
        reply = self._ask({"evaluate": {"recipes": recipes, "fits": fits, "blink": blink}})
        self.evaluations += len(recipes)
        return _array(reply["positions"], "<f4").reshape(len(recipes), -1, 3).astype(np.float64)

    def smooth(self, recipe, fit=None, blink=0.0):
        """The subdivided surface the editor renders, [vertices, 3]."""
        reply = self._ask({"smooth": {"recipe": recipe, "fit": fit, "blink": blink}})
        return _array(reply["positions"], "<f4").reshape(-1, 3).astype(np.float64)

    def _reference(self, vertices, faces):
        return {"positions": base64.b64encode(np.asarray(vertices, "<f4").tobytes()).decode(),
                "indices": base64.b64encode(np.asarray(faces, "<u4").tobytes()).decode()}

    def refine(self, recipe, vertices, faces, fit=None, region="head"):
        """fitHumanReference: the editor's bounded control correction towards a reference."""
        return self._ask({"refine": {"human": recipe, "humanFit": fit, "region": region, **self._reference(vertices, faces)}})

    def measure(self, recipe, vertices, faces, region="head"):
        """optimizeHumanMeasurements: the editor's own recipe fit, for comparison."""
        return self._ask({"measure": {"human": recipe, "region": region, **self._reference(vertices, faces)}})

    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=10)


class HeadTopology:
    """Head membership and facial regions of the cage and of the rendered surface.

    Regions are simple geometric rules on the neutral head, measured in units of
    its eye-to-mouth distance. They are fixed vertex sets afterwards, so a region
    means the same skin whatever the recipe. `region-map.png` in the report shows
    what each rule selects.
    """

    def __init__(self, generator):
        g = generator
        cage = g.evaluate([{}])[0]
        smooth = g.smooth({})
        self.cage_head = g.cage_weight.sum(1)[: g.body_vertices] >= 0.5
        self.cage_head = np.concatenate([self.cage_head, np.zeros(len(cage) - g.body_vertices, dtype=bool)])
        self.smooth_head = g.smooth_weight.sum(1) >= 0.5
        closed_cage, closed_smooth = g.evaluate([{}], blink=1.0)[0], g.smooth({}, blink=1.0)
        self.cage_faces, self.cage_cut = self._outside(closed_cage, g.cage_faces, self.cage_head)
        self.smooth_faces, self.smooth_cut = self._outside(closed_smooth, g.smooth_faces, self.smooth_head)
        eyes = np.array([cage[group].mean(0) for group in g.eye_groups])
        lips = smooth[(g.smooth_pigments[:, 0] > 128) & self.smooth_head]
        self.landmarks = self._landmarks(smooth[self.smooth_head], eyes, lips)
        self.cage_region = self._label(cage, self.cage_head, g.cage_weight)
        self.smooth_region = self._label(smooth, self.smooth_head, g.smooth_weight)
        self.control_region = self.cage_region[g.control_ids]
        self.head_axes, self.axis_effect_mm = self._head_axes(g, cage)

    def _head_axes(self, generator, neutral):
        """Recipe axes that change the head's shape, found by trying each one.

        An axis counts when moving it half way to its upper limit moves some skin above
        the neck by more than 0.3 mm (99th percentile over vertices) after the best turn,
        shift and scale is taken out. Stature and leg length only scale the head and drop
        out, as do pose and trunk axes, so a head scan cannot be explained by the body.
        """
        ids = np.unique(self.cage_faces)
        ids = ids[self.cage_region[ids] != REGIONS.index("neck")]
        names = [name for name in generator.axes if name != "height"]
        trials = [{name: generator.initial[name] + 0.5 * (generator.high[name] - generator.initial[name])} for name in names]
        moved = generator.evaluate(trials)[:, ids]
        base = neutral[ids]
        effect = {}
        for name, surface in zip(names, moved):
            a, b = base - base.mean(0), surface - surface.mean(0)
            u, s, vt = np.linalg.svd(b.T @ a)
            d = np.sign(np.linalg.det(u @ vt))
            rotation, scale = u @ np.diag([1, 1, d]) @ vt, (s * [1, 1, d]).sum() / (a * a).sum()
            effect[name] = float(np.percentile(np.linalg.norm(b - scale * a @ rotation.T, axis=1), 99) * 1000)
        return tuple(name for name in names if effect[name] > 0.3), effect

    @staticmethod
    def _outside(vertices, faces, head):
        """Head faces seen from outside with the eyes closed, and the vertices on the neck cut.

        The mouth cavity and the eye sockets are inside and are left out. The open
        neck is covered with a temporary lid so no view looks up into the head.
        """
        inside = head[faces].all(1)
        cut = np.intersect1d(faces[inside], faces[~inside])
        lid_centre = len(vertices)
        ring = faces[~inside][np.isin(faces[~inside], cut).sum(1) == 2]
        lid = np.array([[*row[np.isin(row, cut)], lid_centre] for row in ring])
        shell = np.concatenate([faces[inside], lid])
        points = np.vstack([vertices, vertices[cut].mean(0)])
        used, compact = np.unique(shell, return_inverse=True)  # only the head, so the views frame it tightly
        seen = visible_faces(points[used], compact.reshape(-1, 3), pixels_per_metre=1800.0)
        seen = seen[: inside.sum()]
        on_skin = np.zeros(len(vertices), dtype=bool)
        on_skin[faces[inside][seen]] = True
        # A hidden face between visible corners is only too small to win a pixel.
        outside = faces[inside][seen | on_skin[faces[inside]].all(1)]
        # Slivers of the mouth lining seen between the lips are not skin: keep the one connected skin.
        group = np.arange(len(vertices))
        for _ in range(64):
            lowest = group[outside].min(1)
            before = group.copy()
            np.minimum.at(group, outside.reshape(-1), np.repeat(lowest, 3))
            group = group[group]
            if (group == before).all():
                break
        label = group[outside[:, 0]]
        names, counts = np.unique(label, return_counts=True)
        return outside[label == names[counts.argmax()]], cut

    @staticmethod
    def _landmarks(head, eyes, lips):
        eye = eyes.mean(0)
        mouth = lips.mean(0)
        unit = eye[1] - mouth[1]
        middle = head[np.abs(head[:, 0]) < 0.004]
        nose_band = middle[(middle[:, 1] > mouth[1]) & (middle[:, 1] < eye[1])]
        nose_tip = nose_band[np.argmax(nose_band[:, 2])]
        side = head[np.abs(head[:, 0]) > 0.93 * np.abs(head[:, 0]).max()]
        ear = np.array([np.abs(side[:, 0]).mean(), side[:, 1].mean(), side[:, 2].mean()])
        return {"eye": eye, "eye_half_spacing": float(np.abs(eyes[:, 0]).mean()), "mouth": mouth, "unit": float(unit),
                "nose_tip": nose_tip, "ear": ear}

    def _label(self, points, head, weight):
        m, u = self.landmarks, self.landmarks["unit"]
        x, y, z = np.abs(points[:, 0]), points[:, 1], points[:, 2]
        region = np.full(len(points), -1)

        def claim(name, mask):
            region[(region < 0) & head & mask] = REGIONS.index(name)

        claim("neck", weight[: len(points), 1] > weight[: len(points), 0])
        ear = np.linalg.norm(np.column_stack([x, y, z]) - m["ear"], axis=1)
        claim("ears", (ear < 0.56 * u) & (x > m["ear"][0] - 0.30 * u))
        eye = np.linalg.norm(np.column_stack([x - m["eye_half_spacing"], y - m["eye"][1], z - m["eye"][2]]), axis=1)
        claim("eyes", eye < 0.40 * u)
        front = z > m["ear"][2] + 0.45 * u
        subnasal = m["nose_tip"][1] - 0.16 * u
        claim("nose", front & (x < 0.34 * u) & (y > subnasal) & (y < m["eye"][1] + 0.12 * u)
              & (z > m["nose_tip"][2] - 0.62 * u))
        claim("mouth", front & (x < 0.50 * u) & (y <= subnasal) & (y > m["mouth"][1] - 0.30 * u))
        claim("chin and jaw", (z > m["ear"][2] - 0.15 * u) & (y <= m["mouth"][1] - 0.10 * u))
        claim("cheeks", (z > m["ear"][2]) & (y < m["eye"][1] - 0.05 * u))
        claim("brow and forehead", front & (y < m["eye"][1] + 1.25 * u))
        claim("cranium", np.ones(len(points), dtype=bool))
        return region
