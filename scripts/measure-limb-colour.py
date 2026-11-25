"""Measure cross-joint albedo differences in an exported workshop game GLB.

python scripts/measure-limb-colour.py character.glb
Requires NumPy, Pillow and SciPy.
"""
import argparse
import io
import json
import runpy
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.spatial.transform import Rotation

WorkshopMesh = runpy.run_path(str(Path(__file__).with_name("measure-garments.py")))["WorkshopMesh"]


def joint_pivots(mesh):
    points = {}

    def walk(index, parent):
        node = mesh.nodes[index]
        local = np.eye(4)
        local[:3, :3] = Rotation.from_quat(node.get("rotation", [0, 0, 0, 1])).as_matrix() @ np.diag(node.get("scale", [1, 1, 1]))
        local[:3, 3] = node.get("translation", [0, 0, 0])
        world = parent @ local
        label = node.get("extras", {})
        if label.get("region") and label.get("station") == 0 and "digit" not in label:
            points[label["region"]] = world[:3, 3]
        for child in node.get("children", []):
            walk(child, world)

    for root in mesh.gltf["scenes"][mesh.gltf.get("scene", 0)]["nodes"]:
        walk(root, np.eye(4))
    return points


def vertex_pigment(mesh, primitive):
    doc = mesh.gltf
    attrs = primitive["attributes"]
    material = doc["materials"][primitive["material"]]["pbrMetallicRoughness"]
    tex = doc["textures"][material["baseColorTexture"]["index"]]
    buffer = doc["bufferViews"][doc["images"][tex["source"]]["bufferView"]]
    start = buffer.get("byteOffset", 0)
    pixels = np.asarray(Image.open(io.BytesIO(mesh.binary[start:start + buffer["byteLength"]])).convert("RGB")) / 255
    uv = mesh.read(attrs["TEXCOORD_0"])
    h, w = pixels.shape[:2]
    coords = np.clip((uv * [w, h]).astype(int), 0, [w - 1, h - 1])
    samples = pixels[coords[:, 1], coords[:, 0]]
    albedo = np.where(samples <= .04045, samples / 12.92, ((samples + .055) / 1.055) ** 2.4)
    if "COLOR_0" in attrs:
        albedo *= mesh.read(attrs["COLOR_0"])[:, :3]
    albedo *= np.array(material.get("baseColorFactor", [1, 1, 1, 1])[:3])
    return np.where(albedo <= .0031308, albedo * 12.92, 1.055 * np.maximum(0, albedo) ** (1 / 2.4) - .055) * 255


def measure(path):
    mesh = WorkshopMesh(path)
    node = next(n for n in mesh.nodes if n.get("name") == "Character surface")
    primitive, = mesh.gltf["meshes"][node["mesh"]]["primitives"]
    normals = mesh.read(primitive["attributes"]["NORMAL"])
    pigment, pivots = vertex_pigment(mesh, primitive), joint_pivots(mesh)
    output = {}
    for upper in mesh.region_names:
        if not upper.endswith((" thigh", " upper")):
            continue
        leg = upper.endswith(" thigh")
        prefix = upper.rsplit(" ", 1)[0]
        lower, tip = prefix + (" shin" if leg else " forearm"), prefix + (" foot" if leg else " hand")
        if not all(n in pivots for n in (upper, lower, tip)):
            continue
        colours, counts = [], []
        for region, end in [(upper, upper), (lower, tip)]:
            axis = pivots[end] - pivots[lower]
            length = np.linalg.norm(axis)
            if length < .005:
                break
            along = (mesh.rest - pivots[lower]) @ (axis / length) / length
            outer = normals[:, 0] * (1 if region.startswith("left") else -1) > .23
            take = (mesh.region_indices == mesh.region_names.index(region)) & (along > .07) & (along < .30) & outer
            if take.sum() < 4:
                break
            colours.append(np.median(pigment[take], axis=0))
            counts.append(int(take.sum()))
        if len(colours) == 2:
            output[lower] = {"samples": counts, "gap": round(float(np.linalg.norm(colours[1] - colours[0]) / np.sqrt(3)), 2)}
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("glb")
    print(json.dumps(measure(parser.parse_args().glb), indent=2))
