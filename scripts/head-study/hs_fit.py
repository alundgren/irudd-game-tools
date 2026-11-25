"""Place a head scan on the editable head and fit the head's recipe axes to it.

Three steps, each using only what the editor exposes:

1. `settle` finds the placement of the scan: a rotation, a translation and one
   scale. A scan has no stature and its head is posed freely on the neck, while
   the editable human has neither a head-size axis nor a head pose, so the scan
   moves and the recipe keeps its default height.
2. `fit_recipe` searches the head axes of the recipe. Each round pairs generated
   vertices with their closest scan points and scan samples with their closest
   generated points, solves a bounded least-squares step and re-settles the scan.
3. `correct` calls the editor's own `fitHumanReference` on the head region.
"""

import numpy as np
from scipy.optimize import lsq_linear
from scipy.spatial import cKDTree

import _paths  # noqa: F401
from hb_mesh import Surface, sample_surface, vertex_normals
from hs_generator import REGIONS
from hs_targets import boundary_vertices

HUBER_M = 0.004         # distances beyond 4 mm pull with constant force
REACH_M = 0.03          # pairs further apart than this are not pairs
POINT_TERM = 0.1        # weight of point-to-point next to point-to-plane
PRIOR = 0.02            # pull of every axis towards its neutral value, in mm^2 per unit^2
REGION_WEIGHT = {"ears": 0.5, "eyes": 0.6, "neck": 0.25}
STARTS = ({"frame": -0.6}, {"frame": 0.6})
# Narrower search ranges than the editor allows. randomHuman keeps earTip within 0.79 * 0.28
# for people; beyond that the ear becomes a pointed fantasy ear, which a fit would otherwise
# use to reach a tall human ear.
FIT_LIMIT = {"earTip": 0.22}


class Placement:
    """Scan to generator frame: scale * R @ p + t."""

    def __init__(self, scale=1.0, rotation=None, translation=None):
        self.scale = float(scale)
        self.rotation = np.eye(3) if rotation is None else np.asarray(rotation, dtype=float)
        self.translation = np.zeros(3) if translation is None else np.asarray(translation, dtype=float)

    def apply(self, points):
        return self.scale * points @ self.rotation.T + self.translation

    def inverse(self, points):
        return (points - self.translation) @ self.rotation / self.scale

    def turn(self, vectors):
        return vectors @ self.rotation.T

    def to_json(self):
        return {"scale": round(self.scale, 6), "rotation": np.round(self.rotation, 6).tolist(),
                "translation": np.round(self.translation, 6).tolist()}

    @classmethod
    def from_json(cls, data):
        return cls(data["scale"], data["rotation"], data["translation"])


def similarity(source, target, weights, with_scale=True):
    """Weighted least-squares Placement with apply(source) ~ target (Umeyama 1991)."""
    w = weights / weights.sum()
    cs, ct = w @ source, w @ target
    a, b = source - cs, target - ct
    u, s, vt = np.linalg.svd((b * w[:, None]).T @ a)
    d = np.sign(np.linalg.det(u @ vt))
    rotation = u @ np.diag([1, 1, d]) @ vt
    scale = (s * [1, 1, d]).sum() / (w @ (a * a).sum(1)) if with_scale else 1.0
    return Placement(scale, rotation, ct - scale * rotation @ cs)


def pitch(degrees):
    c, s = np.cos(np.radians(degrees)), np.sin(np.radians(degrees))
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


class ScanView:
    """What a fit sees of a scan: its surface in the scan's frame and fixed samples on it."""

    def __init__(self, vertices, faces, face_mask=None, samples=8000, seed=11):
        self.vertices, self.faces = np.asarray(vertices, dtype=float), np.asarray(faces)
        self.surface = Surface(self.vertices, self.faces, anchor_spacing=0.006)
        edge = np.zeros(len(self.vertices), dtype=bool)
        edge[boundary_vertices(self.faces)] = True
        self.open_face = edge[self.faces].any(1)  # touches the scan's open edge
        self.points, face, bary = sample_surface(self.vertices, self.faces, samples, seed, face_mask)
        self.normals = self.surface.smooth_normal(face, bary)


class Head:
    """The generated head for one recipe: outside cage surface, normals and region weights."""

    def __init__(self, topology, cage_vertices, region_weight):
        self.topology = topology
        self.vertices = cage_vertices
        self.faces = topology.cage_faces
        self.ids = np.unique(self.faces)
        self.surface = Surface(cage_vertices, self.faces, anchor_spacing=0.006)
        self.normals = vertex_normals(cage_vertices, self.faces)
        cut = np.zeros(len(cage_vertices), dtype=bool)
        cut[topology.cage_cut] = True
        self.cut_face = cut[self.faces].any(1)
        self.vertex_weight = region_weight[topology.cage_region]


def region_weights(not_skin=()):
    weight = np.array([REGION_WEIGHT.get(name, 1.0) for name in REGIONS] + [0.0])  # last entry: unlabelled
    for name in not_skin:
        weight[REGIONS.index(name)] = 0.0
    return weight


def pairs(head, view, placement, reach=REACH_M):
    """Closest-point pairs in both directions, in the generator frame.

    Returns two dicts (generated vertex -> scan, scan sample -> generated surface)
    with the moving point, its partner, the partner's normal, a validity mask and
    a region weight.
    """
    p = head.vertices[head.ids]
    d, c, face, bary = view.surface.closest(placement.inverse(p))
    normal = placement.turn(view.surface.smooth_normal(face, bary))
    # A generated vertex whose closest scan point is on the scan's open edge has no scan surface to answer to.
    weight = head.vertex_weight[head.ids] * ~view.open_face[face]
    ok = (weight > 0) & (d * placement.scale < reach) & (np.einsum("ij,ij->i", normal, head.normals[head.ids]) > 0.2)
    forward = {"moving": p, "partner": placement.apply(c), "scan": c, "normal": normal, "ok": ok, "weight": weight}

    s = placement.apply(view.points)
    d, g, face, bary = head.surface.closest(s)
    normal = head.surface.smooth_normal(face, bary)
    corner = head.faces[face]
    # Scan surface beyond the neck cut (shoulders, chest) is not the head's business.
    weight = np.einsum("ij,ij->i", bary, head.vertex_weight[corner]) * ~head.cut_face[face]
    ok = (weight > 0) & (d < reach) & (np.einsum("ij,ij->i", normal, placement.turn(view.normals)) > 0.2)
    backward = {"moving": g, "partner": s, "scan": view.points, "normal": normal, "ok": ok, "weight": weight,
                "corner": corner, "bary": bary}
    return forward, backward


def robust(distance):
    a = np.abs(distance)
    return np.where(a <= HUBER_M, 0.5 * a * a, HUBER_M * (a - 0.5 * HUBER_M))


def loss(forward, backward):
    """Robust two-way distance over every weighted point, paired or not, capped at the reach."""
    total = 0.0
    for side in (forward, backward):
        d = np.minimum(np.linalg.norm(side["partner"] - side["moving"], axis=1), REACH_M)
        total += 0.5 * (side["weight"] * robust(d)).sum() / max(side["weight"].sum(), 1e-12)
    return float(total)


def settle(head, view, placement, rounds=6, reach=REACH_M, with_scale=True):
    """Move the scan onto a fixed generated head (iterated closest points, both directions)."""
    for _ in range(rounds):
        forward, backward = pairs(head, view, placement, reach)
        source = np.vstack([forward["scan"][forward["ok"]], backward["scan"][backward["ok"]]])
        target = np.vstack([forward["moving"][forward["ok"]], backward["moving"][backward["ok"]]])
        # Each direction carries half the weight however many pairs it found.
        weight = np.concatenate([side["weight"][side["ok"]] / max(side["weight"][side["ok"]].sum(), 1e-12)
                                 for side in (forward, backward)])
        if (weight > 0).sum() < 50:
            break
        placement = similarity(source, target, weight, with_scale)
    return placement


def find_placement(head, view, scales, pitches):
    """Try several orientations and sizes of a raw scan and keep the best settled placement."""
    best = None
    top = head.vertices[head.ids]
    anchor = top[top[:, 1] > top[:, 1].max() - 0.20].mean(0)
    for scale in scales:
        for degrees in pitches:
            rotation = pitch(degrees)
            turned = scale * view.vertices @ rotation.T
            crown = turned[turned[:, 1] > turned[:, 1].max() - 0.20].mean(0)
            placement = Placement(scale, rotation, anchor - crown)
            for reach in (0.08, 0.05, REACH_M):
                placement = settle(head, view, placement, rounds=12, reach=reach)
            value = loss(*pairs(head, view, placement))
            if best is None or value < best[0]:
                best = (value, placement, scale, degrees)
    return best


def _vector(generator, axes, recipe):
    return np.array([recipe.get(name, generator.initial[name]) for name in axes], dtype=float)


def _recipe(generator, axes, base, values):
    return generator.recipe({**base, **dict(zip(axes, values))})


def _jacobian(generator, axes, base, x, ids, blink, step=0.05):
    low = np.array([max(generator.low[name], -FIT_LIMIT.get(name, np.inf)) for name in axes])
    high = np.array([min(generator.high[name], FIT_LIMIT.get(name, np.inf)) for name in axes])
    recipes, spans = [], []
    for k in range(len(x)):
        lo, hi = max(low[k], x[k] - step), min(high[k], x[k] + step)
        spans.append(hi - lo)
        for value in (lo, hi):
            trial = x.copy()
            trial[k] = value
            recipes.append(_recipe(generator, axes, base, trial))
    surfaces = generator.evaluate(recipes, blink=blink)[:, ids]
    columns = [(surfaces[2 * k + 1] - surfaces[2 * k]) / spans[k] for k in range(len(x))]
    return np.stack(columns, axis=2), low, high  # [vertex, xyz, axis]


def fit_recipe(generator, topology, view, placement, base=None, blink=1.0, not_skin=(), rounds=14, log=print):
    """Search the head axes from each start and keep the lower robust two-way distance."""
    weight = region_weights(not_skin)
    best = None
    for start in STARTS:
        result = _fit_from(generator, topology, view, placement, {**(base or {}), **start}, blink, weight, rounds, log)
        if best is None or result["loss"] < best["loss"]:
            best = result
    return best


def _fit_from(generator, topology, view, placement, start, blink, weight, rounds, log):
    axes = topology.head_axes
    x = _vector(generator, axes, start)
    base = {key: value for key, value in start.items() if key not in axes}

    def state(values, where):
        recipe = _recipe(generator, axes, base, values)
        head = Head(topology, generator.evaluate([recipe], blink=blink)[0], weight)
        where = settle(head, view, where, rounds=3)
        forward, backward = pairs(head, view, where)
        return recipe, head, where, forward, backward, loss(forward, backward)

    recipe, head, placement, forward, backward, value = state(x, placement)
    history = [value]
    row_of = np.full(len(head.vertices), -1)
    row_of[head.ids] = np.arange(len(head.ids))
    damping = 0.05
    for round_index in range(rounds):
        jac, low, high = _jacobian(generator, axes, base, x, head.ids, blink)
        rows, rhs = [], []
        for side, moving in ((forward, jac), (backward, None)):
            ok = side["ok"]
            if moving is None:  # a scan sample pulls the three cage vertices of its closest face
                moving = np.einsum("pk,pkda->pda", side["bary"], jac[row_of[side["corner"]]])
            residual = side["partner"] - side["moving"]
            w = side["weight"] * ok
            w = w / max(w.sum(), 1e-12)
            plane = np.einsum("pd,pd->p", side["normal"], residual)
            huber = np.minimum(1.0, HUBER_M / np.maximum(np.abs(plane), 1e-9))
            scale = 1000 * np.sqrt(w * huber)  # millimetres, so the prior and damping below have a fixed meaning
            rows.append(np.einsum("pd,pda->pa", side["normal"], moving) * scale[:, None])
            rhs.append(plane * scale)
            scale = 1000 * np.sqrt(w * huber * POINT_TERM)
            rows.append((moving * scale[:, None, None]).reshape(-1, len(x)))
            rhs.append((residual * scale[:, None]).reshape(-1))
        rows += [np.sqrt(PRIOR) * np.eye(len(x)), np.sqrt(damping) * np.eye(len(x))]
        rhs += [-np.sqrt(PRIOR) * x, np.zeros(len(x))]
        step = lsq_linear(np.vstack(rows), np.concatenate(rhs), bounds=(low - x - 1e-9, high - x + 1e-9)).x
        accepted = False
        for fraction in (1.0, 0.5, 0.25):
            trial = np.clip(x + fraction * step, low, high)
            candidate = state(trial, placement)
            if candidate[-1] < value * 0.9995:
                x = trial
                recipe, head, placement, forward, backward, value = candidate
                accepted = True
                break
        history.append(value)
        log(f"    round {round_index + 1}: loss {value * 1e6:.2f} {'accepted' if accepted else 'rejected'}")
        if not accepted:
            damping *= 10
            if damping > 500:
                break
    return {"recipe": recipe, "placement": placement, "loss": value, "history": history, "start": start}


def drop_controls(fit, topology, regions):
    """Remove the correction of controls in named regions (a plain edit of the stored fit)."""
    skip = {REGIONS.index(name) for name in regions}
    rows = [row for row in fit["controls"] if int(topology.control_region[row[0]]) not in skip]
    return {**fit, "controls": rows}


def correct(generator, topology, recipe, scan_vertices, scan_faces, passes=1, drop=("eyes",)):
    """Run the editor's fitHumanReference on the head. The scan must already be in the generator frame.

    fitHumanReference evaluates the open-eyed head and cannot be told to skip a
    patch, so controls in `drop` regions are removed from its answer after every pass.
    """
    fit, reports = None, []
    for _ in range(passes):
        answer = generator.refine(recipe, scan_vertices, scan_faces, fit, "head")
        fit = drop_controls(answer["fit"], topology, drop)
        reports.append({"metrics": answer["metrics"], "controls": len(fit["controls"])})
    return fit, reports


def near_faces(vertices, faces, points, distance):
    """Faces with a corner within `distance` of any of `points`."""
    d, _ = cKDTree(points).query(vertices, distance_upper_bound=distance)
    return np.isfinite(d)[faces].any(1)
