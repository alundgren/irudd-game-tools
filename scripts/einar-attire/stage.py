"""Shared: build a clean rest-pose staging scene of the Einar garments. Imported by other tools."""
import bpy, math
from mathutils import Matrix
GROUPS = {
    'jacket': lambda n: n.startswith('jacket_') and 'surfdef' not in n,
    'pants': lambda n: n.startswith('pants_'),
    'boots': lambda n: n.startswith('boot_'),
    'sweater': lambda n: n == 'sweater',
}
def world(o):
    m = o.matrix_basis.copy()
    if o.parent:
        if o.parent_type != 'OBJECT': raise RuntimeError(o.name + ' parent ' + o.parent_type)
        m = world(o.parent) @ o.matrix_parent_inverse @ m
    return m
def stage(subsurf=1, keep_shader_nodes=True):
    for arm in bpy.data.armatures: arm.pose_position = 'REST'
    scene = bpy.data.scenes.new('Stage')
    bpy.context.window.scene = scene
    out = {}
    for o in list(bpy.data.objects):
        if o.type != 'MESH' or not o.name.startswith('GEO-einar_'): continue
        name = o.name.removeprefix('GEO-einar_')
        group = next((g for g, f in GROUPS.items() if f(name)), None)
        if not group: continue
        me = o.data.copy()
        c = bpy.data.objects.new('S-' + name, me)
        scene.collection.objects.link(c)
        c.matrix_world = world(o)
        if me.shape_keys:
            # Pose correctives rest at zero. Authored clipping fixes are permanently on.
            kb = me.shape_keys.key_blocks
            co = [v.co.copy() for v in kb[0].data]
            for k in kb[1:]:
                if 'lipping' in k.name:
                    for i, v in enumerate(k.data): co[i] += v.co - kb[0].data[i].co
            c.shape_key_clear()
            for i, v in enumerate(me.vertices): v.co = co[i]
        if keep_shader_nodes:
            for m in o.modifiers:
                if m.type == 'NODES' and m.name.startswith('SH-') and m.node_group:
                    n = c.modifiers.new(m.name, 'NODES'); n.node_group = m.node_group
                    try:
                        for k in m.keys(): n[k] = m[k]
                    except Exception: pass
        if subsurf:
            s = c.modifiers.new('Sub', 'SUBSURF'); s.levels = s.render_levels = subsurf
        c['group'] = group
        out[name] = c
    bpy.context.view_layer.update()
    return scene, out
