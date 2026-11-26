"""Pack two CC0 Mindfront facial relief fields from the MakeHuman Skins 02 archive.

Usage: python scripts/pack-human-dermal.py EXTRACTED_PACK character-view/human-dermal-data.json
Projection is the stock 2048 hm08 layout. Integrate tangent normals into a local height
field so the standard bump material can carry both the authored relief and editable scars.
"""
import base64
import io
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter


def smooth(a, b, values):
    t = np.clip((values - a) / (b - a), 0, 1)
    return t*t*(3-2*t)


def integrate(normals):
    gx = -normals[..., 0] / np.maximum(.5, normals[..., 2])
    gy = normals[..., 1] / np.maximum(.5, normals[..., 2])
    gx = np.block([[gx, -gx[:, ::-1]], [gx[::-1], -gx[::-1, ::-1]]])
    gy = np.block([[gy, gy[:, ::-1]], [-gy[::-1], -gy[::-1, ::-1]]])
    h, w = gx.shape
    kx = (2*np.pi*np.fft.rfftfreq(w))[None, :]
    ky = (2*np.pi*np.fft.fftfreq(h))[:, None]
    spectrum = -1j*(kx*np.fft.rfft2(gx) + ky*np.fft.rfft2(gy))
    height = np.fft.irfft2(spectrum / (kx*kx + ky*ky + 1/22**2), s=(h,w))
    return height[:h//2, :w//2]


def pack(source, target):
    source, target = Path(source), Path(target)
    index = json.loads((source/'packs/skins02.json').read_bytes())
    layout = json.loads((target.parent/'human-complexion-data.json').read_bytes())
    rect = layout['rect']
    def crop(path):
        return np.array(Image.open(path).convert('RGB').resize((2048,2048)).crop(rect))/255
    fields = Image.open(io.BytesIO(base64.b64decode(layout['fields'][2].split(',')[1])))
    face = np.array(fields.convert('RGB'))[...,2]/255
    h,w=face.shape
    y,x=np.mgrid[:h,:w]
    x,y=x/(w-1),y/(h-1)
    mask=face*(1-smooth(.75,.99,((x-.51)/.39)**2+((y-.5)/.40)**2))
    eye=((x-.405)/.027)**2+((abs(y-.5)-.119)/.045)**2
    mask *= smooth(.72,1.22,eye)
    mouth=((x-.679)/.023)**2+((y-.5)/.15)**2
    mask *= smooth(.35,1.15,mouth)
    maps=[]
    credits=[]
    for name in ['mindfront_skin_male_african_middleage','mindfront_aksel_skin']:
        meta = index[name]
        if meta['license'] != 'CC0':
            raise ValueError(name + ': unrecognised grant')
        folder=source/'skins'/name
        normal=crop(next(folder.glob('*_NRM.png')))*2-1
        height=integrate(normal)
        spec=crop(next(folder.glob('*_SPEC.png')))[...,0]
        albedo=crop(next(p for p in folder.glob('*.png') if '_NRM' not in p.name and '_SPEC' not in p.name))
        lum=np.log(.05+albedo@np.array([.213,.715,.072]))
        cavity=gaussian_filter(lum,1.0)-gaussian_filter(lum,9.)
        if name=='mindfront_aksel_skin':
            safe=smooth(.47,.53,y)
            for field in [height,spec,cavity]:
                field[:] = field*safe + field[::-1,:]*(1-safe)
        reflection=spec-gaussian_filter(spec,30)
        channels = [np.tanh(height/1.5), np.tanh(reflection/.18), np.tanh(cavity/.18)]
        result=np.rint(128 + 118*mask[...,None]*np.stack(channels,axis=2)).astype('uint8')
        buf=io.BytesIO()
        Image.fromarray(result).save(buf,format='WEBP',lossless=True,method=5)
        maps.append('data:image/webp;base64,'+base64.b64encode(buf.getvalue()).decode())
        credits.append({'asset':name,'author':meta['author'],'license':meta['license']})
    target.write_text(json.dumps({'encoding':'local-height-spec-pigment-v1','credits':credits,'maps':maps},separators=(',',':'))+'\n')


if __name__ == '__main__':
    pack(*sys.argv[1:])
