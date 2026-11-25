"""Loads the checked-in benchmark targets and verifies their recorded hashes."""

import hashlib
import json
from pathlib import Path

import numpy as np

from hb_mesh import read_glb

TARGETS = Path(__file__).resolve().parents[2] / "examples" / "human-targets"


def load_manifest():
    return json.loads((TARGETS / "manifest.json").read_text())


def load_target(entry, manifest):
    path = TARGETS / entry["file"]
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != entry["sha256"]:
        raise ValueError(f"{path} does not match the manifest hash")
    vertices, faces, _, _ = read_glb(path)
    regions = np.frombuffer((TARGETS / manifest["regions"]["file"]).read_bytes(), np.uint8).astype(np.int64)
    return vertices, faces, regions, manifest["regions"]["names"]
