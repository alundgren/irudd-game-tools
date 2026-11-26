"""Rebake the fitted watch cap from the official Blender Studio Einar v1 download.

python scripts/pack-human-watch-cap.py path/to/einar_release_v1.blend path/to/textures path/to/blender
Requires NumPy and Pillow. Texture dependencies may remain in their original subdirectories.
"""

from pathlib import Path
import sys


def bake_in_blender(textures, p):
    import bpy
    import numpy as np

    textures_by_name = {f.name: f for f in textures.rglob("*.tif")}
    o = bpy.data.objects["GEO-einar_hat"]
    m = o.material_slots[0].material
    for i in bpy.data.images:
        name = bpy.path.basename(i.filepath.replace(chr(92), "/"))
        src = textures_by_name.get(name)
        if src is not None:
            i.filepath = str(src)
            i.reload()
            print("MAP", i.name, src, flush=True)
    new = bpy.data.scenes.new("Cap bake")
    bpy.context.window.scene = new
    copy = bpy.data.objects.new("cap", o.data.copy())
    new.collection.objects.link(copy)
    copy.matrix_world = o.matrix_world.copy()
    sub = copy.modifiers.new("Tailored curvature", "SUBSURF")
    sub.levels = 1
    sub.render_levels = 1
    bpy.context.view_layer.objects.active = copy
    copy.select_set(True)
    source_uv = copy.data.uv_layers["UVMap"]
    bake_uv = copy.data.uv_layers.new(name="CapBake")
    for i in range(len(source_uv.data)):
        bake_uv.data[i].uv = source_uv.data[i].uv
    copy.data.uv_layers.active = bake_uv
    bake_uv.active_render = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(margin=0.015)
    bpy.ops.object.mode_set(mode="OBJECT")
    new.render.engine = "CYCLES"
    new.cycles.samples = 1
    nt = m.node_tree
    bs = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    out = next(
        n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output
    )
    for kind, channel in [("albedo", "Base Color"), ("normal", None)]:
        img = bpy.data.images.new("cap-" + kind, 768, 768, alpha=False)
        if channel is None:
            img.colorspace_settings.name = "Non-Color"
        target = nt.nodes.new("ShaderNodeTexImage")
        target.image = img
        for n in nt.nodes:
            n.select = False
        target.select = True
        nt.nodes.active = target
        if channel:
            em = nt.nodes.new("ShaderNodeEmission")
            fib = bs.inputs[channel]
            if fib.links:
                nt.links.new(fib.links[0].from_socket, em.inputs[0])
            else:
                em.inputs[0].default_value = fib.default_value
            nt.links.new(em.outputs[0], out.inputs["Surface"])
        else:
            nt.links.new(bs.outputs[0], out.inputs["Surface"])
        bpy.ops.object.bake(
            type="EMIT" if channel else "NORMAL", margin=9, use_clear=True
        )
        img.filepath_raw = str(p / ("knit-" + kind + ".png"))
        img.file_format = "PNG"
        img.save()
        nt.nodes.remove(target)
        if channel:
            nt.nodes.remove(em)
        print("BAKED", kind, flush=True)
    dec = copy.modifiers.new("Game cap", "DECIMATE")
    dec.ratio = 0.22
    ev = copy.evaluated_get(bpy.context.evaluated_depsgraph_get())
    g = ev.to_mesh()
    g.calc_loop_triangles()
    xyz = np.array([v.co[:] for v in g.vertices])
    wt = np.asarray(copy.matrix_world)
    xyz = xyz @ wt[:3, :3].T + wt[:3, 3]
    xyz = xyz[:, [0, 2, 1]]
    xyz[:, 2] *= -1
    uv = np.array([u.uv[:] for u in g.uv_layers["CapBake"].data])
    np.savez_compressed(
        p / "cap-smooth.npz",
        p=xyz,
        tri=np.array([t.vertices[:] for t in g.loop_triangles]),
        uv=uv[np.array([t.loops[:] for t in g.loop_triangles])],
    )


def pack(p, target):
    import base64
    import json
    import zlib
    import numpy as np
    from PIL import Image

    mesh = np.load(p / "cap-smooth.npz")
    eye, top = 1.675, 1.8003457
    front, back = 0.14351408, -0.06387595
    centre = np.array([0, eye + 0.22 * (top - eye), (front + back) / 2])
    radii = np.array([0.0792825, top - centre[1], (front - back) / 2])
    skull_coordinates = (mesh["p"] - centre) / radii
    corners = np.concatenate([skull_coordinates[mesh["tri"]], mesh["uv"]], axis=2)
    points, index = np.unique(
        np.rint(corners.reshape(-1, 5) * 12000).astype("<i2"),
        axis=0,
        return_inverse=True,
    )

    def texture(name):
        with Image.open(p / name) as image:
            return np.asarray(
                image.convert("RGB").resize((512, 512), Image.Resampling.LANCZOS)
            )

    base = texture("knit-albedo.png").astype(float)
    base = np.clip(
        (base + 1) * 194 / (np.median(base[base.mean(2) > 4], axis=0) + 1), 0, 255
    ).astype("uint8")

    def encode(array):
        return base64.b64encode(zlib.compress(array.tobytes(), 9)).decode("ascii")

    record = {
        "points": encode(points),
        "index": encode(index.astype("<u2")),
        "tone": encode(base),
        "normal": encode(texture("knit-normal.png")),
        "credit": "Einar Rig (CC-BY) Blender Foundation | studio.blender.org",
        "source": "https://studio.blender.org/characters/einar/v1/",
        "license": "https://creativecommons.org/licenses/by/4.0/",
    }
    target.write_text(json.dumps(record, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    if "--" in sys.argv:
        textures, output = map(Path, sys.argv[sys.argv.index("--") + 1 :])
        bake_in_blender(textures, output)
    else:
        import argparse
        import subprocess
        import tempfile

        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument("blend", type=Path)
        parser.add_argument("textures", type=Path)
        parser.add_argument("blender")
        parser.add_argument(
            "--output",
            type=Path,
            default=Path("character-view/human-watch-cap-data.json"),
        )
        args = parser.parse_args()
        with tempfile.TemporaryDirectory() as scratch:
            subprocess.run(
                [
                    args.blender,
                    "-b",
                    str(args.blend.resolve()),
                    "--disable-autoexec",
                    "--python-exit-code",
                    "1",
                    "-P",
                    str(Path(__file__).resolve()),
                    "--",
                    str(args.textures.resolve()),
                    scratch,
                ],
                check=True,
            )
            pack(Path(scratch), args.output)
