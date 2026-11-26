"""Blender background script. Pass the official MHR lod1.fbx and destination GLB after --."""
import sys
from pathlib import Path
import bpy

source, dest = map(Path, sys.argv[sys.argv.index("--") + 1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=str(source))
body = next(o for o in bpy.context.scene.objects if o.type == "MESH")
rig = body.find_armature()
if not rig or not body.vertex_groups:
    raise ValueError("Expected the release's weighted armature")
graph = bpy.context.evaluated_depsgraph_get()
def positions():
    mesh = body.evaluated_get(graph)
    return [mesh.matrix_world @ v.co for v in mesh.data.vertices]
rest = positions()
elbow = rig.pose.bones["l_lowarm"]
initial = elbow.matrix_basis.copy()
elbow.rotation_mode = "XYZ"
elbow.rotation_euler.x += 0.4
bpy.context.view_layer.update()
moved = max((a-b).length for a,b in zip(rest, positions()))
if moved < 0.01:
    raise ValueError("Elbow test did not move the mesh by 1 cm")
elbow.matrix_basis = initial
bpy.context.view_layer.update()
print(f"Reference check: {len(rest)} vertices, {len(rig.data.bones)} bones, elbow displacement {moved:.4f} m")
bpy.ops.export_scene.gltf(filepath=str(dest), export_format="GLB",
                          export_morph=False, export_animations=False,
                          export_skins=True, export_all_influences=True,
                          export_materials="NONE", export_texcoords=False,
                          export_extras=False)
