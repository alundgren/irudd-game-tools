import base64
import hashlib
import io
import json
from pathlib import Path
import struct
import zlib
from PIL import Image

root = Path(__file__).resolve().parents[1]
assets = json.loads((root / "character-view/human-library-data.json").read_text())
entries = []
for name in ("male_casualsuit05", "shoes02"):
    record = assets[name]
    for key in ("refs", "weights", "offsets", "uv", "corners", "uvCorners", "hide"):
        data = zlib.decompress(base64.b64decode(record[key]))
        kind, size = (6, 4) if key in ("weights", "offsets") else (2, 2)
        entries.append((f"{name}.{key}", kind, len(data) // size, zlib.compress(data, 9)))
    for key in ("texture", "normal", "occlusion"):
        if key in record:
            encoded = record[key].split(",", 1)[1]
            image = Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGBA")
            entries.append((f"{name}.{key}.size", 2, 2, zlib.compress(struct.pack("<HH", *image.size))))
            pixels = image.tobytes()
            entries.append((f"{name}.{key}", 1, len(pixels), zlib.compress(pixels, 9)))
header = bytearray(struct.pack("<4sII", b"IRHP", 1, len(entries)))
for name, kind, count, blob in entries:
    key = name.encode("ascii")
    header.extend(bytes([len(key)]) + key + struct.pack("<BII", kind, count, len(blob)))
packed = bytes(header) + b"".join(entry[3] for entry in entries)
(root / "packages/character/assets/human/human-field-clothes.bin").write_bytes(packed)
print(len(packed), hashlib.sha256(packed).hexdigest())
