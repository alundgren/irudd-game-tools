import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
import struct
import zlib
from PIL import Image

root = Path(__file__).resolve().parents[1]
assets = {}
for library in ("library", "attire", "einar-attire", "field-outfits", "scanned-tops"):
    assets.update(json.loads((root / f"character-view/human-{library}-data.json").read_text()))
outfits = json.loads(subprocess.check_output([
    "node", "--input-type=module", "-e",
    "import {libraryClothes} from './character-view/human-library.js'; console.log(JSON.stringify(libraryClothes))"
], cwd=root))
entries = []
for name in dict.fromkeys(piece for outfit in outfits.values() for piece in outfit):
    record = assets[name]
    for key in ("refs", "weights", "offsets", "uv", "corners", "uvCorners", "hide"):
        data = zlib.decompress(base64.b64decode(record[key]))
        kind, size = (6, 4) if key in ("weights", "offsets") else (2, 2)
        entries.append((f"{name}.{key}", kind, len(data) // size, zlib.compress(data, 9)))
    if "panels" in record:
        panel = zlib.decompress(base64.b64decode(record["panels"]))
        entries.append((name + ".panels", 1, len(panel), zlib.compress(panel, 9)))
    for key in ("texture", "normal", "occlusion", "surface"):
        if key in record:
            encoded = record[key].split(",", 1)[1]
            image = Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGBA")
            entries.append((f"{name}.{key}.size", 2, 2, zlib.compress(struct.pack("<HH", *image.size))))
            pixels = image.tobytes()
            entries.append((f"{name}.{key}", 1, len(pixels), zlib.compress(pixels, 9)))
brocade = json.loads((root / "character-view/human-scallop-thread.json").read_text())
thread = zlib.decompress(base64.b64decode(brocade["thread"]))
devices = Image.open(root / "character-view/armour-devices.webp").convert("RGB").getchannel("R").tobytes()
for key, pixels in [("brocade", thread), ("devices", devices)]:
    entries.append((key, 1, len(pixels), zlib.compress(pixels, 9)))
growth = json.loads((root / "character-view/human-complexion-data.json").read_text())["growth"]
for channel in ("moustache", "chin", "side"):
    pixels = zlib.decompress(base64.b64decode(growth[channel]))
    entries.append(("growth." + channel, 1, len(pixels), zlib.compress(pixels, 9)))
header = bytearray(struct.pack("<4sII", b"IRHP", 1, len(entries)))
for name, kind, count, blob in entries:
    key = name.encode("ascii")
    header.extend(bytes([len(key)]) + key + struct.pack("<BII", kind, count, len(blob)))
packed = bytes(header) + b"".join(entry[3] for entry in entries)
(root / "packages/character/assets/human/human-field-clothes.bin").write_bytes(packed)
print(len(packed), hashlib.sha256(packed).hexdigest())
