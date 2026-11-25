"""Render an orthographic view of the source scan and its intrinsic coordinates."""

from pathlib import Path
import io, sys, zipfile
import numpy as np
import cv2, moderngl as gl
from PIL import Image

Image.MAX_IMAGE_PIXELS = 17000**2
from inputs import CACHE as p, SYSTEM_SKINS

sys.path.insert(0, str(Path.cwd() / "scripts"))
import rocketbox_face_surface as native


def donor(name):
    folder = p / name
    obj = next(folder.glob("*.obj"))
    xyz, uv, faces = [], [], []
    with obj.open() as f:
        for line in f:
            if line.startswith("v "):
                xyz.append(" ".join(line.split()[1:4]))
            elif line.startswith("vt "):
                uv.append(" ".join(line.split()[1:3]))
            elif line.startswith("f "):
                faces.append(line[2:])
    xyz = np.fromstring(" ".join(xyz), sep=" ", dtype="f").reshape(-1, 3)
    uv = np.fromstring(" ".join(uv), sep=" ", dtype="f").reshape(-1, 2)
    faces = (
        np.fromstring(" ".join(faces).replace("/", " "), sep=" ", dtype="i").reshape(
            -1, 3, 2
        )
        - 1
    )
    xyz = xyz[:, [0, 2, 1]].copy()
    xyz[:, 2] *= -1
    return (
        xyz,
        faces[:, :, 0],
        uv[faces[:, :, 1]],
        Image.open(next(folder.glob("*diffuse.png"))),
    )


def editable(frame):
    xyz = native.smooth(native.evaluate(frame))
    idx, uv = native.smooth_topology()
    key = "male" if frame > 0 else "female"
    with zipfile.ZipFile(SYSTEM_SKINS) as z:
        skin = Image.open(
            io.BytesIO(
                z.read(
                    f"skins/young_caucasian_{key}/young_lightskinned_{key}_diffuse.png"
                )
            )
        ).convert("RGB")
    return xyz, idx, uv, skin


ctx = gl.create_standalone_context(require=330)
shader = ctx.program(
    vertex_shader="""#version 330
in vec3 position;in vec2 uv;
out vec3 where;out vec2 st;
uniform vec3 center,right,up,forward;
uniform float scale;
void main(){vec3 q=position-center;where=position;st=uv;gl_Position=vec4(dot(q,right)/scale,dot(q,up)/scale,-dot(q,forward)/2.,1.);}
""",
    fragment_shader="""#version 330
in vec3 where;in vec2 st;
layout(location=0) out vec4 enc;layout(location=1) out vec4 place;
void main(){enc=vec4(st,0.,1.);place=vec4(where,1.);}
""",
)


class Head:
    def __init__(self, model):
        xyz, idx, uv, image = model
        self.xyz = xyz
        self.idx = idx
        self.uv = uv
        self.rgb = np.asarray(image.convert("RGB"))
        top = xyz[:, 1].max()
        self.center = np.median(xyz[xyz[:, 1] > top - 0.135], axis=0)
        self.center[1] = top - 0.126
        tris = xyz[idx]
        mask = tris[:, :, 1].max(axis=1) > top - 0.42
        self.vbo = ctx.buffer(
            np.concatenate([tris[mask], uv[mask]], axis=2).astype("f").tobytes()
        )
        self.vao = ctx.vertex_array(shader, [(self.vbo, "3f 2f", "position", "uv")])

    def render(self, yaw=0, center=None, axes=None, scale=0.16, size=512):
        if axes is None:
            y = np.radians(yaw)
            axes = np.array(
                [[np.cos(y), 0, -np.sin(y)], [0, 1, 0], [np.sin(y), 0, np.cos(y)]]
            )
        center = self.center if center is None else center
        for key, val in zip(["right", "up", "forward", "center"], [*axes, center]):
            shader[key].value = tuple(val)
        shader["scale"].value = scale
        bufs = [ctx.texture((size, size), 4, dtype="f4") for _ in range(2)]
        depth = ctx.depth_renderbuffer((size, size))
        fb = ctx.framebuffer(bufs, depth_attachment=depth)
        fb.use()
        ctx.viewport = (0, 0, size, size)
        fb.clear()
        ctx.enable(gl.DEPTH_TEST)
        self.vao.render()
        uv, world = [
            np.frombuffer(tex.read(), "<f4").reshape(size, size, 4)[::-1].copy()
            for tex in bufs
        ]
        for obj in [fb, depth, *bufs]:
            obj.release()
        ih, iw = self.rgb.shape[:2]
        rgb = cv2.remap(
            self.rgb,
            uv[:, :, 0] * (iw - 1),
            (1.0 - uv[:, :, 1]) * (ih - 1),
            cv2.INTER_LINEAR,
        )
        rgb[world[:, :, 3] == 0] = [202, 201, 202]
        return rgb, world, uv


if __name__ == "__main__":
    import mediapipe as mp
    from mediapipe.tasks import python
    from mediapipe.tasks.python import vision

    lm = vision.FaceLandmarker.create_from_options(
        vision.FaceLandmarkerOptions(
            base_options=python.BaseOptions(model_asset_path=str(p / "face.task")),
            min_face_detection_confidence=0.4,
        )
    )
    names = sys.argv[1:]

    for name in names:
        h = Head(
            editable(0.9 if name.endswith("-m") else -0.9)
            if name.startswith("native")
            else donor(name)
        )
        best = None
        for yaw in [0, 30, -30, 60, -60, 180, 150, 210, 120, 240, 90, 270]:
            rgb, world, uv = h.render(yaw)
            result = lm.detect(
                mp.Image(
                    image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)
                )
            )
            if result.face_landmarks:
                points = (
                    np.array([(v.x, v.y) for v in result.face_landmarks[0]])
                    * rgb.shape[0]
                )
                coords = np.round(points).astype(int).clip(0, rgb.shape[0] - 1)
                xyz = world[coords[:, 1], coords[:, 0]]
                width = np.linalg.norm(points[33] - points[263])
                offset = abs(
                    np.linalg.norm(points[1] - points[33])
                    - np.linalg.norm(points[1] - points[263])
                )
                rank = width - offset
                if best is None or rank > best[0]:
                    best = (rank, rgb, xyz, uv[coords[:, 1], coords[:, 0]], yaw)
        if best:
            _, rgb, xyz, uv, yaw = best
            np.savez(p / (name + "-marks.npz"), xyz=xyz, uv=uv, yaw=yaw)
        else:
            raise RuntimeError(f"Could not locate the face on {name}")
        Image.fromarray(rgb).save(p / (name + "-front.jpg"))
        print(name, yaw, flush=True)
