import base64
import json
import struct
import zlib
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = json.loads((root / "character-view/human-studio-head-data.json").read_text())
entries = {}


def values(text, kind):
    raw = zlib.decompress(base64.b64decode(text))
    return [v for (v,) in struct.iter_unpack("<" + kind, raw)]


def add(name, kind, data):
    raw = struct.pack(f"<{len(data)}{kind}", *data)
    entries[name] = (kind, len(data), zlib.compress(raw, 9))


def expand(control, indices):
    return [control[3 * i + axis] for i in indices for axis in range(3)]


def vertex_colour(name, piece, uv):
    atlas = "skin" if name == "skin" else "eyes" if name == "eyes" else "hair" if name.startswith("hair_") else None
    if not atlas:
        return [round(255 * max(0, min(1, channel)) ** (1 / 2.2))
                for channel in values(piece["colour"], "f")]
    paint = source["paint"][atlas]
    size = paint["side"]
    pixels = values(paint["pixels"], "B")
    colours = []
    for u, v in zip(uv[::2], uv[1::2]):
        y = 1 - v
        if atlas == "eyes":
            left, top, right, bottom = paint["box"]
            u = (u - left) / (right - left)
            y = (y - top) / (bottom - top)
        row = max(0, min(size - 1, int(y * size)))
        column = max(0, min(size - 1, int(u * size)))
        at = 3 * (row * size + column)
        colours.extend(pixels[at:at + 3])
    return colours


for name, piece in {"skin": source["skin"], **source["pieces"]}.items():
    native = name == "skin"
    indices = values(source["skin"]["source"], "H") if native else []
    positions = expand(values(source["control"], "f"), indices) if native else values(piece["points"], "f")
    uv = values(piece["uv"], "f")
    add(name + ".position", "f", positions)
    add(name + ".uv", "f", uv)
    add(name + ".index", "H", values(piece["index"], "H"))
    add(name + ".color", "B", vertex_colour(name, piece, uv))
    expressions = source["expressions"] if native else piece.get("expressions", {})
    for expression, text in expressions.items():
        delta = values(text, "f")
        add(name + "." + expression, "f", expand(delta, indices) if native else delta)

skin = values(source["skin"]["source"], "H")
add("neck", "H", [skin.index(v) for v in values(source["skin"]["neck"], "H")])
header = bytearray(struct.pack("<4sII", b"IRHP", 1, len(entries)))
payload = bytearray()
for name, (kind, count, compressed) in entries.items():
    key = name.encode("ascii")
    header.extend(bytes([len(key)]) + key)
    header.extend(struct.pack("<BII", {"B": 1, "H": 2, "f": 6}[kind], count, len(compressed)))
    payload.extend(compressed)
(root / "packages/character/assets/human/studio-rain.bin").write_bytes(header + payload)
