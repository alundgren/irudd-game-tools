"""Read the Rain v3 head, eyes, brows, lashes and hair out of the Blender Studio rig file.

Run inside Blender, with scripts in the file disabled:
  blender -b --disable-autoexec rain_v3.2.blend --python scripts/studio-head-extract.py -- out.npz

Rain Rig (CC) Blender Foundation | studio.blender.org, CC BY 4.0,
https://studio.blender.org/characters/rain/v3/. The rig file and this script's output are third-party
material and stay in the ignored .reference-cache/ directory; scripts/pack-human-studio-head.py makes the
packed, credited data the editor reads.

Coordinates are written Y up and facing +Z, in metres. Each mesh is evaluated through the rig (armature,
lattice, mirror) without subdivision, at rest and in three poses of the artist's own face controls.
"""
import bpy, sys
import numpy as np

out = sys.argv[sys.argv.index("--") + 1]
rig = bpy.data.objects["RIG-rain"]
poses = {
    "Blink": {"ACT-Eyelid_Upper.L": (0, -0.04, 0), "ACT-Eyelid_Upper.R": (0, -0.04, 0)},
    "Smile": {"ACT-Lips_Corner.L": (0, 0.004, 0.011), "ACT-Lips_Corner.R": (0, 0.004, 0.011)},
    "BrowLift": {"MSTR-Eyebrow.L": (0, 0.012, 0), "MSTR-Eyebrow.R": (0, 0.012, 0)},
}
parts = {
    "head": "GEO-rain-head", "eyes": "GEO-rain-eyes", "brows": "GEO-rain-eyebrows", "lashes": "GEO-rain-eyelashes",
    "hair_main": "GEO-rain-hair_main", "hair_ponytail": "GEO-rain-hair_ponytail", "hair_strand": "GEO-rain-hair_strand",
    "hairband": "GEO-rain-hairband",
}
moving = ("head", "brows", "lashes")
colours = {"brows": "Rain", "lashes": "Col", "hairband": "Rain"}
turn = lambda a: np.stack([a[:, 0], a[:, 2], -a[:, 1]], 1)

def evaluated(name, full=False):
    ob = bpy.data.objects[name]
    bpy.context.view_layer.update()
    graph = bpy.context.evaluated_depsgraph_get()
    graph.update()
    ev = ob.evaluated_get(graph)
    me = ev.to_mesh()
    co = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    world = np.asarray(ev.matrix_world)
    co = turn(co.reshape(-1, 3) @ world[:3, :3].T + world[:3, 3])
    result = {"points": co.astype(np.float32)}
    if full:
        me.calc_loop_triangles()
        tri = np.zeros(len(me.loop_triangles) * 3, np.int32)
        me.loop_triangles.foreach_get("vertices", tri)
        loops = np.zeros(len(me.loop_triangles) * 3, np.int32)
        me.loop_triangles.foreach_get("loops", loops)
        uv = np.zeros(len(me.loops) * 2)
        me.uv_layers["UVMap"].data.foreach_get("uv", uv)
        result["tri"] = tri.reshape(-1, 3)
        result["uv"] = uv.reshape(-1, 2)[loops].reshape(-1, 3, 2).astype(np.float32)
        # Quads, for one level of the artist's subdivision.
        sizes = np.zeros(len(me.polygons), np.int32)
        me.polygons.foreach_get("loop_total", sizes)
        corners = np.zeros(len(me.loops), np.int32)
        me.loops.foreach_get("vertex_index", corners)
        result["faceSizes"] = sizes
        result["faceCorners"] = corners
        result["faceUV"] = uv.reshape(-1, 2).astype(np.float32)
    ev.to_mesh_clear()
    return result

def paint(name, layer):
    # The mirror modifier repeats the painted colour, so read it from the evaluated mesh.
    ob = bpy.data.objects[name]
    graph = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(graph)
    me = ev.to_mesh()
    attribute = me.color_attributes[layer]
    values = np.zeros(len(attribute.data) * 4)
    attribute.data.foreach_get("color", values)
    values = values.reshape(-1, 4)
    if attribute.domain == "CORNER":
        per = np.zeros((len(me.vertices), 4)); count = np.zeros(len(me.vertices))
        corners = np.zeros(len(me.loops), np.int32); me.loops.foreach_get("vertex_index", corners)
        np.add.at(per, corners, values); np.add.at(count, corners, 1)
        values = per / np.maximum(count, 1)[:, None]
    ev.to_mesh_clear()
    return values[:, :3].astype(np.float32)

def reset():
    for bones in poses.values():
        for bone in bones:
            rig.pose.bones[bone].location = (0, 0, 0)

reset()
data = {}
for key, name in parts.items():
    for field, value in evaluated(name, True).items():
        data[key + "/" + field] = value
    if key in colours:
        data[key + "/colour"] = paint(name, colours[key])
for pose, bones in poses.items():
    reset()
    for bone, place in bones.items():
        rig.pose.bones[bone].location = place
    for key in moving:
        data[key + "/" + pose] = evaluated(parts[key])["points"] - data[key + "/points"]
reset()

# Landmarks from the rig: where each face bone holds the skin, and the eye centres.
head = bpy.data.objects[parts["head"]]
groups = [g.name for g in head.vertex_groups]
rows = []
for v in head.data.vertices:
    for g in v.groups:
        if g.weight > 1e-4:
            rows.append((v.index, g.group, g.weight))
data["head/groupNames"] = np.array(groups)
data["head/groupWeights"] = np.array(rows, np.float32)
world = np.asarray(rig.matrix_world)
for side in "LR":
    bone = rig.pose.bones["DEF-Eye." + side]
    ends = np.array([list(bone.head), list(bone.tail)]) @ world[:3, :3].T + world[:3, 3]
    data["eye" + side] = turn(ends).astype(np.float32)
for bone in ("DEF-Head", "DEF-Neck", "DEF-Jaw"):
    b = rig.pose.bones[bone]
    data[bone] = turn(np.array([list(b.head), list(b.tail)]) @ world[:3, :3].T + world[:3, 3]).astype(np.float32)
eyes = bpy.data.objects[parts["eyes"]]
names = [g.name for g in eyes.vertex_groups]
side = np.zeros(len(eyes.data.vertices), np.int8)
for v in eyes.data.vertices:
    best = max(v.groups, key=lambda g: g.weight)
    side[v.index] = 1 if names[best.group].endswith(".L") else -1
data["eyes/side"] = side
np.savez_compressed(out, **data)
for key in sorted(data):
    print("OUT", key, data[key].shape, data[key].dtype)
