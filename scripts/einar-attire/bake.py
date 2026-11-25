"""Join one garment group in rest pose, repack its UVs and bake the authored materials.
blender -b einar.blend --disable-autoexec -P bake.py -- GROUP OUTDIR TEXTURES [SIZE]"""
import bpy, sys, math
import numpy as np
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import stage
args = sys.argv[sys.argv.index('--')+1:]
group, out, tex = args[0], Path(args[1]), Path(args[2]); size = int(args[3]) if len(args) > 3 else 2048
by = {f.name: f for f in tex.rglob('*.tif')}
for i in bpy.data.images:
    src = by.get(bpy.path.basename(i.filepath.replace(chr(92), '/')))
    if src: i.filepath = str(src); i.reload()
# piece: (subsurf level, decimate ratio, smart uv)
SPEC = {
    'jacket_main': (1, .5, False), 'jacket_collar1': (1, .6, False), 'jacket_collar2': (1, .5, False),
    'jacket_pocket1': (1, .35, False), 'jacket_pocket2': (1, .4, False), 'jacket_belts': (1, .3, False),
    'jacket_backstrap': (0, 1, False), 'jacket_strap_shoulder': (0, 1, False), 'jacket_loop': (0, 1, True),
    'jacket_loop_connection': (0, 1, False), 'jacket_tape': (1, .22, False), 'jacket_zipper': (0, .3, True),
    'jacket_zipper_connection': (0, 1, False), 'sweater': (1, 1, False),
    'pants_main': (1, .5, False), 'pants_pockets': (1, .3, False), 'pants_belt': (0, 1, False),
    'pants_belt_buckle': (0, 1, True), 'pants_belt_straps': (0, 1, False), 'pants_tape': (0, .6, False),
    'pants_carabiner': (0, 1, True), 'pants_loop_connection': (0, 1, False),
    'boot_main.L': (1, .6, False), 'boot_main.R': (1, .6, False), 'boot_sole.L': (0, .25, False), 'boot_sole.R': (0, .25, False),
}
member = {'jacket': lambda n: n.startswith('jacket_') or n == 'sweater', 'pants': lambda n: n.startswith('pants_'), 'boots': lambda n: n.startswith('boot_')}[group]
scene, objs = stage.stage(subsurf=0)
names = sorted(n for n in objs if member(n))
parts = []
for k, name in enumerate(names):
    o = objs[name]
    level, ratio, smart = SPEC.get(name, (0, .6, True) if 'button' in name else (0, 1, False))
    for m in list(o.modifiers):
        if m.type == 'SUBSURF': o.modifiers.remove(m)
    if level:
        s = o.modifiers.new('Sub', 'SUBSURF'); s.levels = s.render_levels = level
    if ratio < 1:
        d = o.modifiers.new('Dec', 'DECIMATE'); d.ratio = ratio
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    c = bpy.data.objects.new('B-' + name, me); scene.collection.objects.link(c); c.matrix_world = o.matrix_world.copy()
    for g in o.vertex_groups:
        if g.name not in c.vertex_groups: c.vertex_groups.new(name=g.name)
    if c.matrix_world.determinant() < 0:
        me.transform(c.matrix_world); c.matrix_world.identity(); me.flip_normals()
    a = me.attributes.new('piece', 'INT', 'FACE'); a.data.foreach_set('value', [k] * len(me.polygons))
    if name == 'sweater':
        # Only the knitted neck shows inside the coat. The hidden body of the sweater is left out.
        import bmesh
        bm = bmesh.new(); bm.from_mesh(me); W = c.matrix_world
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if (W @ f.calc_center_median()).z < 1.30], context='FACES'); bm.to_mesh(me); bm.free()
    bake = me.uv_layers.new(name='Bake')
    src = me.uv_layers['UVMap']
    buf = np.zeros(len(me.loops) * 2); src.data.foreach_get('uv', buf); bake.data.foreach_set('uv', buf)
    me.uv_layers.active = bake
    if smart:
        for x in scene.objects: x.select_set(x == c)
        bpy.context.view_layer.objects.active = c
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.02)
        bpy.ops.object.mode_set(mode='OBJECT')
    parts.append(c)
    scene.collection.objects.unlink(o)
    print('PIECE', k, name, len(me.vertices), len(me.polygons), [g.name for g in c.vertex_groups if g.name.startswith('DEF-')][:4], flush=True)
for o in scene.objects: o.select_set(o in parts)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
J = parts[0]; me = J.data
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me.uv_layers.active = me.uv_layers['Bake']
# Materials read their UV maps by name, so the render map stays the authored one.
me.uv_layers['UVMap'].active_render = True
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.select_all(action='SELECT')
bpy.ops.uv.average_islands_scale(); bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
bpy.ops.mesh.quads_convert_to_tris()
bpy.ops.object.mode_set(mode='OBJECT')
print('JOINED', len(me.vertices), len(me.polygons), [s.material.name for s in J.material_slots], flush=True)
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
for t in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
    try:
        prefs.compute_device_type = t; prefs.get_devices()
        if any(d.type == t for d in prefs.devices):
            for d in prefs.devices: d.use = d.type == t
            scene.cycles.device = 'GPU'; print('GPU', t); break
    except Exception: pass
w = bpy.data.worlds.new('w'); scene.world = w
mats = [s.material for s in J.material_slots if s.material]
b = scene.render.bake
def run(kind, btype, samples, colour=True, **kw):
    img = bpy.data.images.new(group + '-' + kind, size, size, alpha=False)
    if not colour: img.colorspace_settings.name = 'Non-Color'
    nodes = []
    for m in mats:
        n = m.node_tree.nodes.new('ShaderNodeTexImage'); n.image = img
        for x in m.node_tree.nodes: x.select = False
        n.select = True; m.node_tree.nodes.active = n; nodes.append((m, n))
    scene.cycles.samples = samples
    b.use_pass_direct = b.use_pass_indirect = False; b.use_pass_color = True
    bpy.ops.object.bake(type=btype, margin=16, use_clear=True, **kw)
    img.filepath_raw = str(out / (group + '-' + kind + '.png')); img.file_format = 'PNG'; img.save()
    for m, n in nodes: m.node_tree.nodes.remove(n)
    print('BAKED', kind, flush=True)
run('diffuse', 'DIFFUSE', 4, pass_filter={'COLOR'})
run('glossy', 'GLOSSY', 4, pass_filter={'COLOR'})
run('rough', 'ROUGHNESS', 2, colour=False)
run('normal', 'NORMAL', 4, colour=False)
run('ao', 'AO', 48, colour=False)
me.calc_loop_triangles()
n = len(me.vertices)
p = np.zeros(n * 3); me.vertices.foreach_get('co', p); p = p.reshape(-1, 3)
conv = lambda a: np.stack([a[:, 0], a[:, 2], -a[:, 1]], 1)
t = len(me.loop_triangles)
tri = np.zeros(t * 3, np.int32); me.loop_triangles.foreach_get('vertices', tri); tri = tri.reshape(-1, 3)
loops = np.zeros(t * 3, np.int32); me.loop_triangles.foreach_get('loops', loops); loops = loops.reshape(-1, 3)
poly = np.zeros(t, np.int32); me.loop_triangles.foreach_get('polygon_index', poly)
mat = np.zeros(t, np.int32); me.loop_triangles.foreach_get('material_index', mat)
piece = np.zeros(len(me.polygons), np.int32); me.attributes['piece'].data.foreach_get('value', piece)
uv = np.zeros(len(me.loops) * 2); me.uv_layers['Bake'].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)[loops]
data = dict(p=conv(p).astype(np.float32), tri=tri, uv=uv.astype(np.float32), mat=mat, piece=piece[poly],
            mats=np.array([m.name for m in mats]), pieces=np.array(names))
for g in J.vertex_groups:
    if not g.name.startswith('DEF-'): continue
    wv = np.zeros(n, np.float32)
    for v in me.vertices:
        for e in v.groups:
            if e.group == g.index: wv[v.index] = e.weight
    if wv.max() > 0: data['w|' + g.name] = wv
np.savez_compressed(out / (group + '.npz'), **data)
print('SAVED', group, n, t, flush=True)
