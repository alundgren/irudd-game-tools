"""The official Momentum Human Rig as a source of benchmark targets.

Loads assets/mhr_model.pt from Meta's MHR v1.0.1 release (Apache-2.0), evaluates
identities, labels body regions from the release's own skin weights and poses a
target into the limb directions written in pose-convention.json.
"""

import hashlib
import json
import zipfile
from pathlib import Path

import numpy as np
import torch

HERE = Path(__file__).resolve().parent
RELEASE = "https://github.com/facebookresearch/MHR/releases/download/v1.0.1/assets.zip"
RELEASE_SHA256 = "e4f4f205cd87c0fa106577ba1de4fc763e4eb197c924461d2ef7e6944e9d6b94"
REGIONS = ["head", "neck", "torso", "upper arms", "forearms", "hands", "thighs", "shins", "feet"]
POSE_FREE = list(range(33, 40)) + list(range(43, 50)) + list(range(50, 68)) + list(range(68, 122))
PROPORTIONS = {139: 1.1, 140: 0.4, 141: 0.2, 142: 1.0, 143: 1.0, 144: 0.2, 145: 0.2,
               146: 0.5, 149: 0.5, 150: 1.0, 153: 0.1}
LIMB_ROWS = 14


def region_of(joint):
    base = joint[2:] if joint[:2] in ("l_", "r_", "c_") else joint
    if base.startswith(("head", "jaw", "teeth", "tongue", "eye")):
        return "head"
    if base.startswith("neck"):
        return "neck"
    if base.startswith("uparm"):
        return "upper arms"
    if base.startswith(("lowarm", "wrist_twist")):
        return "forearms"
    if base.startswith(("wrist", "index", "middle", "ring", "pinky", "thumb")):
        return "hands"
    if base.startswith("upleg"):
        return "thighs"
    if base.startswith("lowleg"):
        return "shins"
    if base.startswith(("foot", "talocrural", "subtalar", "transversetarsal", "ball")):
        return "feet"
    return "torso"


def extract_model(cache):
    """Returns the model path inside `cache`, extracting it from a verified assets.zip if needed."""
    cache = Path(cache)
    model = cache / "mhr_model.pt"
    if model.exists():
        return model
    archive = cache / "assets.zip"
    if not archive.exists():
        raise FileNotFoundError(f"Download {RELEASE} to {archive}")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest != RELEASE_SHA256:
        raise ValueError(f"{archive} has SHA-256 {digest}, expected {RELEASE_SHA256}")
    with zipfile.ZipFile(archive) as z:
        model.write_bytes(z.read("assets/mhr_model.pt"))
    return model


class Rig:
    def __init__(self, cache):
        self.model = torch.jit.load(str(extract_model(cache)), map_location="cpu").eval()
        character = self.model.character_torch
        self.faces = character.mesh.faces.numpy().astype(np.int64)
        self.names = json.loads((HERE / "mhr-joints.json").read_text())["names"]
        skin = character.linear_blend_skinning
        vertex = skin.vert_indices_flattened.numpy()
        joint = skin.skin_indices_flattened.numpy()
        weight = skin.skin_weights_flattened.numpy()
        region_index = np.array([REGIONS.index(region_of(n)) for n in self.names])
        totals = np.zeros((character.mesh.rest_vertices.shape[0], len(REGIONS)))
        np.add.at(totals, (vertex, region_index[joint]), weight)
        self.vertex_region = totals.argmax(1)

    def _run(self, identity, parameters, correctives=True):
        vertices, state = self.model(identity, parameters, torch.zeros(1, 72), correctives)
        return vertices[0] / 100.0, state[0, :, :3] / 100.0

    def parameters(self, proportions=None, pose=None):
        p = torch.zeros(1, 204)
        for index, value in (proportions or {}).items():
            p[0, int(index)] = float(value)
        for index, value in (pose or {}).items():
            p[0, int(index)] = float(value)
        return p

    def evaluate(self, identity, proportions=None, pose=None):
        """Vertices and joint centres in metres, feet on the floor, pelvis over the origin."""
        with torch.no_grad():
            v, j = self._run(torch.tensor([identity], dtype=torch.float32), self.parameters(proportions, pose))
        v, j = v.numpy().astype(np.float64), j.numpy().astype(np.float64)
        root = j[self.names.index("root")]
        shift = np.array([root[0], v[:, 1].min(), root[2]])
        return v - shift, j - shift

    def solve_pose(self, identity, proportions=None, steps=300):
        """Smallest joint rotations that give the limb directions of pose-convention.json."""
        spec = json.loads((HERE / "pose-convention.json").read_text())
        rows = []
        for a, b, ma, mb, weight in spec["segments"]:
            d = np.array(spec["joints"][b]) - np.array(spec["joints"][a])
            d /= np.linalg.norm(d)
            for side, mirror in (("l_", 1.0), ("r_", -1.0)):
                rows.append((self.names.index(side + ma[2:]), self.names.index(side + mb[2:]),
                             d * [mirror, 1, 1], weight))
        start = torch.tensor([r[0] for r in rows])
        end = torch.tensor([r[1] for r in rows])
        want = torch.tensor(np.array([r[2] for r in rows]), dtype=torch.float32)
        weight = torch.tensor([r[3] for r in rows], dtype=torch.float32)
        ident = torch.tensor([identity], dtype=torch.float32)
        fixed = self.parameters(proportions)
        free = torch.zeros(len(POSE_FREE), requires_grad=True)
        optimiser = torch.optim.Adam([free], lr=0.03)
        for _ in range(steps):
            optimiser.zero_grad()
            p = fixed.clone()
            p[0, POSE_FREE] = free
            _, joints = self._run(ident, p, correctives=False)
            d = joints[end] - joints[start]
            d = d / d.norm(dim=1, keepdim=True)
            loss = (weight * (1 - (d * want).sum(1))).sum() + 2e-4 * (free ** 2).sum()
            loss.backward()
            optimiser.step()
        angles = torch.rad2deg(torch.acos(torch.clamp((d * want).sum(1), -1, 1))).detach().numpy()
        pose = {int(i): round(float(v), 5) for i, v in zip(POSE_FREE, free.detach())}
        report = {
            "limbDirectionErrorDegrees": {"max": round(float(angles[:LIMB_ROWS].max()), 2),
                                          "mean": round(float(angles[:LIMB_ROWS].mean()), 2)},
            "fingerDirectionErrorDegrees": {"max": round(float(angles[LIMB_ROWS:].max()), 2),
                                            "mean": round(float(angles[LIMB_ROWS:].mean()), 2)},
        }
        return pose, report
