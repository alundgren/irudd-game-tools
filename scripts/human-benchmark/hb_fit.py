"""Fit the editable human's recipe axes to a target surface.

The generator is a black box, so its Jacobian comes from central differences.
Each round pairs generator vertices with their closest target points and target
samples with their closest generator points, then solves a bounded, damped
least-squares step over every recipe axis plus a rigid placement (translation
and yaw). Rounds are accepted only if the robust two-way distance drops.

The fit may be shown only part of the target (`seen` faces); the rest is then
untouched by the fit and can be scored as unseen surface.
"""

import numpy as np
from scipy.optimize import lsq_linear

from hb_mesh import Surface, sample_surface
from hb_raster import visible_faces

HUBER_M = 0.02          # distances beyond 2 cm pull with constant force
POINT_TERM = 0.1        # weight of point-to-point next to point-to-plane
PRIOR = 5e-6            # pull of every axis towards its neutral value
REGION_WEIGHT = {"head": 2.0, "hands": 0.25, "feet": 0.5, "forearms": 0.7}
MACRO = ("height", "frame", "age", "weight", "muscle", "stance", "armForward", "elbowBend", "legSpread", "handTwist")
STARTS = ({"frame": -0.7}, {"frame": 0.7})


def yaw_matrix(angle):
    c, s = np.cos(angle), np.sin(angle)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


class TargetView:
    """What the fit is allowed to see of a target Body."""

    def __init__(self, body, seen_faces=None, samples=8000, seed=11):
        self.body = body
        self.seen = body.visible if seen_faces is None else (body.visible & seen_faces)
        self.surface = Surface(body.vertices, body.faces, self.seen)
        self.points, face, bary = sample_surface(body.vertices, body.faces, samples, seed, self.seen)
        self.normals = self.surface.smooth_normal(face, bary)
        if body.face_region is None:  # an unlabelled target: every part counts the same
            self.face_weight = np.ones(len(body.faces))
        else:
            weights = np.ones(len(body.region_names))
            for name, w in REGION_WEIGHT.items():
                weights[body.region_names.index(name)] = w
            self.face_weight = weights[body.face_region]
        self.point_weight = self.face_weight[face]
        # Vertices on the rim of the seen surface: pairs that land there are sliding off its edge.
        edges = np.sort(np.concatenate([body.faces[self.seen][:, [a, b]] for a, b in ((0, 1), (1, 2), (2, 0))]), axis=1)
        unique, count = np.unique(edges, axis=0, return_counts=True)
        self.rim = np.zeros(len(body.vertices), dtype=bool)
        self.rim[unique[count == 1].ravel()] = True


class CoarseFit:
    def __init__(self, generator, view, log=None):
        self.g = generator
        self.view = view
        self.log = log or (lambda *_: None)
        neutral = generator.evaluate([{}])[0]
        self.gen_visible = visible_faces(neutral, generator.faces)
        used = np.unique(generator.faces[self.gen_visible])
        self.gen_ids = used[::2]
        self.span = generator.high - generator.low

    # ---- pairing -----------------------------------------------------------
    def _pairs(self, vertices, placement):
        """Residual rows for the current surface: (direction, weights, ids/bary, normals, offsets)."""
        rot, shift = yaw_matrix(placement[3]), placement[:3]
        moved = vertices @ rot.T + shift
        view = self.view
        # Generator vertices to the seen target surface.
        a = moved[self.gen_ids]
        d_a, q_a, face_a, bary_a = view.surface.closest(a)
        n_a = view.surface.smooth_normal(face_a, bary_a)
        gen_surface = Surface(moved, self.g.faces, self.gen_visible)
        own = gen_surface.vertex_normals[self.gen_ids]
        on_rim = np.einsum("ij,ij->i", bary_a, view.rim[view.body.faces[face_a]].astype(float)) > 0.999
        ok_a = (np.einsum("ij,ij->i", own, n_a) > 0.2) & ~on_rim
        w_a = view.face_weight[face_a] * np.minimum(1.0, HUBER_M / np.maximum(d_a, 1e-9))
        # Seen target samples to the generator surface.
        d_b, q_b, face_b, bary_b = gen_surface.closest(view.points)
        n_b = gen_surface.smooth_normal(face_b, bary_b)
        ok_b = np.einsum("ij,ij->i", view.normals, n_b) > 0.2
        w_b = view.point_weight * np.minimum(1.0, HUBER_M / np.maximum(d_b, 1e-9))

        def huber(d):
            return np.where(d < HUBER_M, 0.5 * d ** 2, HUBER_M * (d - 0.5 * HUBER_M))

        # Pairs that fall off the rim say nothing about the fit; all others count, compatible or not.
        loss = ((view.face_weight[face_a] * huber(d_a))[~on_rim].sum() / max((~on_rim).sum(), 1)
                + (view.point_weight * huber(d_b)).mean())
        return {"loss": float(loss), "rot": rot,
                "a": (ok_a, w_a / max(ok_a.sum(), 1), n_a, a - q_a),
                "b": (ok_b, w_b / max(ok_b.sum(), 1), n_b, q_b - view.points, face_b, bary_b)}

    def _rows(self, pairs, vertices, jacobian):
        """Stack point-to-plane and point-to-point rows and their derivatives."""
        rot = pairs["rot"]
        ok, w, n, offset = pairs["a"]
        ids = self.gen_ids[ok]
        blocks = [(w[ok], n[ok], offset[ok], vertices[ids] @ rot.T, jacobian[:, ids])]
        ok, w, n, offset, face, bary = pairs["b"]
        corners = self.g.faces[face[ok]]
        local = np.einsum("pk,pkd->pd", bary[ok], vertices[corners])
        dlocal = np.einsum("pk,apkd->apd", bary[ok], jacobian[:, corners])
        blocks.append((w[ok], n[ok], offset[ok], local @ rot.T, dlocal))
        residual, design = [], []
        for w, n, offset, rotated, dpoint in blocks:
            dworld = dpoint @ rot.T                                       # axes
            dyaw = np.column_stack([rotated[:, 2], np.zeros(len(rotated)), -rotated[:, 0]])
            motion = np.concatenate([dworld, np.broadcast_to(np.eye(3)[:, None, :], (3, len(n), 3)), dyaw[None]])
            root = np.sqrt(w)
            residual.append(root * np.einsum("ij,ij->i", n, offset))
            design.append(root[None] * np.einsum("apd,pd->ap", motion, n))
            side = np.sqrt(w * POINT_TERM)
            residual.append((side[:, None] * offset).ravel())
            design.append((side[None, :, None] * motion).reshape(len(motion), -1))
        return np.concatenate(residual), np.concatenate(design, axis=1).T

    # ---- optimisation --------------------------------------------------------
    def _jacobian(self, u, active, step=0.04):
        recipes = []
        for k in active:
            for sign in (-1, 1):
                v = u.copy()
                v[k] = np.clip(v[k] + sign * step, 0, 1)
                recipes.append(self.g.recipe(self.g.low + v * self.span))
        surfaces = self.g.evaluate(recipes)
        jac = np.zeros((len(u), self.g.vertex_count, 3))
        for i, k in enumerate(active):
            lo, hi = max(u[k] - step, 0), min(u[k] + step, 1)
            jac[k] = (surfaces[2 * i + 1] - surfaces[2 * i]) / (hi - lo)
        return jac

    def _surface(self, u):
        return self.g.evaluate([self.g.recipe(self.g.low + u * self.span)])[0]

    def _descend(self, u, placement, active, rounds):
        neutral = (self.g.initial - self.g.low) / self.span
        vertices = self._surface(u)
        pairs = self._pairs(vertices, placement)
        damping, trace = 1e-4, [pairs["loss"]]
        for _ in range(rounds):
            jac = self._jacobian(u, active)
            residual, design = self._rows(pairs, vertices, jac[active])
            k = len(active)
            prior = np.zeros((k, k + 4))
            prior[np.arange(k), np.arange(k)] = np.sqrt(PRIOR)
            lower = np.concatenate([np.maximum(-u[active], -0.3), [-0.05, -0.05, -0.05, -0.1]])
            upper = np.concatenate([np.minimum(1 - u[active], 0.3), [0.05, 0.05, 0.05, 0.1]])
            improved = False
            while damping < 1e3:
                a = np.concatenate([design, prior, np.sqrt(damping * 1e-4) * np.eye(k + 4)])
                b = np.concatenate([-residual, -np.sqrt(PRIOR) * (u[active] - neutral[active]), np.zeros(k + 4)])
                step = lsq_linear(a, b, bounds=(lower - 1e-12, upper + 1e-12)).x
                trial_u = u.copy()
                trial_u[active] = np.clip(u[active] + step[:k], 0, 1)
                trial_p = placement + step[k:]
                trial_v = self._surface(trial_u)
                trial = self._pairs(trial_v, trial_p)
                if trial["loss"] < pairs["loss"]:
                    gain = 1 - trial["loss"] / pairs["loss"]
                    u, placement, vertices, pairs = trial_u, trial_p, trial_v, trial
                    damping = max(damping / 3, 1e-6)
                    improved = True
                    break
                damping *= 6
            trace.append(pairs["loss"])
            if not improved or gain < 2e-4:
                break
        return u, placement, trace

    def run(self, rounds=30):
        """Returns the best recipe over the starts, its placement and a log of each start."""
        macro = [i for i, n in enumerate(self.g.axes) if n in MACRO]
        everything = list(range(len(self.g.axes)))
        height = self.g.axes.index("height")
        attempts = []
        for start in STARTS:
            u = (self.g.initial - self.g.low) / self.span
            for name, value in start.items():
                i = self.g.axes.index(name)
                u[i] = (value - self.g.low[i]) / self.span[i]
            u[height] = np.clip((self.view.body.stature - self.g.low[height]) / self.span[height], 0, 1)
            placement = np.zeros(4)
            u, placement, first = self._descend(u, placement, macro, 8)
            u, placement, second = self._descend(u, placement, everything, rounds)
            attempts.append({"start": start, "u": u, "placement": placement, "loss": second[-1],
                             "trace": [round(x * 1e6, 3) for x in first + second]})
            self.log(f"  start {start}: loss {second[-1] * 1e6:.2f} after {len(first) + len(second) - 2} rounds")
        best = min(attempts, key=lambda a: a["loss"])
        recipe = self.g.recipe(self.g.low + best["u"] * self.span)
        return recipe, best["placement"], [
            {"start": a["start"], "lossMm2": round(a["loss"] * 1e6, 3), "trace": a["trace"]} for a in attempts]


def target_in_generator_frame(vertices, placement):
    """Undo the fit's rigid placement on the target instead of moving the generator."""
    return (np.asarray(vertices) - placement[:3]) @ yaw_matrix(placement[3])
