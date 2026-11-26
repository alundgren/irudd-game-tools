"""Run in background Blender with -- SOURCE_FOLDER OUTPUT_FOLDER."""

import bpy, sys, json, numpy as np
from pathlib import Path

source, output = map(Path, sys.argv[sys.argv.index("--") + 1 :])
output.mkdir(parents=True, exist_ok=True)
for fb in sorted(source.glob("*/*.fbx")):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(fb))
    obj = max(
        (o for o in bpy.context.scene.objects if o.type == "MESH"),
        key=lambda o: len(o.data.polygons),
    )
    m = obj.data
    m.calc_loop_triangles()
    mat = np.array(obj.matrix_world)
    xyz = np.array([list(v.co) for v in m.vertices])
    xyz = xyz @ mat[:3, :3].T + mat[:3, 3]
    xyz = xyz[:, [0, 2, 1]]
    xyz[:, 2] *= -1
    uv = np.array([list(x.uv) for x in m.uv_layers.active.data])
    uv[:, 1] = 1 - uv[:, 1]
    t = np.array([list(x.vertices) for x in m.loop_triangles])
    tc = np.array([list(x.loops) for x in m.loop_triangles])
    mi = np.array([x.material_index for x in m.loop_triangles])
    print(
        "CAST",
        fb.parent.name,
        obj.name,
        len(xyz),
        [(a.name, int((mi == i).sum())) for i, a in enumerate(m.materials)],
        xyz.min(0),
        xyz.max(0),
        flush=True,
    )
    if fb.stem in ("Male_Adult_05", "Female_Adult_12"):
        armature = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
        joints = {}
        for bone in armature.data.bones:
            x, y, z = armature.matrix_world @ bone.head_local
            joints[bone.name] = [x, z, -y]
        (output / (fb.stem + ".bones.json")).write_text(json.dumps(joints))
        arm_weights = np.zeros(len(m.vertices))
        for vertex in m.vertices:
            for group in vertex.groups:
                bone = obj.vertex_groups[group.group].name
                if any(part in bone for part in (" UpperArm", " Forearm", " Hand", " Finger")):
                    arm_weights[vertex.index] += group.weight
        np.save(output / (fb.stem + "-arm.npy"), arm_weights)
    np.savez_compressed(
        output / (fb.stem + ".npz"),
        xyz=xyz,
        tri=t,
        uv=uv[tc],
        mat=mi,
        names=np.array([a.name for a in m.materials]),
    )
