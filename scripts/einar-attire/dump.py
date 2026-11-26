"""Dump staged pieces (evaluated at given subsurf) to npz for analysis: per piece p, n, tri, uv(per corner), mat, groups."""
import bpy, sys
import numpy as np
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import stage
out = Path(sys.argv[sys.argv.index('--')+1]); level = int(sys.argv[sys.argv.index('--')+2])
scene, objs = stage.stage(subsurf=level)
dg = bpy.context.evaluated_depsgraph_get()
data = {}
for name, o in objs.items():
    ev = o.evaluated_get(dg); me = ev.to_mesh(); me.calc_loop_triangles()
    n = len(me.vertices)
    p = np.zeros(n*3); me.vertices.foreach_get('co', p); p = p.reshape(-1,3)
    nor = np.zeros(n*3); me.vertices.foreach_get('normal', nor); nor = nor.reshape(-1,3)
    W = np.asarray(o.matrix_world); p = p @ W[:3,:3].T + W[:3,3]; nor = nor @ np.linalg.inv(W[:3,:3])
    flip = np.linalg.det(W[:3,:3]) < 0
    conv = lambda a: np.stack([a[:,0], a[:,2], -a[:,1]], 1)
    t = len(me.loop_triangles)
    tri = np.zeros(t*3, np.int32); me.loop_triangles.foreach_get('vertices', tri); tri = tri.reshape(-1,3)
    loops = np.zeros(t*3, np.int32); me.loop_triangles.foreach_get('loops', loops); loops = loops.reshape(-1,3)
    mat = np.zeros(t, np.int32); me.loop_triangles.foreach_get('material_index', mat)
    uvl = me.uv_layers['UVMap']; uv = np.zeros(len(me.loops)*2); uvl.data.foreach_get('uv', uv); uv = uv.reshape(-1,2)[loops]
    if flip: tri = tri[:, ::-1]; uv = uv[:, ::-1]
    data[name+'|p'] = conv(p).astype(np.float32); data[name+'|n'] = conv(nor).astype(np.float32)
    data[name+'|tri'] = tri; data[name+'|uv'] = uv.astype(np.float32); data[name+'|mat'] = mat
    data[name+'|mats'] = np.array([s.material.name if s.material else '' for s in o.material_slots])
    for g in o.vertex_groups:
        if g.name.startswith('DEF-'):
            w = np.zeros(n)
            for v in me.vertices:
                for e in v.groups:
                    if e.group == g.index: w[v.index] = e.weight
            if w.max() > 0: data[name+'|w|'+g.name] = w.astype(np.float32)
    print('DUMP', name, n, t, flip, flush=True)
    ev.to_mesh_clear()
np.savez_compressed(out, **data)
