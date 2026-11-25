"""Build the family's neutral template for deformation transfer from the source rig itself.

From the repository root:
    python scripts/family-transfer/build-neutral.py CACHE OUT.glb

CACHE holds the MHR v1.0.1 archive (see docs/local-references.md). The neutral
is the rig's mean identity (all 45 identity coefficients and every proportion
zero) turned to the same limb directions as the benchmark bodies. It is not an
average of the benchmark people, so no held-out subject leaks into it. The mesh
is local reference material: write it under .reference-cache/.
"""

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "human-benchmark"))
from hb_mesh import write_glb  # noqa: E402
from hb_mhr import RELEASE, Rig  # noqa: E402

COPYRIGHT = ("Derived from the Momentum Human Rig (MHR) v1.0.1, Copyright (c) Meta Platforms, Inc. "
             "and affiliates. Licensed under the Apache License 2.0. Modified: mean identity, posed, "
             "converted to metres and exported without rig, blend shapes or textures.")


def main():
    cache, out = Path(sys.argv[1]), Path(sys.argv[2])
    rig = Rig(cache)
    identity = [0.0] * 45
    pose, report = rig.solve_pose(identity)
    vertices, _ = rig.evaluate(identity, None, pose)
    out.parent.mkdir(parents=True, exist_ok=True)
    write_glb(out, vertices, rig.faces, copyright_text=COPYRIGHT, name="mhr-neutral",
              extras={"license": "Apache-2.0", "source": RELEASE, "group": "mean identity"})
    out.with_suffix(".json").write_text(json.dumps({
        "identity": "all 45 coefficients zero", "proportions": "all zero", "pose": pose, "poseCheck": report,
        "stature": round(float(np.ptp(vertices[:, 1])), 4), "vertices": len(vertices), "faces": len(rig.faces),
    }, indent=1) + "\n")
    print(out, len(vertices), "vertices", f"{np.ptp(vertices[:, 1]):.3f} m", report)


if __name__ == "__main__":
    main()
