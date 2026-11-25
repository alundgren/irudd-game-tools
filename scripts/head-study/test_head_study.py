"""Checks of the head study's geometry code on shapes with known answers.

Run: python scripts/head-study/test_head_study.py
No scan and no generator is needed.
"""

import unittest

import numpy as np

import hs_targets
from hs_fit import Placement, similarity
from hs_metrics import _densify, folds, section
from identity_grid import normalized, shared_crops, distance, relative_identity


def hemisphere(radius, rings=24, sectors=48, flip=False):
    """Upper half of a sphere as an open triangle mesh, pole included."""
    theta = np.linspace(0, np.pi / 2, rings + 1)[1:]
    phi = np.linspace(0, 2 * np.pi, sectors, endpoint=False)
    ring = np.stack([np.outer(np.sin(theta), np.cos(phi)), np.outer(np.cos(theta), np.ones(sectors)),
                     np.outer(np.sin(theta), np.sin(phi))], axis=2).reshape(-1, 3)
    vertices = np.vstack([[0, 1, 0], ring]) * radius
    faces = [[0, 1 + (j + 1) % sectors, 1 + j] for j in range(sectors)]
    for i in range(rings - 1):
        for j in range(sectors):
            a, b = 1 + i * sectors + j, 1 + i * sectors + (j + 1) % sectors
            faces += [[a, b, a + sectors], [b, b + sectors, a + sectors]]
    faces = np.array(faces)
    return vertices, faces[:, ::-1] if flip else faces


def cup(outer=0.10, inner=0.085, rings=24, sectors=48):
    """A hollow half sphere like a life mask: outer face, inner face and a flat rim."""
    vo, fo = hemisphere(outer, rings, sectors)
    vi, fi = hemisphere(inner, rings, sectors, flip=True)
    last = 1 + (rings - 1) * sectors
    rim = []
    for j in range(sectors):
        a, b = last + j, last + (j + 1) % sectors
        rim += [[a, a + len(vo), b], [b, a + len(vo), b + len(vo)]]
    faces = np.vstack([fo, fi + len(vo), np.array(rim)])
    return np.vstack([vo, vi]), faces, len(fo), len(fi)


class Geometry(unittest.TestCase):
    def test_identity_grid_removes_global_pose_and_preserves_relative_relief(self):
        marks = np.array([[-.04, .04, .01],[.04, .04, .01],[0, -.05, .022]])
        points = np.array([[.01, .01, .028],[-.03, .02, .015],[0, 0, .04]])
        turn = np.array([[0, 0, 1],[0, 1, 0],[-1, 0, 0]])
        place = lambda v: 1.7*v @ turn + np.array([3,-2,4])
        np.testing.assert_allclose(normalized(points, marks),normalized(place(points),place(marks)),atol=1e-12)
        image = np.zeros((210,192))
        a = [image.copy() for _ in range(3)]
        b = [im+.02 for im in a]
        c = [im.copy() for im in b]
        for im in c: im[80:120,80:115] += .008
        masks, covered = shared_crops([a,b,c])
        self.assertEqual(covered,[1,1,1])
        self.assertAlmostEqual(distance(a,b,masks),0)
        self.assertGreater(distance(a,c,masks),.4)

    def test_relative_identity_separates_template_bias_from_lost_shape(self):
        bump = np.array([[.003, 0, 0], [0, -.002, 0]])
        bias = np.array([[-.004, .005, 0], [.003, -.005, 0]])
        mask = [np.ones_like(bump, dtype=bool)]
        truth = [[-bump], [bump]]
        def score(fitted):
            return relative_identity(fitted, truth, mask, ["a", "b"])
        scaled = score([[bias-.5*bump], [bias+.5*bump]])
        self.assertEqual(scaled["medianCosine"], 1)
        self.assertEqual(scaled["medianAmplitudeRatio"], .5)
        self.assertEqual(score(list(reversed(truth)))["medianCosine"], -1)
        same = score([[bias], [bias]])
        self.assertIsNone(same["medianCosine"])
        self.assertEqual(same["medianAmplitudeRatio"], 0)

    def test_similarity_recovers_a_known_placement(self):
        rng = np.random.default_rng(1)
        points = rng.normal(size=(200, 3))
        angle = 0.7
        rotation = np.array([[np.cos(angle), 0, np.sin(angle)], [0, 1, 0], [-np.sin(angle), 0, np.cos(angle)]])
        truth = Placement(1.3, rotation, [0.2, -0.1, 0.05])
        found = similarity(points, truth.apply(points), np.ones(len(points)))
        self.assertAlmostEqual(found.scale, 1.3, places=9)
        np.testing.assert_allclose(found.rotation, rotation, atol=1e-9)
        np.testing.assert_allclose(found.inverse(truth.apply(points)), points, atol=1e-9)

    def test_weld_merges_split_vertices(self):
        vertices = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]], dtype=float)
        welded, faces = hs_targets.weld(vertices, np.array([[0, 1, 2], [3, 5, 4]]))
        self.assertEqual(len(welded), 4)
        self.assertEqual(len(hs_targets.boundary_vertices(faces)), 4)

    def test_section_of_a_sphere_is_a_circle(self):
        vertices, faces = hemisphere(0.1, rings=48, sectors=96)
        points = _densify(section(vertices, faces, axis=0, value=0.0))
        np.testing.assert_allclose(points[:, 0], 0, atol=1e-12)
        np.testing.assert_allclose(np.linalg.norm(points, axis=1), 0.1, atol=2e-4)
        self.assertGreater(points[:, 1].max(), 0.0999)

    def test_folds_counts_a_turned_triangle(self):
        vertices = np.array([[0, 0, 0], [0.01, 0, 0], [0, 0.01, 0], [0.01, 0.01, 0]])
        faces = np.array([[0, 1, 2], [1, 3, 2]])
        moved = vertices.copy()
        moved[3] = [-0.005, -0.005, 0]  # pulled through the opposite edge
        self.assertEqual(folds(faces, vertices, vertices), {"triangles": 2, "past_perpendicular": 0})
        self.assertEqual(folds(faces, vertices, moved), {"triangles": 2, "past_perpendicular": 1})

    def test_a_hollow_cast_keeps_only_its_outer_face(self):
        vertices, faces, outer, inner = cup()
        open_faces, share = hs_targets.drop_flat_cut(vertices, faces)
        self.assertEqual(len(faces) - len(open_faces), len(faces) - outer - inner)  # exactly the rim
        seen = hs_targets.outside_faces(vertices, open_faces)
        self.assertGreater(seen[:outer].mean(), 0.99)
        self.assertLess(seen[outer:].mean(), 0.01)

    def test_a_closed_mouth_cavity_is_not_outside(self):
        vo, fo = hemisphere(0.10)           # open bust: the lid over its cut must hide what is inside
        vi, fi = hemisphere(0.03)           # a pocket floating inside it
        vertices, faces = np.vstack([vo, vi + [0, 0.02, 0]]), np.vstack([fo, fi + len(vo)])
        seen = hs_targets.outside_faces(vertices, faces)
        self.assertGreater(seen[: len(fo)].mean(), 0.99)
        self.assertEqual(seen[len(fo):].sum(), 0)


if __name__ == "__main__":
    unittest.main()
