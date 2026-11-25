"""Makes the body benchmark's mesh and raster helpers importable. They are used unchanged."""

import sys
from pathlib import Path

_benchmark = str(Path(__file__).resolve().parents[1] / "human-benchmark")
if _benchmark not in sys.path:
    sys.path.append(_benchmark)  # after this folder, so run.py and report.py here win
