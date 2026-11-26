"""Step 1: fit a scan's head to the native default head by its face, and show the two together.
  python align.py NAME      -> work/NAME-aligned.npz (head vertices in native space, faces, face uv), work/NAME-align.jpg
"""
import sys
import numpy as np
from PIL import Image
import common as C
from common import R, here

name = sys.argv[1]
detect = C.landmarker()
native = R.Head(R.editable(0))
nmarks = C.face_marks(native, detect, here / 'work' / 'native-marks.npz')
xyz, faces, fuv, image = C.source(name)
head = R.Head((xyz, faces, fuv, image))
marks = C.face_marks(head, detect, here / 'work' / (name + '-marks.npz'))
ok = [i for i in C.STABLE if np.isfinite(marks[i]).all() and np.abs(marks[i]).sum() > 0 and np.abs(nmarks[i]).sum() > 0]
s, Rm, t = C.similarity(marks[ok], nmarks[ok])
moved = s * xyz @ Rm.T + t
err = np.linalg.norm(s * marks[ok] @ Rm.T + t - nmarks[ok], axis=1) * 1000
print(name, 'scale', round(float(s), 4), 'landmark error mm mean', err.mean().round(1), 'max', err.max().round(1), 'points', len(ok))
top = native.xyz[:, 1].max()
keep = (moved[faces][:, :, 1].min(1) > top - .34) & (np.abs(moved[faces][:, :, 0]).max(1) < .3)
used = np.unique(faces[keep]); remap = -np.ones(len(xyz), int); remap[used] = np.arange(len(used))
np.savez_compressed(here / 'work' / (name + '-aligned.npz'), xyz=moved[used].astype('f'), faces=remap[faces[keep]], fuv=fuv[keep].astype('f'), marks=(s * marks @ Rm.T + t).astype('f'), native_marks=nmarks.astype('f'), scale=s)
print('head vertices', len(used), 'triangles', int(keep.sum()), 'native top', round(float(top), 4), 'scan top', round(float(moved[used][:, 1].max()), 4))
aligned = R.Head((moved, faces, fuv, image))
centre = native.center
views = []
for h in (native, aligned):
    row = [h.render(yaw, center=centre, size=512, scale=.16)[0] for yaw in (0, 90, 180)]
    row.append(h.render(axes=np.array([[1, 0, 0], [0, 0, -1.], [0, 1, 0]]), center=centre, size=512, scale=.16)[0])
    views.append(np.hstack(row))
Image.fromarray(np.vstack(views + [(views[0].astype(int) + views[1]) // 2]).astype('uint8')).save(here / 'work' / (name + '-align.jpg'), quality=88)
