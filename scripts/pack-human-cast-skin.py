from pathlib import Path
import numpy as np, cv2, json, base64, io
from PIL import Image
from scipy.interpolate import RBFInterpolator
import argparse

parser = argparse.ArgumentParser(
    description="Register Rocketbox albedo, normals and specular maps on the native face chart."
)
parser.add_argument(
    "source", type=Path, help="Folder containing the source avatar folders"
)
parser.add_argument("output", type=Path)
parser.add_argument("--beard-output", type=Path, help="Also register the clipped beard and stubble coverage from Male_Adult_05")
args = parser.parse_args()
dest = args.output
from rocketbox_face_chart import landmarks as pair

w, h = 541, 591
yy, xx = np.mgrid[:h, :w]
u = (1 - (yy + 0.5) / h) * 512
v = (xx + 0.5) / w * 512
edge = lambda z: np.clip(z, 0, 1) ** 2 * (3 - 2 * np.clip(z, 0, 1))
dist = lambda x, y, rx, ry: np.hypot((u - x) / rx, (v - y) / ry)
mask = edge((1 - dist(256, 274, 160, 217)) / 0.22)
for x, y, rx, ry in [
    (190, 215, 28, 10),
    (322, 215, 28, 10),
    (192, 178, 40, 7),
    (320, 178, 40, 7),
    (241, 285, 11, 7),
    (271, 285, 11, 7),
    (256, 349, 28, 2.5),
]:
    mask *= edge((dist(x, y, rx, ry) - 0.73) / 0.68)


def pic(f, size=1024):
    return np.float32(
        Image.open(f).convert("RGB").resize((size, size), Image.Resampling.LANCZOS)
    )


def pack(a):
    buf = io.BytesIO()
    Image.fromarray(np.uint8(np.clip(np.rint(a), 0, 255))).save(
        buf, "WEBP", quality=97, method=6
    )
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


def field(gr):
    pairs = np.array(pair, float)
    pairs[:, 2:] += gr
    r, c = np.mgrid[:1:129j, :1:129j]
    warp = RBFInterpolator(
        pairs[:, :2], pairs[:, 2:], kernel="thin_plate_spline", smoothing=0.32
    )
    values = warp(np.column_stack(((1 - r.ravel()) * 512, c.ravel() * 512))).reshape(
        129, 129, 2
    )
    return cv2.resize(values, (w, h), interpolation=cv2.INTER_CUBIC).astype("f") * (
        1024 / 500
    )


grid = field([0, 0])

def sample(values):
    return cv2.remap(values.astype("f"), grid, None, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)

out = {}
for model, style in [
    ("Female_Adult_09", "Rose"),
    ("Female_Adult_11", "Honey"),
    ("Male_Adult_03", "Ruddy"),
    ("Male_Adult_12", "Umber"),
    ("Male_Adult_14", "Sunworn"),
    ("Male_Adult_16", "Fair"),
]:
    src = args.source / model
    rgb = sample(pic(next(src.glob("*_head_color.tga"))))
    rgb = np.maximum(0.0008, ((rgb / 255 + 0.055) / 1.055) ** 2.4)
    base = np.median(
        rgb[((dist(190, 258, 23, 19) < 1) | (dist(322, 258, 23, 19) < 1))], axis=0
    )
    ratio = np.log(rgb / base)
    coarse = cv2.GaussianBlur(ratio, (0, 0), 22)
    ratio -= 0.45 * (coarse - coarse[::-1])
    strength = mask.copy()
    strength *= edge((v - 111) / 54)
    side = np.abs(u - 256)
    strength *= 1 - edge((side - 68) / 37) * (1 - edge((v - 166) / 68))
    faceL = ratio @ np.array([0.26, 0.57, 0.17])
    broad = cv2.GaussianBlur(faceL, (0, 0), 12)
    luma = 0.45 * broad + 0.64 * (faceL - broad)
    luma = 0.54 * np.tanh(luma / 0.54)
    chroma = ratio - faceL[:, :, None]
    ratio = luma[:, :, None] + 0.18 * np.tanh(chroma / 0.22)
    if model.startswith("Male"):
        strength *= 1 - 0.43 * edge((v - 294) / 62)

    rgb = 128 + 94 * ratio * strength[:, :, None]
    norms = next(src.glob("*_head_normal.tga"), None)
    high = np.zeros_like(u, dtype="f")
    if norms:
        normal = pic(norms) / 127.5 - 1
        nz = np.maximum(normal[:, :, 2], 0.2)
        fx, fy = np.meshgrid(
            np.fft.fftfreq(1024) * 2 * np.pi, np.fft.fftfreq(1024) * 2 * np.pi
        )
        denom = fx * fx + fy * fy
        denom[0, 0] = 1
        surface = np.fft.ifft2(
            (
                -1j * fx * np.fft.fft2(-normal[:, :, 0] / nz)
                - 1j * fy * np.fft.fft2(normal[:, :, 1] / nz)
            )
            / denom
        ).real
        high = sample((surface - cv2.GaussianBlur(surface, (0, 0), 10)).astype("f"))
    spec = next(src.glob("*_head_specular.tga"), None)
    rough = sample(pic(spec).mean(axis=2)) if spec else np.zeros_like(high)
    rough -= np.median(rough[dist(192, 258, 18, 20) < 1])
    out[style] = {
        "source": model,
        "paint": pack(rgb),
        "surface": pack(
            np.stack(
                [128 + 76 * high * strength, 128 + rough * strength, strength * 255],
                axis=2,
            )
        ),
    }
    print(style, "normal", bool(norms), "spec", bool(spec), flush=True)
dest.write_text(json.dumps(out, separators=(",", ":")))

if args.beard_output:
    cheek = [(143,157),(155,157),(160,175),(173,191),(186,201),(204,206),(214,201),(219,190),(229,182),(242,181),(250,183)]
    jaw = [(143,194),(149,219),(161,241),(180,253),(212,267),(239,278),(250,284)]
    outline = cheek + [(500-x,y) for x,y in cheek[-2::-1]] + [(500-x,y) for x,y in jaw] + jaw[-2::-1]
    rgb = pic(next((args.source / "Male_Adult_05").glob("*_head_color.tga")))
    y, x = np.mgrid[:1024,:1024] * (500/1024)
    shape = np.zeros((1024,1024),np.uint8)
    cv2.fillPoly(shape,[np.int32(np.rint(np.array(outline)*1024/500))],255)
    coverage = cv2.GaussianBlur(shape.astype("f")/255,(0,0),4)
    coverage *= 1 - np.exp(-(((x-250)/30)**4 + ((y-203)/8)**4))
    red, green, blue = rgb.transpose(2,0,1)
    lum = .26*red + .58*green + .16*blue
    detail = lum - cv2.GaussianBlur(lum,(0,0),3)
    silver = np.clip((.36 - np.log((red+5)/(green+5)))/.21,0,1)
    whiskers = np.clip(.79*silver + .75*np.clip(-detail/34,0,1),0,1)
    coverage *= .12 + .88*whiskers
    coverage *= 1-.88*np.exp(-(((x-250)/22)**4+((y-212)/5)**4))
    tone = np.clip(.65+detail/72+.35*silver,.25,1.5)
    density = sample(coverage) * edge((1-dist(256,319,211,163))/.12)
    pixels = np.stack([255*density,128*sample(tone),128+1.15*sample(detail)],axis=2)
    record = {"url":pack(np.uint8(np.clip(pixels,0,255))),"source":"Male_Adult_05"}
    args.beard_output.write_text(json.dumps(record,separators=(",",":")))
