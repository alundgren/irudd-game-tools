"""Rebuild the weathered field coat, trousers and boots from the official Blender Studio Einar v1 download.

python scripts/pack-human-einar-attire.py path/to/einar_release_v1.blend path/to/textures path/to/blender [--from fit]

Source: Einar Rig (CC-BY) Blender Foundation | studio.blender.org, CC BY 4.0, https://studio.blender.org/characters/einar/v1/
Requires NumPy, SciPy and Pillow, Node, and a Blender with Cycles. Works in .reference-cache/einar-attire, which
git ignores, and writes character-view/human-einar-attire-data.json. The steps are in scripts/einar-attire:
  bones.py, dump.py  the rest bones and the garment meshes in rest pose
  bake.py            each group joined, its UV islands repacked and the authored materials baked to maps
  body.mjs           the neutral adult
  fit.py             the missing sleeve mirrored, the cloth carried to our skeleton, clearance, binding to the skin
  pack.py            dye charts, maps and the credit, in the form human-library.js wears
`--from fit` keeps the bakes of an earlier run.
"""
import os, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "scripts" / "einar-attire"
WORK = ROOT / ".reference-cache" / "einar-attire"


def main():
    blend, textures, blender = sys.argv[1:4]
    refit_only = sys.argv[4:6] == ["--from", "fit"]
    for folder in ("bake", "fit"): (WORK / folder).mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "EINAR_WORK": str(WORK)}
    run = lambda *command, **more: subprocess.run([str(c) for c in command], check=True, cwd=ROOT, env=env, **more)
    in_blender = lambda script, *rest, **more: run(blender, "-b", blend, "--disable-autoexec", "-P", TOOLS / script, "--", *rest, **more)
    if not refit_only:
        with open(WORK / "bones.txt", "w") as out: in_blender("bones.py", stdout=out)
        in_blender("dump.py", WORK / "geo1.npz", 1)
        for group in ("jacket", "pants", "boots"): in_blender("bake.py", group, WORK / "bake", textures, 2048)
    run("node", TOOLS / "body.mjs", WORK / "body-rest.json")
    run(sys.executable, TOOLS / "fit.py")
    run(sys.executable, TOOLS / "pack.py", ROOT / "character-view" / "human-einar-attire-data.json")


if __name__ == "__main__":
    main()
