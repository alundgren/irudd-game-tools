"""Write each target's colour textures as raw RGBA beside the GLB, for the browser-free comparison.
python scripts/rocketbox-study/unpack-textures.py   (needs Pillow with WebP)
"""
import io
import json
import struct
from pathlib import Path

from PIL import Image

TARGETS = Path(__file__).resolve().parents[2] / ".reference-cache" / "rocketbox" / "targets"
SIZE = 1024
for glb in sorted(TARGETS.glob("*.glb")):
    data = glb.read_bytes()
    length = struct.unpack("<I", data[12:16])[0]
    doc = json.loads(data[20:20 + length])
    binary = data[28 + length:]
    for material in doc["materials"]:
        texture = doc["textures"][material["pbrMetallicRoughness"]["baseColorTexture"]["index"]]
        source = texture.get("extensions", {}).get("EXT_texture_webp", {}).get("source", texture.get("source"))
        view = doc["bufferViews"][doc["images"][source]["bufferView"]]
        start = view.get("byteOffset", 0)
        image = Image.open(io.BytesIO(binary[start:start + view["byteLength"]])).convert("RGBA").resize((SIZE, SIZE), Image.Resampling.LANCZOS)
        out = glb.with_name(glb.stem + "." + material["name"] + ".rgba")
        out.write_bytes(image.tobytes())
        print(out.name, image.size)
