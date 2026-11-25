import unittest

import numpy as np

from surface_relief import depth_detail


class SurfaceReliefTest(unittest.TestCase):
    def test_known_depth_errors(self):
        y, x = np.indices((128, 128))
        wave = .0007 * np.sin(x/2.6) * np.cos(y/3.1)
        plain = .092 + .00012*x
        target = plain + wave
        candidates = [target+.01, plain, target+wave, target+.0004*y]
        candidates[-1][:20] = np.nan
        support, (offset, smooth, noisy, tilted) = depth_detail(target, candidates, x>=0, 1400)
        self.assertTrue(.5 < support["cropFraction"] < .8)
        self.assertLess(offset["reliefErrorP90Mm"], 1e-7)
        self.assertLess(offset["normalMeanDeg"], 1e-5)
        self.assertGreater(smooth["missingReliefP95Mm"], .15)
        self.assertLess(smooth["excessReliefP95Mm"], 1e-7)
        self.assertGreater(noisy["excessReliefP95Mm"], .15)
        self.assertLess(noisy["missingReliefP95Mm"], 1e-7)
        self.assertGreater(tilted["normalMeanDeg"], 10)
        self.assertLess(tilted["reliefErrorP90Mm"], 1e-7)


if __name__ == "__main__":
    unittest.main()
