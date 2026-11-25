"""Print the meshes and the rest bones of the Einar rig: blender -b einar.blend --disable-autoexec -P bones.py > bones.txt"""
import bpy
def T(m): return tuple(round(x,3) for x in m.translation)
print('SCENES',[s.name for s in bpy.data.scenes])
for o in bpy.data.objects:
    if o.type!='MESH': continue
    n=o.name.lower()
    if any(k in n for k in ['jacket','pants','boot','shoe','sweater','body','sock','glove','scarf','shirt','stitch','hand','arm','leg','foot','hat','satchel']):
        print('OBJ',o.name,len(o.data.vertices),len(o.data.polygons),'par',o.parent.name if o.parent else None,o.parent_type,o.parent_bone,'basis',T(o.matrix_basis),'world',T(o.matrix_world),'scale',tuple(round(x,3) for x in o.scale),'uv',[u.name for u in o.data.uv_layers],'sk',len(o.data.shape_keys.key_blocks) if o.data.shape_keys else 0,'hide',o.hide_viewport,o.hide_render,'cols',[c.name for c in o.users_collection],'mats',[s.name for s in o.material_slots],'mods',[(m.name,m.type,m.show_render) for m in o.modifiers])
rig=bpy.data.objects.get('RIG-einar')
print('RIG',rig, T(rig.matrix_world), rig.data.pose_position)
for b in rig.data.bones:
    if b.name.startswith('DEF-') :
        print('BONE',b.name,tuple(round(x,4) for x in b.head_local),tuple(round(x,4) for x in b.tail_local))
