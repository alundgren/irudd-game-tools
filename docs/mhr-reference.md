# Momentum Human Rig reference

The comparison needs the reference rig, which is [local reference material](local-references.md) and is not in the repository. With it installed, build the workshop and open `dist/rig-study.html`, or choose **Forms → Compare the editable torso with a rigged 3D reference** in the running workshop. The reference, starting figure and fitted figure use the same camera, lighting and metre scale. The section slider draws their actual horizontal contours. The saved fit opens as an ordinary editor study.

## Source and reuse

[Meta's original MHR release v1.0.1](https://github.com/facebookresearch/MHR/releases/tag/v1.0.1) supplies the source FBX in `assets.zip`. Copyright belongs to its upstream contributors. The released assets include their own [Apache License 2.0](licenses/mhr-apache-2.0.txt).

The reference GLB, `examples/mhr-reference.glb`, is a modified conversion of `assets/lod1.fbx`. It retains the neutral mesh, skeleton and skin weights. The conversion omits the shape-key library, corrective model, materials and animations. Use the original release for the complete parametric rig. The measured radial corrections, `examples/mhr-fit.json`, were derived from that reference and fall under the same Apache license. Both files stay local. The repository's MIT license covers the workshop code.

The source contains 18,439 mesh vertices, 36,874 faces and 126 bones. Rotating the left elbow by 0.4 radians in the imported FBX moved a skin vertex by 43.8 mm. The reference GLB is saved in the rest pose.

## Reproduce the experiment

1. Run `pnpm install --frozen-lockfile`. Where the reference GLB is already installed, skip to step 3.
2. Run `node scripts/local-references.mjs --fetch`. It downloads the release archive to `.reference-cache/mhr/assets.zip` and verifies its SHA-256 (`e4f4f205cd87c0fa106577ba1de4fc763e4eb197c924461d2ef7e6944e9d6b94`). Extract `assets/lod1.fbx` and `assets/LICENSE.txt`. Run `blender -b --factory-startup --python-exit-code 1 --python scripts/export-mhr-reference.py -- path/to/lod1.fbx examples/mhr-reference.glb`.
3. From the repository root run `node scripts/fit-rig-surface.mjs` and `npm run build`. The fit samples the reference mesh and the workshop mesh on 32 horizontal sections. Four correction passes adjust the editor torso's radial offsets. Corrections fade at the ends and on the sides near the armpits, where a ray can strike the arm.
4. Open the comparison and inspect the [measured errors](media/mhr-surface-errors.json). Evaluation rays fall halfway between training heights and angles. The distance is measured along a horizontal ray from the common midline. Estimated surface normals use adjacent test samples. This measures a single torso in a single rest pose, from 0.852 to 1.441 m above the floor. Hip and shoulder transitions account for visible residuals. Face likeness, hand construction, legs and posed surface fidelity need separate tests.

## Other practice rigs

- [MakeHuman and MPFB](https://www.makehumancommunity.org/about/license.html) provide CC0 core graphical assets and poseable body variants. Individual community assets carry their own terms.
- [NAVER Anny](https://github.com/naver/anny) provides interpretable body variation using MakeHuman-derived assets. Its code is Apache-2.0, the bundled MPFB2 assets are CC0, and the optional noncommercial package has separate terms.
- [Microsoft Rocketbox](https://github.com/microsoft/Microsoft-Rocketbox) offers 115 rigged avatars under MIT. Their clothing and shared animations make them useful for wardrobe and motion checks.

The [six scan-image studies](body-scan-studies.html) remain available for evaluating recovery from images with unknown cameras.
