"""Python handle on the editable human generator (character-view/human-surface.js).

The generator stays a black box: recipes go in, surface vertices come out. Its
axis list and ranges are read from the module itself, so new axes are picked up
without changes here. The second-stage surface correction (human-fit.js) is
called through the same bridge.
"""

import base64
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np

BRIDGE = Path(__file__).with_name("generator-bridge.mjs")
LIVE = Path(__file__).resolve().parents[2] / "character-view"
def source_files(folder):
    return sorted(p for p in Path(folder).iterdir()
                  if p.suffix in (".js",".json") and not p.name.endswith(".test.js"))


def snapshot(work):
    """Copy the generator into a new folder under `work`, so a long run measures one fixed version.

    The folder is named after the generator's hash. Nothing that already exists is
    changed or removed: an identical earlier copy is reused, and a folder that
    differs in any file is left alone while the copy goes to a numbered sibling.
    """
    sources = source_files(LIVE)
    tag = source_hash(LIVE)[:12]
    for attempt in range(1000):
        folder = Path(work) / (f"generator-{tag}" + (f"-{attempt}" if attempt else ""))
        if not folder.exists():
            folder.mkdir(parents=True)
            for path in sources:
                shutil.copy2(path, folder / path.name)
            return folder
        same_names = {p.name for p in folder.iterdir()} == {p.name for p in sources}
        if same_names and all((folder / p.name).read_bytes() == p.read_bytes() for p in sources):
            return folder
    raise RuntimeError(f"No free snapshot folder for generator {tag} in {work}")


def source_hash(folder):
    digest = hashlib.sha256()
    files = source_files(folder)
    # Older recorded runs used a human* digest. Keep those identifiers readable.
    # Current fitters import helpers outside that prefix, so hash the full snapshot.
    if not (Path(folder) / "head-depth-fit.js").exists():
        files = [p for p in files if p.name.startswith("human")]
    for path in files:
        digest.update(path.name.encode() + b"\n" + path.read_bytes().replace(b"\r\n", b"\n"))
    return digest.hexdigest()


class Generator:
    def __init__(self, folder=LIVE):
        self.folder = Path(folder).resolve()
        self.process = subprocess.Popen(["node", str(BRIDGE), str(self.folder)],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        info = self._ask({"describe": True})
        self.axes = [a["name"] for a in info["axes"]]
        self.low = np.array([a["min"] for a in info["axes"]], dtype=float)
        self.high = np.array([a["max"] for a in info["axes"]], dtype=float)
        self.initial = np.array([a["initial"] for a in info["axes"]], dtype=float)
        self.vertex_count = info["vertices"]
        self.faces = np.array(info["indices"], dtype=np.int64).reshape(-1, 3)
        self.source_sha256 = source_hash(self.folder)
        self.evaluations = 0

    def _ask(self, request):
        self.process.stdin.write((json.dumps(request) + "\n").encode())
        self.process.stdin.flush()
        header = json.loads(self.process.stdout.readline())
        if "error" in header:
            raise ValueError(header["error"])
        return header

    def recipe(self, values):
        """Axis vector to the recipe object the editor stores, clipped to the legal ranges."""
        values = np.clip(values, self.low, self.high)
        return {name: round(float(v), 4) for name, v in zip(self.axes, values)}

    def vector(self, recipe):
        return np.array([recipe.get(name, default) for name, default in zip(self.axes, self.initial)], dtype=float)

    def evaluate(self, recipes, fits=None):
        """Surface vertices in metres for each recipe, shape [count, vertices, 3]."""
        request = {"recipes": recipes}
        if fits is not None:
            request["fits"] = fits
        header = self._ask(request)
        raw = self.process.stdout.read(header["bytes"])
        self.evaluations += len(recipes)
        return np.frombuffer(raw, "<f4").reshape(len(recipes), -1, 3).astype(np.float64)

    def refine(self, recipe, vertices, faces, region="whole"):
        """The editor's own bounded surface correction towards a reference in the generator's frame."""
        return self._ask({"refine": {
            "human": recipe, "region": region,
            "positions": base64.b64encode(np.asarray(vertices, "<f4").tobytes()).decode(),
            "indices": base64.b64encode(np.asarray(faces, "<u4").tobytes()).decode(),
        }})

    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=10)
