"""Rebuild editable facial displacements, complexion, and iris maps from HSRD-100.

From the repository root:
    python scripts/pack-human-captured-portraits.py CACHE SYSTEM_SKINS_ZIP OUTPUT
    python scripts/pack-human-captured-portraits.py CACHE SYSTEM_SKINS_ZIP OUTPUT --reuse-registration

CACHE holds face.task (MediaPipe Face Landmarker float16/v1) and the extracted
HSRD-100 OBJ and base-colour texture for each pose in captured-portraits/inputs.py.
Use CACHE/POSE for LOD1 and CACHE/POSE-lod0 for LOD0. SYSTEM_SKINS_ZIP is the
MakeHuman system asset archive used to locate the editable head's landmarks.
The cached-registration option resumes after the initial photo registration.

Python dependencies: mediapipe, moderngl, opencv-python, numpy, Pillow, scipy.
The registration renderer requires OpenGL 3.3. These are asset-build dependencies.
"""

import argparse
import os
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("cache", type=Path)
    parser.add_argument("system_skins_zip", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--reuse-registration", action="store_true")
    args = parser.parse_args()
    scripts = Path(__file__).resolve().parent
    directory = scripts / "captured-portraits"
    env = dict(
        os.environ,
        CAPTURED_PORTRAIT_CACHE=str(args.cache.resolve()),
        CAPTURED_SYSTEM_SKINS=str(args.system_skins_zip.resolve()),
    )
    os.environ.update(
        {k: env[k] for k in ("CAPTURED_PORTRAIT_CACHE", "CAPTURED_SYSTEM_SKINS")}
    )
    sys.path.insert(0, str(directory))
    from inputs import FRAMES

    def run(stage, *values):
        subprocess.run(
            [sys.executable, str(directory / stage), *values],
            cwd=scripts.parent,
            env=env,
            check=True,
        )

    if not args.reuse_registration:
        run("render.py", "native-m", "native-f", *FRAMES)
        run("register.py")
    run("pigment.py")
    run("geometry.py")
    run("lids.py")
    run("irises.py")
    run("pack.py", str(args.output.resolve()))


if __name__ == "__main__":
    main()
