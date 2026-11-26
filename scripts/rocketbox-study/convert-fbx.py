import bpy, sys, os, mathutils
args = sys.argv[sys.argv.index("--") + 1:]
src, out, credit = args[0], args[1], args[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src)
mesh = next(o for o in bpy.context.scene.objects if o.type == "MESH")
world = mesh.matrix_world.copy()
for m in list(mesh.modifiers):
    mesh.modifiers.remove(m)
mesh.parent = None
mesh.matrix_world = world
for o in list(bpy.context.scene.objects):
    if o is not mesh:
        bpy.data.objects.remove(o, do_unlink=True)
mesh.data.transform(mesh.matrix_world)
mesh.matrix_world = mathutils.Matrix.Identity(4)
mesh.vertex_groups.clear()
mesh.name = mesh.data.name = credit.split(" ")[0]
for mat in mesh.data.materials:
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    colour = None
    for n in list(nt.nodes):
        if n.type == "TEX_IMAGE":
            if n.image and "_color" in n.image.filepath and os.path.exists(bpy.path.abspath(n.image.filepath)) and colour is None:
                colour = n
            elif n is not colour:
                nt.nodes.remove(n)
        elif n.type == "NORMAL_MAP":
            nt.nodes.remove(n)
    for link in list(bsdf.inputs["Base Color"].links): nt.links.remove(link)
    nt.links.new(colour.outputs["Color"], bsdf.inputs["Base Color"])
    for name in ("Specular IOR Level", "Metallic"):
        for link in list(bsdf.inputs[name].links): nt.links.remove(link)
    bsdf.inputs["Metallic"].default_value = 0
    bsdf.inputs["Roughness"].default_value = 0.8
    for link in list(bsdf.inputs["Alpha"].links): nt.links.remove(link)
    img = colour.image
    size = 2048 if "head" in img.filepath else 1024
    if "opacity" in mat.name:
        nt.links.new(colour.outputs["Alpha"], bsdf.inputs["Alpha"])
        mat.blend_method = "HASHED" if hasattr(mat, "blend_method") else mat.blend_method
        try: mat.surface_render_method = "DITHERED"
        except Exception: pass
    else:
        bsdf.inputs["Alpha"].default_value = 1
    img.scale(size, size)
    print("IMAGE", mat.name, img.name, size, img.channels)
bpy.context.scene.unit_settings.scale_length = 1
bpy.ops.object.select_all(action="DESELECT"); mesh.select_set(True); bpy.context.view_layer.objects.active = mesh
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_image_format="WEBP", export_image_quality=82,
    export_apply=True, export_yup=True, export_skins=False, export_animations=False, export_morph=False, export_copyright=credit)
v = [p.co for p in mesh.data.vertices]
print("BOUNDS", [round(min(c[i] for c in v), 4) for i in range(3)], [round(max(c[i] for c in v), 4) for i in range(3)], len(v), len(mesh.data.polygons))
