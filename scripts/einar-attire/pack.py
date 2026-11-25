"""Pack the fitted Einar garments in the form human-library.js wears.
Run by scripts/pack-human-einar-attire.py: python pack.py OUT.json, with the work folder in EINAR_WORK.
"""
import base64, io, json, os, sys, zlib
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
H = Path(os.environ['EINAR_WORK']).resolve()
CREDIT = dict(author='Blender Foundation', licence='CC BY 4.0', source='https://studio.blender.org/characters/einar/v1/',
              license='https://creativecommons.org/licenses/by/4.0/', notice='Einar Rig (CC-BY) Blender Foundation | studio.blender.org')
# garment: (source group, map size, {material: tone})
GARMENTS = {
    'einar_coat': ('jacket', 1024, [('main', ['einar.jacket.canvas']), ('dark', ['einar.jacket.rim', 'einar.jacket.collar']),
                                    ('accent', ['einar.fabric']), ('leather', ['einar.pants_leather']), ('light', ['einar.sweater'])]),
    'einar_trousers': ('pants', 1024, [('dark', ['einar.pants_fabric']), ('main', ['einar.fabric']), ('leather', ['einar.pants_leather'])]),
    'einar_boots': ('boots', 768, [('leather', ['einar.boots']), ('sole', ['einar.boots_soles'])]),
}
METAL = ('metal_rust', 'duct_tape')
# How much of the authored stains and fading stays under each dye.
WORN = {'main': .42, 'dark': .42, 'accent': .5, 'light': .35, 'leather': .55, 'sole': .6}


def encode(values, dtype):
    return base64.b64encode(zlib.compress(np.ascontiguousarray(values, dtype=dtype).tobytes(), 9)).decode()


def webp(array, size, quality, mode=Image.Resampling.LANCZOS):
    image = Image.fromarray(array)
    if image.size != (size, size): image = image.resize((size, size), mode)
    out = io.BytesIO(); image.save(out, format='WEBP', quality=quality, method=6)
    return 'data:image/webp;base64,' + base64.b64encode(out.getvalue()).decode()


def material_chart(uv, mat, size):
    """Which material each texel was baked from, carried past the island edges."""
    chart = Image.new('L', (size, size), 255); draw = ImageDraw.Draw(chart)
    px = np.stack([uv[:, :, 0] * size, (1 - uv[:, :, 1]) * size], 2)
    for t, m in zip(px, mat):
        draw.polygon([tuple(c) for c in t], fill=int(m), outline=int(m))
    chart = np.asarray(chart)
    at = ndimage.distance_transform_edt(chart == 255, return_distances=False, return_indices=True)
    return chart[at[0], at[1]]


def pack_one(name, group, size, tones):
    z = np.load(H / 'fit' / (group + '.npz'))
    mats = [str(m) for m in z['mats']]
    load = lambda kind: np.asarray(Image.open(H / 'bake' / (group + '-' + kind + '.png')).convert('RGB'), dtype=np.float32) / 255
    diffuse, glossy, rough, ao = load('diffuse'), load('glossy'), load('rough')[:, :, 0], load('ao')[:, :, 0]
    big = diffuse.shape[0]
    chart = material_chart(z['uv'], z['mat'], big)
    metal_mat = np.isin(chart, [i for i, m in enumerate(mats) if any(k in m for k in METAL)])
    # A metal has no diffuse colour: its colour is in the mirror reflection.
    lum = lambda c: c @ np.array([.2126, .7152, .0722], np.float32)
    metal = np.where(metal_mat, np.clip(lum(glossy) / np.maximum(lum(glossy) + lum(diffuse), 1e-4), 0, 1), 0)
    colour = np.where(metal_mat[:, :, None], np.clip(diffuse + glossy, 0, 1), diffuse)
    labels = np.zeros((big, big), np.uint8); rules = []
    high, low = colour.max(2), colour.min(2); light = (high + low) / 2
    for k, (tone, names) in enumerate(tones, 1):
        mask = np.isin(chart, [mats.index(m) for m in names if m in mats])
        if not mask.any(): raise ValueError(name + ' has no ' + str(names))
        labels[mask] = k
        # Boot leather is dyed from its lit side, so the dye is the brightest it gets.
        level = np.quantile(light[mask], .9) if group == 'boots' else np.median(light[mask])
        rules.append({'tone': tone, 'level': round(float(level), 4), 'worn': WORN.get(tone, .4)})
    surface = np.dstack([np.clip(ao, .38, 1), np.clip(rough, .2, 1), metal])
    to8 = lambda a: np.rint(np.clip(a, 0, 1) * 255).astype('uint8')
    normal = np.asarray(Image.open(H / 'bake' / (group + '-normal.png')).convert('RGB'))
    uv16, inverse = np.unique(np.rint(z['uv'].reshape(-1, 2).clip(0, 1) * 65535).astype('<u2'), axis=0, return_inverse=True)
    assert len(z['p']) < 65536 and len(uv16) < 65536
    hide = np.load(H / 'fit' / ('hide-' + group + '.npy'))
    record = dict(
        refs=encode(z['refs'].ravel(), '<u2'), weights=encode(z['wts'].ravel(), '<f4'), offsets=encode(z['off'].ravel(), '<f4'),
        uv=encode(uv16.ravel(), '<u2'), corners=encode(z['tri'].ravel(), '<u2'), uvCorners=encode(inverse.ravel(), '<u2'),
        hide=encode(np.sort(hide), '<u2'),
        panels=encode(np.asarray(Image.fromarray(labels).resize((size, size), Image.Resampling.NEAREST)), 'u1'), dye=rules,
        texture=webp(to8(colour), size, 90), normal=webp(normal, size, 93), surface=webp(to8(surface), size, 90),
        credit=CREDIT,
    )
    print(name, len(z['p']), 'vertices', len(z['tri']), 'triangles', len(hide), 'hidden', [r['tone'] + ' ' + str(r['level']) for r in rules])
    return record


if __name__ == '__main__':
    out = Path(sys.argv[1])
    out.write_text(json.dumps({name: pack_one(name, *spec) for name, spec in GARMENTS.items()}, separators=(',', ':')) + '\n')
    print(out.stat().st_size, 'bytes')
