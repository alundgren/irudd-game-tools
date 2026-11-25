"""Offscreen orthographic triangle rasterization for the shape benchmark."""

import atexit
import hashlib
import sys
from contextlib import ExitStack
from functools import lru_cache

import numpy as np


@lru_cache(maxsize=1)
def hardware_renderer():
    try:
        import moderngl
    except ImportError as exc:
        raise RuntimeError("Install the benchmark renderer with python -m pip install moderngl.") from exc

    # The platform default uses WGL on Windows. EGL also supports headless Linux.
    reasons = []
    for options in ({}, {"backend": "egl"}):
        try:
            ctx = moderngl.create_context(standalone=True, require=330, **options)
        except Exception as exc:
            reasons.append(str(exc))
            continue
        name = ctx.info["GL_RENDERER"]
        if any(s in name.lower() for s in ("softpipe", "llvmpipe", "swiftshader", "basic render", "software", "gdi generic")):
            reasons.append(name)
            ctx.release()
            continue
        try:
            renderer = Rasterizer(ctx)
        except Exception:
            ctx.release()
            raise
        atexit.register(renderer.close)
        print(f"Benchmark hardware renderer: {name}", file=sys.stderr, flush=True)
        return renderer
    print(f"Benchmark software rasterizer (hardware unavailable: {' / '.join(reasons)})", file=sys.stderr, flush=True)
    return None


def renderer_name():
    renderer = hardware_renderer()
    return renderer.ctx.info["GL_RENDERER"] if renderer else "NumPy software"


def cache_tag(source_hash):
    renderer = hardware_renderer()
    if renderer is None:
        return source_hash[:12]  # compatible with earlier NumPy-only caches
    signature = renderer_name() + renderer.ctx.info["GL_VERSION"]
    driver = hashlib.sha256(signature.encode()).hexdigest()[:10]
    return f"{source_hash[:12]}-gl-{driver}"


class Rasterizer:
    def __init__(self, ctx):
        self.ctx = ctx
        self.program = ctx.program(vertex_shader="""
            #version 330
            in vec3 cameraPosition;
            uniform vec2 xyScale;
            uniform vec2 depthRange;
            out vec2 weights;
            out float depthMetres;
            void main() {
                int corner = gl_VertexID % 3;
                weights = vec2(corner == 0 ? 1.0 : 0.0, corner == 1 ? 1.0 : 0.0);
                depthMetres = cameraPosition.z;
                gl_Position = vec4(cameraPosition.xy * xyScale,
                    (depthRange.x - depthMetres) * depthRange.y, 1.0);
            }
        """, fragment_shader="""
            #version 330
            in vec2 weights;
            in float depthMetres;
            out vec4 sampleValue;
            void main() {
                sampleValue = vec4(float(gl_PrimitiveID + 1), weights, depthMetres);
            }
        """)
        self.clay = ctx.program(vertex_shader="""
            #version 330
            in vec3 cameraPosition, cameraNormal, vertexColor;
            uniform vec2 xyScale, depthRange;
            out vec3 surfaceNormal, paint;
            out float depthMetres;
            void main() {
                gl_Position = vec4(cameraPosition.xy * xyScale,
                    (depthRange.x - cameraPosition.z) * depthRange.y, 1.0);
                depthMetres = cameraPosition.z;
                surfaceNormal = cameraNormal;
                paint = vertexColor;
            }
        """, fragment_shader="""
            #version 330
            in vec3 surfaceNormal, paint;
            in float depthMetres;
            out vec4 sampleValue;
            void main() {
                vec3 n = normalize(surfaceNormal);
                if (n.z < 0.0) n = -n;
                float key = max(dot(n, normalize(vec3(-0.45, 0.55, 0.70))), 0.0);
                float fill = max(dot(n, normalize(vec3(0.65, 0.10, 0.50))), 0.0);
                float light = (0.30 + 0.62 * key + 0.20 * fill) * (0.80 + 0.20 * n.z);
                sampleValue = vec4(clamp(paint * light, 0.0, 1.0), depthMetres);
            }
        """)
        self.ctx.enable_only(ctx.DEPTH_TEST)

    def close(self):
        self.clay.release()
        self.program.release()
        self.ctx.release()

    def pixels(self, program, cam, faces, pixels_per_metre, width, height, attributes, clear):
        z = cam[:, 2]
        extent = max(np.ptp(z), 1e-5)
        program["depthRange"].value = ((z.min() + z.max()) / 2, 1.99 / extent)
        program["xyScale"].value = (2 * pixels_per_metre / width, 2 * pixels_per_metre / height)
        ctx = self.ctx
        # Hold each allocation only until readback, even if a later allocation fails.
        with ExitStack() as resources:
            def own(resource):
                resources.callback(resource.release)
                return resource
            color = own(ctx.renderbuffer((width, height), components=4, dtype="f4"))
            depth = own(ctx.depth_renderbuffer((width, height)))
            frame = own(ctx.framebuffer(color, depth))
            frame.use()
            frame.clear(*clear)
            if len(faces):
                buffers = []
                for key, values in [("cameraPosition", cam), *attributes]:
                    buffer = own(ctx.buffer(np.asarray(values[faces], dtype="f4", order="C")))
                    buffers.append((buffer, "3f", key))
                triangles = own(ctx.vertex_array(program, buffers))
                triangles.render(mode=ctx.TRIANGLES)
            raw = frame.read(components=4, dtype="f4")
        return np.frombuffer(raw, dtype=np.float32).reshape(height, width, 4)[::-1]

    def shade(self, vertices, faces, basis, center, pixels_per_metre, width, height, normals, colors, background):
        cam = (np.asarray(vertices) - center) @ basis.T
        pixels = self.pixels(self.clay, cam, faces, pixels_per_metre, width, height,
                             [("cameraNormal", normals @ basis.T), ("vertexColor", colors)], (*background, -np.inf))
        depth = pixels[:, :, 3]
        return pixels[:, :, :3], np.isfinite(depth), depth

    def draw(self, vertices, faces, basis, center, pixels_per_metre, width, height):
        cam = (np.asarray(vertices) - center) @ basis.T
        pixels = self.pixels(self.program, cam, faces, pixels_per_metre, width, height, [], (0, 0, 0, 0))
        ids = pixels[:, :, 0].astype(np.int32) - 1
        mask = ids >= 0
        weights = np.empty((height, width, 3), dtype=np.float32)
        weights[:, :, :2] = pixels[:, :, 1:3]
        weights[:, :, 2] = mask - weights[:, :, 0] - weights[:, :, 1]
        return ids, weights, np.where(mask, pixels[:, :, 3], -np.inf)
