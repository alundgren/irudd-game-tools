"""Run with python scripts/test_body_fidelity.py."""

import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "fidelity", Path(__file__).with_name("body-fidelity.py")
)
fidelity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fidelity)


class SilhouetteChecks(unittest.TestCase):
    def test_interior_gap_survives_centering_and_affects_both_measures(self):
        full = [[[-0.12, 0.12]] for _ in range(fidelity.ROWS)]
        gapped = [[[-0.12, -0.03], [0.03, 0.12]] for _ in full]
        shifted = [[[a + 0.34, b + 0.34] for a, b in row] for row in gapped]
        self.assertAlmostEqual(fidelity.overlap(fidelity.center(shifted), gapped), 1.0)
        self.assertAlmostEqual(fidelity.overlap(full, gapped), 0.75)
        self.assertEqual(fidelity.boundary_distances(full, full)["p95Stature"], 0.0)
        self.assertGreater(
            fidelity.boundary_distances(full, gapped)["p95Stature"], 0.05
        )

    def test_fusing_an_arm_with_the_trunk_reduces_the_local_score(self):
        split = [
            [[-0.18, -0.15], [-0.11, 0.11], [0.15, 0.18]] for _ in range(fidelity.ROWS)
        ]
        fused = [[[-0.18, 0.18]] for _ in split]
        self.assertAlmostEqual(fidelity.arm_overlap(split, split), 1.0)
        self.assertLess(fidelity.arm_overlap(fused, split), 0.55)
        self.assertIsNone(fidelity.arm_overlap(fused, fused))

    def test_empty_input_is_an_error(self):
        with self.assertRaises(ValueError):
            fidelity.center([[] for _ in range(fidelity.ROWS)])


if __name__ == "__main__":
    unittest.main()
