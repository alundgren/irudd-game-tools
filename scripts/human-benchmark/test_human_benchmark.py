"""Run with python scripts/human-benchmark/test_human_benchmark.py (numpy, scipy, opencv-python)."""

import tempfile
import unittest
from pathlib import Path

import numpy as np

from hb_mesh import Surface, closest_on_triangles, read_glb, rigid_fit, sample_surface, write_glb
from hb_metrics import Body, compare, measurements, split_error
from hb_raster import rasterize, shade, view_basis, visible_faces


def sphere(radius=0.3, level=4, center=(0.0, 0.0, 0.0)):
    t = (1 + 5 ** 0.5) / 2
    v = np.array([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
                  [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]], dtype=float)
    f = np.array([[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2],
                  [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5],
                  [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]])
    for _ in range(level):
        v = v / np.linalg.norm(v, axis=1)[:, None]
        edges = {}
        points = list(v)

        def middle(a, b):
            key = (min(a, b), max(a, b))
            if key not in edges:
                edges[key] = len(points)
                points.append((v[a] + v[b]) / 2)
            return edges[key]

        f = np.array([tri for a, b, c in f for tri in (
            [a, middle(a, b), middle(c, a)], [b, middle(b, c), middle(a, b)],
            [c, middle(c, a), middle(b, c)], [middle(a, b), middle(b, c), middle(c, a)])])
        v = np.array(points)
    v = v / np.linalg.norm(v, axis=1)[:, None]
    return v * radius + np.array(center), f


def brute_distance(points, vertices, faces):
    best = np.full(len(points), np.inf)
    for a, b, c in vertices[faces]:
        q, _ = closest_on_triangles(points, *(np.broadcast_to(x, points.shape) for x in (a, b, c)))
        best = np.minimum(best, np.linalg.norm(q - points, axis=1))
    return best


class Distances(unittest.TestCase):
    def test_closest_point_matches_exhaustive_search_on_small_and_large_triangles(self):
        rng = np.random.default_rng(0)
        fine = sphere(0.3, 2)
        box = (np.array([[x, y, z] for x in (0, 1) for y in (0, 1) for z in (0, 1)], dtype=float) * [0.5, 1.8, 0.3],
               np.array([[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1],
                         [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]]))
        for vertices, faces in (fine, box):
            points = rng.uniform(-0.6, 2.0, (300, 3))
            d, q, face, bary = Surface(vertices, faces).closest(points)
            np.testing.assert_allclose(d, brute_distance(points, vertices, faces), atol=1e-9)
            np.testing.assert_allclose(np.einsum("ij,ijk->ik", bary, vertices[faces[face]]), q, atol=1e-9)

    def test_yaw_fit_recovers_a_known_turn(self):
        rng = np.random.default_rng(1)
        source = rng.normal(size=(200, 3))
        angle = 0.3
        turn = np.array([[np.cos(angle), 0, np.sin(angle)], [0, 1, 0], [-np.sin(angle), 0, np.cos(angle)]])
        rotation, translation = rigid_fit(source, source @ turn.T + [0.1, 0.2, -0.3], yaw_only=True)
        np.testing.assert_allclose(rotation, turn, atol=1e-9)
        np.testing.assert_allclose(translation, [0.1, 0.2, -0.3], atol=1e-9)


class Rendering(unittest.TestCase):
    def test_frontmost_triangle_reports_interpolation_in_model_coordinates(self):
        # Two nested triangles in a rectangular view. The nearer one is sloped.
        vertices = np.array([[-.8, -.5, -.2], [.8, -.5, -.2], [0, .5, -.2],
                             [-.3, -.2, .1], [.3, -.2, .3], [0, .4, .4]])
        faces = np.array([[0, 1, 2], [3, 4, 5]])
        ids, weights, depth = rasterize(vertices, faces, view_basis(0), np.zeros(3), 70, 160, 100)
        self.assertEqual(ids[40, 80], 1)
        self.assertEqual(ids[78, 80], 0)
        self.assertEqual(ids[0, 0], -1)
        self.assertTrue(np.isneginf(depth[0, 0]))
        self.assertTrue(np.all(weights[0, 0] == 0))
        on = ids >= 0
        y, x = np.where(on)
        points = np.einsum("ij,ijk->ik", weights[on], vertices[faces[ids[on]]])
        np.testing.assert_allclose(points[:, 0], (x + .5 - 80) / 70, atol=1e-6)
        np.testing.assert_allclose(points[:, 1], (50 - y - .5) / 70, atol=1e-6)
        np.testing.assert_allclose(points[:, 2], depth[on], atol=1e-6)

    def test_heatmap_preserves_colour_channels_and_depth(self):
        vertices = np.array([[-.4, -.4, -.2], [.4, -.4, -.2], [0, .4, -.2]])
        image, hit, depth = shade(vertices, np.array([[0, 1, 2]]), view_basis(0), np.zeros(3),
                                  80, 81, 81, vertex_colors=np.eye(3), supersample=1)
        self.assertTrue(hit[40, 40])
        self.assertAlmostEqual(depth[40, 40], -.2, places=5)
        self.assertFalse(hit[0, 0])
        self.assertTrue(np.isneginf(depth[0, 0]))
        rgb = image[40, 40]
        np.testing.assert_allclose(rgb / rgb.sum(), [.25, .25, .50], atol=.001)

    def test_silhouette_area_of_a_sphere(self):
        vertices, faces = sphere(0.3, 4)
        ids, _, depth = rasterize(vertices, faces, view_basis(40, 20), np.zeros(3), 500, 400, 400)
        self.assertAlmostEqual((ids >= 0).sum() / 500 ** 2, np.pi * 0.3 ** 2, delta=0.003)
        self.assertAlmostEqual(depth[200, 200], 0.3, delta=0.002)

    def test_enclosed_geometry_is_not_visible(self):
        outer, inner = sphere(0.3, 3), sphere(0.1, 2)
        vertices = np.concatenate([outer[0], inner[0]])
        faces = np.concatenate([outer[1], inner[1] + len(outer[0])])
        seen = visible_faces(vertices, faces)
        self.assertGreater(seen[:len(outer[1])].mean(), 0.98)
        self.assertEqual(seen[len(outer[1]):].sum(), 0)


class Metrics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        vertices, faces = sphere(0.3, 4)
        # An egg, so that yaw matters; labels split it into a top and a bottom half.
        cls.vertices = vertices * [1.0, 1.4, 0.7] + [0, 0.5, 0]
        cls.faces = faces
        labels = (cls.vertices[:, 1] > 0.5).astype(int)
        cls.target = Body(cls.vertices, faces, seed=1, samples=20000, vertex_region=labels,
                          region_names=["head", "torso"])

    def test_a_copy_scores_zero_and_an_inflated_copy_scores_its_offset(self):
        same, _ = compare(Body(self.vertices, self.faces, seed=2, samples=20000), self.target, local=False)
        self.assertLess(same["chamfer"], 0.01)
        normals = self.target.surface.vertex_normals
        fuller, detail = compare(Body(self.vertices + 0.005 * normals, self.faces, seed=2, samples=20000),
                                 self.target, local=False)
        self.assertAlmostEqual(fuller["chamfer"], 5.0, delta=0.25)
        self.assertAlmostEqual(fuller["meanSignedOffset"], 5.0, delta=0.25)
        self.assertEqual(fuller["fscore"]["10mm"], 1.0)
        self.assertLess(fuller["fscore"]["5mm"], 0.9)
        top = self.target.face_region == 1
        self.assertAlmostEqual(split_error(detail, self.target, top), 5.0, delta=0.4)

    def test_placement_is_forgiven_but_scale_is_not(self):
        angle = np.radians(5)
        turn = np.array([[np.cos(angle), 0, np.sin(angle)], [0, 1, 0], [-np.sin(angle), 0, np.cos(angle)]])
        moved, _ = compare(Body(self.vertices @ turn.T + [0.02, 0.01, -0.03], self.faces, seed=3, samples=20000),
                           self.target, local=False)
        self.assertLess(moved["chamfer"], 0.3)
        self.assertAlmostEqual(moved["alignment"]["yawDegrees"], -5.0, delta=0.3)
        scaled, _ = compare(Body(self.vertices * 1.05, self.faces, seed=3, samples=20000), self.target, local=False)
        self.assertGreater(scaled["chamfer"], 5.0)

    def test_local_residual_removes_a_displaced_part(self):
        shifted = self.vertices.copy()
        shifted[self.vertices[:, 1] > 0.62] += [0.0, 0.015, 0.0]  # lift the cap by 15 mm
        result, _ = compare(Body(shifted, self.faces, seed=4, samples=20000), self.target, aligned=False)
        self.assertGreater(result["regions"]["torso"]["chamfer"], 3 * result["regions"]["torso"]["local"]["chamfer"])

    def test_girth_of_an_upright_cylinder(self):
        n, radius, height = 96, 0.15, 1.8
        angle = np.linspace(0, 2 * np.pi, n, endpoint=False)
        levels = np.linspace(0, height, 61)
        ring = np.column_stack([radius * np.cos(angle), np.zeros(n), radius * np.sin(angle)])
        vertices = np.concatenate([ring + [0, y, 0] for y in levels])
        faces = []
        for r in range(len(levels) - 1):
            for i in range(n):
                a, b = r * n + i, r * n + (i + 1) % n
                faces += [[a, a + n, b], [b, a + n, b + n]]
        body = Body(vertices, np.array(faces), seed=5, samples=5000)
        values, _ = measurements(body, np.zeros(len(faces), dtype=bool))
        self.assertAlmostEqual(values["stature"], height, delta=1e-6)
        self.assertAlmostEqual(values["waistGirth"], 2 * np.pi * radius, delta=0.002)
        self.assertAlmostEqual(values["hipBreadth"], 2 * radius, delta=0.002)
        self.assertAlmostEqual(values["volumeLitres"], np.pi * radius ** 2 * height * 1000, delta=1.5)


class Files(unittest.TestCase):
    def test_glb_round_trip(self):
        vertices, faces = sphere(0.3, 2)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "ball.glb"
            write_glb(path, vertices, faces, extras={"license": "test"}, copyright_text="nobody")
            back_v, back_f, extras, asset = read_glb(path)
        np.testing.assert_allclose(back_v, vertices, atol=1e-6)
        np.testing.assert_array_equal(back_f, faces)
        self.assertEqual(extras["license"], "test")
        self.assertEqual(asset["copyright"], "nobody")

    def test_sampling_is_uniform_by_area(self):
        vertices, faces = sphere(0.3, 3)
        points, _, _ = sample_surface(vertices, faces, 40000, seed=0)
        self.assertAlmostEqual((points[:, 1] > 0).mean(), 0.5, delta=0.01)
        self.assertAlmostEqual((points[:, 1] > 0.15).mean(), 0.25, delta=0.01)


if __name__ == "__main__":
    unittest.main()
