"""Step 2: cut a scan's hair out as a shell on the native head with its own photograph.
  python extract.py NAME [--theta 128] [--side 1024]
Reads work/NAME-aligned.npz (align.py). Writes work/NAME-shell.npz (points in the editor's space, triangles, chart
uv), work/NAME-colour.png, work/NAME-matte.png and a contact sheet work/NAME-chart.jpg.

The chart is a view of the head from above unrolled round the crown: the middle is the top of the head, the rim
is `theta` degrees down from it, the face is towards the bottom of the picture. It has no seam.
"""
import argparse, json
import numpy as np
import cv2, moderngl as gl
from PIL import Image
from scipy import ndimage
import common as C
from common import R, here

ap = argparse.ArgumentParser(); ap.add_argument('name'); ap.add_argument('--theta', type=float, default=128); ap.add_argument('--side', type=int, default=1024)
ap.add_argument('--band', action='store_true', help='a cloth band worn in the hair is hair underneath: take it as hair and paint it from the hair above it')
ap.add_argument('--hair', default='crown', help='where sure hair is sampled: crown or back')
a = ap.parse_args()
Image.MAX_IMAGE_PIXELS = None
D = np.load(here / 'work' / (a.name + '-aligned.npz'))
frame = json.load(open(here / 'work' / 'frame.json'))

pxyz, _, _, _ = R.editable(0)
N = json.load(open(here.parent / 'studio-head10' / 'work' / 'native.json'))
J = np.array(N['positions']).reshape(-1, 3)
headish = pxyz[:, 1] > pxyz[:, 1].max() - .2
s, Rm, t = C.similarity(pxyz[headish], J[headish])
print('python head to editor: scale', round(float(s), 4), 'residual mm', (np.linalg.norm(s * pxyz[headish] @ Rm.T + t - J[headish], axis=1) * 1000).mean().round(2))
xyz = s * D['xyz'] @ Rm.T + t
marks = s * D['marks'] @ Rm.T + t
faces, fuv = D['faces'], D['fuv']
centre = np.array(frame['centre'])

rel = xyz - centre
radius = np.linalg.norm(rel, axis=1)
theta = np.degrees(np.arccos(np.clip(rel[:, 1] / radius, -1, 1)))
az = np.arctan2(rel[:, 0], rel[:, 2])
chart = .5 + .5 * (theta / a.theta)[:, None] * np.stack([np.sin(az), -np.cos(az)], 1)

tri_theta = theta[faces].max(1)
zone = tri_theta < a.theta - 1
ftri = faces[zone]; fuvz = fuv[zone]

source = R.donor.__globals__['Image'].open
folder = (here / 'source' / a.name) if (here / 'source' / a.name).exists() else (C.person / a.name)
image = np.asarray(Image.open(next(folder.glob('*diffuse.png'))).convert('RGB'))
ctx = R.ctx
prog = ctx.program(vertex_shader="""#version 330
in vec2 at; in vec2 uv; in float depth; out vec2 st; out float far;
void main(){ st = uv; far = depth; gl_Position = vec4(at * 2. - 1., 1. - depth, 1.); }""", fragment_shader="""#version 330
uniform sampler2D photo; in vec2 st; in float far; out vec4 colour;
void main(){ colour = vec4(texture(photo, vec2(st.x, 1. - st.y)).rgb, far); }""")
tex = ctx.texture(image.shape[1::-1], 3, image.tobytes()); tex.build_mipmaps(); tex.filter = (gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR); tex.anisotropy = 8.0
tex.use(0); prog['photo'].value = 0
rows = np.concatenate([chart[ftri], fuvz, (radius[ftri] / .25)[:, :, None]], 2).astype('f4')
vao = ctx.vertex_array(prog, [(ctx.buffer(rows.tobytes()), '2f 2f 1f', 'at', 'uv', 'depth')])
S = a.side
target = ctx.texture((S, S), 4, dtype='f4'); depth = ctx.depth_renderbuffer((S, S)); fb = ctx.framebuffer([target], depth)
fb.use(); ctx.viewport = (0, 0, S, S); fb.clear(0, 0, 0, 0); ctx.enable(gl.DEPTH_TEST); vao.render()
baked = np.frombuffer(target.read(), '<f4').reshape(S, S, 4)
covered = baked[:, :, 3] > 0
rgb = np.clip(baked[:, :, :3] * 255, 0, 255).astype(np.uint8)

lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(float)
yy, xx = np.mgrid[:S, :S]
def chart_of(p):
    r = p - centre; th = np.degrees(np.arccos(r[1] / np.linalg.norm(r))); z = np.arctan2(r[0], r[2])
    return np.array([.5 + .5 * th / a.theta * np.sin(z), .5 - .5 * th / a.theta * np.cos(z)]) * S
disc = lambda c, r: (xx - c[0]) ** 2 + (yy - c[1]) ** 2 < r * r
sure_hair = disc((S / 2, S / 2 + (S * .12 if a.hair == 'back' else 0)), S * .1) & covered
cheeks = [chart_of(marks[i]) for i in (123, 352, 9, 151)]
sure_skin = np.zeros((S, S), bool)
for c in cheeks: sure_skin |= disc(c, S * .018)
sure_skin &= covered
print('sure hair', int(sure_hair.sum()), 'sure skin', int(sure_skin.sum()))
def model(mask):
    x = lab[mask]; mean = np.median(x, 0); cov = np.cov((x - mean).T) + np.diag([36., 9., 9.])
    return mean, np.linalg.inv(cov)
def far(m):
    d = lab - m[0]; return np.sqrt(np.einsum('...i,ij,...j->...', d, m[1], d))
hair_m, skin_m = model(sure_hair), model(sure_skin)
dh, ds = far(hair_m), far(skin_m)
matte = 1 / (1 + np.exp(-(ds - dh) * 1.4))
chroma = np.hypot(lab[:, :, 1] - 128, lab[:, :, 2] - 128)
skin_chroma, hair_chroma = np.median(chroma[sure_skin]), np.median(chroma[sure_hair])
if hair_chroma < .55 * skin_chroma:
    plain = 1 - np.clip((chroma - .45 * skin_chroma) / (.25 * skin_chroma), 0, 1)
    matte = np.maximum(matte, plain * (ds > 2.2))
print('chroma skin', skin_chroma.round(1), 'hair', hair_chroma.round(1))
neither = (dh > 5.5) & (ds > 5.5) & ((chroma > 1.4 * max(skin_chroma, hair_chroma)) | (lab[:, :, 0] > np.percentile(lab[sure_hair][:, 0], 99) + 70) if a.band else matte < .5)
matte[neither] = 0
matte[~covered] = 0
eyes = np.array([chart_of(marks[i]) for i in (33, 133, 362, 263)]); oval = np.array([chart_of(m) for m in marks if np.isfinite(m).all()])
turn = lambda q: np.arctan2(q[..., 0] - S / 2, S / 2 - q[..., 1])
reach = np.hypot(xx - S / 2, yy - S / 2); bearing = np.arctan2(xx - S / 2, S / 2 - yy)
width = np.abs(turn(oval)).max() * .6; eye_reach = np.hypot(*(eyes - S / 2).T).mean()
matte[(np.abs(bearing) < width) & (reach > eye_reach)] = 0
pure = cv2.GaussianBlur(matte.astype('f4'), (0, 0), 1.2)
solid = matte > .5
solid = ndimage.binary_opening(solid, iterations=1)
labels, n = ndimage.label(ndimage.binary_closing(solid, iterations=3))
keep = labels == labels[S // 2 + (int(S * .12) if a.hair == 'back' else 0), S // 2]
holes, count = ndimage.label(ndimage.binary_fill_holes(keep) & ~keep)
if count:
    small = np.flatnonzero(np.bincount(holes.ravel())[1:] < (S * .05) ** 2) + 1
    keep |= np.isin(holes, small)
band = np.zeros((S, S), bool)
if a.band:
    cloth, count = ndimage.label(ndimage.binary_opening(neither & covered, iterations=2))
    touching = np.unique(cloth[ndimage.binary_dilation(keep, iterations=4) & (cloth > 0)])
    inner = np.hypot(xx - S / 2, yy - S / 2) < .68 * S / 2
    for i in touching:
        piece = cloth == i
        if inner[piece].mean() > .9: band |= piece
    band = ndimage.binary_fill_holes(ndimage.binary_closing(band, iterations=int(S * .02)))
    band = ndimage.binary_dilation(band, iterations=8) & covered
    keep |= band
    keep = ndimage.binary_closing(keep, iterations=3)
    print('band texels', int(band.sum()))
near = ndimage.distance_transform_edt(~keep)
deep = ndimage.distance_transform_edt(keep) > S * .035
matte = np.where(keep & (deep | band | (pure > .5)), np.maximum(matte, .85), np.where(keep, np.minimum(matte, pure), matte * np.clip(1 - near / (S * .012), 0, 1)))
matte = cv2.GaussianBlur(matte.astype('f4'), (0, 0), .8)

alpha = np.clip(matte, 0, 1)
own = (alpha > .6) & (pure > .55) & ~band
hair_only = rgb.astype('f4') * own[:, :, None]
weight = own.astype('f4')
for _ in range(3):
    hair_only = cv2.GaussianBlur(hair_only, (0, 0), 3); weight = cv2.GaussianBlur(weight, (0, 0), 3)
    fill = hair_only / np.maximum(weight, 1e-4)[:, :, None]
    hair_only = np.where(own[:, :, None], rgb.astype('f4'), fill * (weight > .02)[:, :, None]); weight = np.where(own, 1., (weight > .02) * 1.)
colour = np.where(own[:, :, None], rgb, np.clip(hair_only, 0, 255)).astype(np.uint8)
if band.any():
    by, bx = np.nonzero(band); todo = np.ones(len(by), bool)
    away = np.stack([S / 2 - by, S / 2 - bx], 1).astype('f4'); away /= np.maximum(np.linalg.norm(away, axis=1, keepdims=True), 1e-3)
    clear = own & ~ndimage.binary_dilation(band, iterations=10); first = np.zeros(len(by), int)
    for step in range(4, int(S * .3), 2):
        sy = np.clip((by + away[:, 0] * step).astype(int), 0, S - 1); sx = np.clip((bx + away[:, 1] * step).astype(int), 0, S - 1)
        hit = todo & clear[sy, sx]
        first[hit] = step; todo &= ~hit
    for reach in (2, 1):
        sy = np.clip((by + away[:, 0] * first * reach).astype(int), 0, S - 1); sx = np.clip((bx + away[:, 1] * first * reach).astype(int), 0, S - 1)
        good = (first > 0) & clear[sy, sx] & (todo | True if reach == 1 else True)
        if reach == 2: done = good.copy()
        else: good &= ~done
        colour[by[good], bx[good]] = rgb[sy[good], sx[good]]
    print('band left unpainted', int(todo.sum()))
if hair_chroma < .55 * skin_chroma:
    L = cv2.cvtColor(colour, cv2.COLOR_RGB2LAB).astype('f4')
    mid = np.median(lab[sure_hair][:, 1:], 0); spread = max(3., 2.5 * np.percentile(np.linalg.norm(lab[sure_hair][:, 1:] - mid, axis=1), 90))
    off = L[:, :, 1:] - mid; size = np.linalg.norm(off, axis=2, keepdims=True)
    L[:, :, 1:] = mid + off * np.minimum(1, spread / np.maximum(size, 1e-3))
    colour = cv2.cvtColor(np.clip(L, 0, 255).astype(np.uint8), cv2.COLOR_LAB2RGB)
    print('chroma kept within', round(float(spread), 1))

ys = np.clip((chart[:, 1] * S).astype(int), 0, S - 1); xs = np.clip((chart[:, 0] * S).astype(int), 0, S - 1)
wide = ndimage.maximum_filter(alpha, size=int(S * .045) | 1)
vertex_alpha = wide[ys, xs]
shown = zone & (vertex_alpha[faces].max(1) > .08)
mid = chart[faces].mean(1); my = np.clip((mid[:, 1] * S).astype(int), 0, S - 1); mx = np.clip((mid[:, 0] * S).astype(int), 0, S - 1)
shown &= radius[faces].mean(1) / .25 > baked[my, mx, 3] - .012 / .25
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
f = faces[shown]; edges = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
_, part = connected_components(coo_matrix((np.ones(len(edges)), (edges[:, 0], edges[:, 1])), shape=(len(xyz), len(xyz))), directed=False)
main = np.bincount(part[f[:, 0]]).argmax()
shown[np.flatnonzero(shown)[part[f[:, 0]] != main]] = False
used = np.unique(faces[shown]); remap = -np.ones(len(xyz), int); remap[used] = np.arange(len(used))
tri = remap[faces[shown]]
print('shell vertices', len(used), 'triangles', len(tri), 'hair mean sRGB', np.median(rgb[keep], 0))
tone = np.median((rgb[keep] / 255.) ** 2.2, 0)
np.savez_compressed(here / 'work' / (a.name + '-shell.npz'), points=xyz[used].astype('f4'), tri=tri.astype('i4'), uv=chart[used].astype('f4'), tone=tone, theta=a.theta)
Image.fromarray(colour[::-1]).save(here / 'work' / (a.name + '-colour.png'))
Image.fromarray((alpha[::-1] * 255).astype(np.uint8)).save(here / 'work' / (a.name + '-matte.png'))
show = lambda x: cv2.resize(x[::-1], (640, 640), interpolation=cv2.INTER_AREA)
over = (colour * alpha[:, :, None] + np.array([70, 150, 70]) * (1 - alpha[:, :, None])).astype(np.uint8)
Image.fromarray(np.hstack([show(rgb), show(np.dstack([alpha * 255] * 3).astype(np.uint8)), show(over)])).save(here / 'work' / (a.name + '-chart.jpg'), quality=90)

small = cv2.resize(np.dstack([colour, (alpha * 255).astype(np.uint8)])[::-1], (512, 512), interpolation=cv2.INTER_AREA)
xyz[used].astype('<f4').tofile(here / 'work' / (a.name + '-points.f32'))
inside = ndimage.distance_transform_edt(~((alpha <= .4) & covered & (ds < 5.5))) * (np.radians(a.theta) / (S / 2)) * 95.
inside[ys[used], xs[used]].astype('<f4').tofile(here / 'work' / (a.name + '-inland.f32'))
tri.astype('<u4').tofile(here / 'work' / (a.name + '-tri.u32'))
small.tofile(here / 'work' / (a.name + '-rgba.u8'))
(here / 'work' / (a.name + '-meta.json')).write_text(json.dumps({'theta': a.theta, 'tone': tone.tolist(), 'vertices': int(len(used)), 'triangles': int(len(tri))}))
