"""Fit the baked Einar garments to the neutral adult.

Run by scripts/pack-human-einar-attire.py. Works in the folder named by EINAR_WORK: reads bake/*.npz, geo1.npz,
bones.txt and body-rest.json there, writes fit/GROUP.npz.
Steps: mirror the right sleeve onto the open left side, carry the cloth from Einar's skeleton to ours bone by
bone with the authored weights, match girth, hold a clearance to the skin and to the layers under, and tie
every point to three skin vertices in the way human-library.js wears a garment.
"""
import json, os, re, sys
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree
from scipy.ndimage import gaussian_filter1d
sys.path.insert(0, str(Path(__file__).parent))
from geom import Surface, clip, components, smoothstep, neighbours, vertex_normals

H = Path(os.environ['EINAR_WORK']).resolve()
OUT = H / 'fit'

B = json.load(open(H / 'body-rest.json'))
NB = B['n']
BP = np.array(B['seen']).reshape(-1, 3)[:NB]
REST = np.array(B['p']).reshape(-1, 3)[:NB]
BT = np.array(B['tri']).reshape(-1, 3)
BT = BT[(BT < NB).all(1)]
IDS = np.array(B['ids'])[:NB]
NAMES = B['names']
JOINT = dict(zip(NAMES, np.array(B['joints']).reshape(-1, 3)))
BB = np.array(B['bones']).reshape(-1, 4)[:NB]; BW = np.array(B['weights']).reshape(-1, 4)[:NB]
def share(pattern):
    hit = np.array([bool(re.search(pattern, n)) for n in NAMES])
    return (BW * hit[BB]).sum(1)
ARM = share(r'^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)')
HAND = share(r'^(hand|thumb|index|middle|ring|pinky)')
LEG = share(r'^(thigh|calf|foot|ball)')
FOOT = share(r'^(foot|ball)')
HEAD = share(r'^head')
body = Surface(BP, BT)

def yup(v): return np.array([v[0], v[2], -v[1]])
def einar_bones(path):
    bones = {}
    for line in path.read_text().splitlines():
        if line.startswith('BONE '):
            m = re.match(r'BONE (\S+) \(([^)]*)\) \(([^)]*)\)', line)
            bones[m[1][4:]] = tuple(yup(list(map(float, group.split(',')))) for group in m.groups()[1:])
    for name in list(bones):
        if (name.endswith('.R') and name[:-2] + '.L' not in bones) or name in ('UpperArm.R', 'Forearm.R'):
            bones[name[:-2] + '.L'] = tuple(v * [-1, 1, 1] for v in bones[name])
    return bones

def limb_target(name):
    side = '_l' if name.endswith('.L') else '_r'
    base = name[:-2]
    J = lambda n: JOINT[n + side]
    return {
        'Shoulder': (J('clavicle'), J('upperarm')), 'UpperArm': (J('upperarm'), J('lowerarm')),
        'Forearm': (J('lowerarm'), J('hand')), 'Thigh': (J('thigh'), J('calf')), 'Knee': (J('calf'), J('foot')),
    }.get(base)

def load(group):
    z = np.load(H / 'bake' / (group + '.npz'))
    g = dict(p=z['p'].astype(float), tri=z['tri'].astype(int), uv=z['uv'].astype(float), mat=z['mat'], piece=z['piece'],
             mats=[str(s) for s in z['mats']], pieces=[str(s) for s in z['pieces']])
    names = [k[2:] for k in z.files if k.startswith('w|')]
    g['bones'] = [n[4:] for n in names]
    g['W'] = np.stack([z['w|' + n] for n in names], 1).astype(float) if names else np.zeros((len(g['p']), 0))
    return g

def piece_vertices(g, *names):
    ids = [g['pieces'].index(n) for n in names if n in g['pieces']]
    used = np.zeros(len(g['p']), bool)
    used[g['tri'][np.isin(g['piece'], ids)].ravel()] = True
    return used

RIGID = re.compile(r'button|loop$|buckle|carabiner')

def add_bone(g, name):
    if name not in g['bones']:
        g['bones'].append(name); g['W'] = np.c_[g['W'], np.zeros(len(g['p']))]
    return g['bones'].index(name)

def mirror_sleeve(g):
    """The left side of the coat was cut away for a mechanical arm. Replace it, outside a sagittal cut,
    by the mirrored right side with its sleeve."""
    main = g['pieces'].index('jacket_main'); rim = g['mats'].index('einar.jacket.rim')
    sw = g['pieces'].index('sweater'); cen = g['p'][g['tri']].mean(1)
    keep = ~((g['piece'] == sw) & ((np.abs(cen[:, 0]) > .11) | (cen[:, 2] < -.02) & (cen[:, 1] < 1.5)))
    keep &= g['piece'] != g['pieces'].index('jacket_strap_shoulder')
    for k in ('tri', 'uv', 'mat', 'piece'): g[k] = g[k][keep]
    for i, name in enumerate(g['bones']):
        if name.startswith('Thigh'):
            g['W'][:, g['bones'].index('Spine')] += g['W'][:, i]; g['W'][:, i] = 0
    tm = g['piece'] == main
    cen = g['p'][g['tri']].mean(1)
    near = tm & (g['mat'] == rim) & (cen[:, 0] > .03) & (cen[:, 1] > 1.2)
    c = float(g['p'][g['tri'][near]][:, :, 0].min()) - .004 if near.any() else .105
    c = min(c, .112)
    print('sleeve cut at x =', round(c, 4))
    old = Surface(g['p'], g['tri'][tm])
    other = {k: g[k][~tm] for k in ('tri', 'uv', 'mat', 'piece')}
    for name in list(g['bones']):
        if name.endswith('.R'): add_bone(g, name[:-2] + '.L')
    per = dict(mat=g['mat'][tm], piece=g['piece'][tm])
    lap = .006
    p, a, t1, u1, per1, cut1 = clip(g['p'], dict(W=g['W']), g['tri'][tm], g['uv'][tm], per, g['p'][:, 0] - c - lap)
    p, a, t2, u2, per2, cut2 = clip(p, a, g['tri'][tm], g['uv'][tm], per, p[:, 0] + c - lap)
    used = np.unique(t2)
    remap = -np.ones(len(p), int); remap[used] = len(p) + np.arange(len(used))
    swap = [g['bones'].index(n[:-2] + ('.L' if n.endswith('.R') else '.R')) if n[-2:] in ('.L', '.R') else i for i, n in enumerate(g['bones'])]
    mp = p[used] * [-1, 1, 1]; mw = a['W'][used][:, swap]
    is_cut = np.isin(used, cut2)
    kept = Surface(p, t1)
    q, _, _, _, nq = kept.closest(mp[is_cut])
    disp = q - nq * .0018 - mp[is_cut]
    print('seam mismatch mm: median', round(np.median(np.linalg.norm(disp, axis=1)) * 1000, 1), 'max', round(np.linalg.norm(disp, axis=1).max() * 1000, 1))
    bt = cKDTree(mp[is_cut]); dist, idx = bt.query(mp)
    mp = mp + disp[idx] * (1 - smoothstep(dist, 0.0, 0.05))[:, None]
    right = np.zeros(len(p), bool); right[np.unique(g['tri'][tm])] = True; right &= p[:, 0] < 0
    ridx = np.where(right)[0]; rt = cKDTree(p[ridx] * [-1, 1, 1])
    left = np.zeros(len(p), bool); left[np.unique(t1)] = True; left &= p[:, 0] > 0
    _, j = rt.query(p[left], k=3)
    wm = a['W'][ridx[j]].mean(1)[:, swap]
    k = smoothstep(p[left][:, 0], 0.0, .04)[:, None]
    a['W'][left] = a['W'][left] * (1 - k) + wm * k
    P = np.r_[p, mp]; W = np.r_[a['W'], mw]
    t2m = remap[t2][:, ::-1]; u2m = u2[:, ::-1]
    tri = np.r_[other['tri'], t1, t2m]; uv = np.r_[other['uv'], u1, u2m]
    mat = np.r_[other['mat'], per1['mat'], per2['mat']]; piece = np.r_[other['piece'], per1['piece'], per2['piece']]
    mirrored = np.r_[np.zeros(len(other['tri']) + len(t1), bool), np.ones(len(t2m), bool)]
    new_main = np.r_[np.zeros(len(other['tri']), bool), np.ones(len(t1) + len(t2m), bool)]
    new = Surface(P, tri[new_main])
    loose = np.zeros(len(P), bool); loose[np.unique(other['tri'])] = True
    loose &= P[:, 0] > c - .03
    q0, _, _, h0, n0 = old.closest(P[loose])
    q1, _, _, _, n1 = new.closest(q0)
    blend = (1 - smoothstep(np.abs(h0), .02, .04)) * smoothstep(P[loose][:, 0], c - .03, c)
    P[loose] += (q1 + n1 * h0[:, None] - P[loose]) * blend[:, None]
    g.update(p=P, W=W, tri=tri, uv=uv, mat=mat, piece=piece, mirrored=mirrored)
    return compact(g)

def compact(g):
    used = np.unique(g['tri']); remap = -np.ones(len(g['p']), int); remap[used] = np.arange(len(used))
    g['p'] = g['p'][used]; g['W'] = g['W'][used]; g['tri'] = remap[g['tri']]
    return g

def complete_weights(g, donors):
    """Pieces sewn on without weights take them from the cloth under them; hardware moves as one."""
    have = g['W'].sum(1) > .05
    donor = have & piece_vertices(g, *donors)
    tree = cKDTree(g['p'][donor]); src = g['W'][donor]
    comp = components(len(g['p']), g['tri'])
    piece_of = np.zeros(len(g['p']), int); piece_of[g['tri'].ravel()] = np.repeat(g['piece'], 3)
    g['rigid'] = np.zeros(len(g['p']), int)
    rigid_id = 0
    for c in np.unique(comp[~have]):
        v = np.where(comp == c)[0]
        if RIGID.search(g['pieces'][piece_of[v[0]]]):
            rigid_id += 1; g['rigid'][v] = rigid_id
            d, i = tree.query(g['p'][v].mean(0)[None], k=4)
            w = 1 / (d[0] + .003); g['W'][v] = (src[i[0]] * w[:, None]).sum(0) / w.sum()
        else:
            d, i = tree.query(g['p'][v], k=4)
            w = 1 / (d + .003); g['W'][v] = (src[i] * w[:, :, None]).sum(1) / w.sum(1, keepdims=True)
    g['W'] /= np.maximum(g['W'].sum(1, keepdims=True), 1e-9)

def with_rim(surface):
    edges = {}
    for a, b, c in surface.tri:
        for e in ((a, b), (b, c), (c, a)): edges[(min(e), max(e))] = edges.get((min(e), max(e)), 0) + 1
    rim = np.unique([v for e, k in edges.items() if k == 1 for v in e])
    if len(rim): surface.rim = cKDTree(surface.p[rim])
    return surface

class Warp:
    def __init__(self, proxies):
        self.build_torso(proxies)
        self.girth = {}

    def build_torso(self, proxies):
        """Height by height: where the trunk is, how wide and how deep. Einar's own trunk is not in the file,
        so the knit under the coat and the seat of the trousers stand for it."""
        crotch_s = proxies['crotch']; torso = BP[(ARM < .3) & (HEAD < .5)]
        mid = (np.abs(BP[:, 0]) < .012) & (LEG > .2) & (BP[:, 1] > .6)
        crotch_t = BP[mid][:, 1].min()
        self.ys = np.array([0.0, E['Knee.R'][0][1], crotch_s, E['UpperArm.R'][0][1], E['Neck'][0][1], E['Head'][0][1], E['Head'][1][1]])
        self.yt = np.array([0.0, JOINT['calf_r'][1], crotch_t, JOINT['upperarm_r'][1], JOINT['neck_01'][1], JOINT['head'][1], BP[:, 1].max()])
        print('heights', np.round(self.ys, 3), '->', np.round(self.yt, 3))
        ys = np.arange(.80, 1.66, .01); rows = []
        for y in ys:
            src = proxies['knit'] if y > 1.0 else proxies['seat']
            ease = .024 if y > 1.0 else .014
            s = src[np.abs(src[:, 1] - y) < .012]
            yt = np.interp(y, self.ys, self.yt)
            t = torso[np.abs(torso[:, 1] - yt) < .012]
            if len(s) < 8 or len(t) < 8: rows.append([np.nan] * 4); continue
            xs = np.quantile(np.abs(s[:, 0]), .97); zs = np.quantile(s[:, 2], [.03, .97])
            xt = np.quantile(np.abs(t[:, 0]), .97) + ease; zt = np.quantile(t[:, 2], [.03, .97]) + [-ease, ease]
            rows.append([xt / xs, (zt[1] - zt[0]) / (zs[1] - zs[0]), zs.mean(), zt.mean()])
        rows = np.array(rows); ok = ~np.isnan(rows[:, 0])
        rows = np.stack([np.interp(ys, ys[ok], rows[ok, k]) for k in range(4)], 1)
        rows = gaussian_filter1d(rows, 3, axis=0, mode='nearest')
        shoulder = abs(JOINT['upperarm_r'][0]) / abs(E['UpperArm.R'][0][0])
        k = smoothstep(ys, 1.30, 1.40)
        rows[:, 0] = rows[:, 0] * (1 - k) + shoulder * k
        rows[:, :2] = np.clip(rows[:, :2], .78, 1.3)
        self.tab_y, self.tab = ys, rows
        for i in range(0, len(ys), 6): print('torso y', round(ys[i], 2), 'sx', round(rows[i, 0], 3), 'sz', round(rows[i, 1], 3), 'zc', round(rows[i, 2], 3), '->', round(rows[i, 3], 3))

    def torso(self, x):
        y = x[:, 1]; t = [np.interp(y, self.tab_y, self.tab[:, k]) for k in range(4)]
        slope = (self.yt[-1] - self.yt[-2]) / (self.ys[-1] - self.ys[-2])
        yy = np.where(y > self.ys[-1], self.yt[-1] + (y - self.ys[-1]) * slope, np.interp(y, self.ys, self.yt))
        return np.stack([x[:, 0] * t[0], yy, t[3] + (x[:, 2] - t[2]) * t[1]], 1)

    def limb(self, name, x):
        (hs, ts), (ht, tt) = E[name], limb_target(name)
        us, ut = ts - hs, tt - ht
        ls, lt = np.linalg.norm(us), np.linalg.norm(ut); us /= ls; ut /= lt
        v = np.cross(us, ut); c = us @ ut
        K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
        R = np.eye(3) + K + K @ K / (1 + c)
        d = x - hs; a = d @ us; r = d - a[:, None] * us
        g = self.girth.get(name)
        s = np.interp(a / ls, g[0], g[1]) if g is not None else np.ones(len(x))
        return ht + (a * lt / ls)[:, None] * ut + (r @ R.T) * s[:, None]

    def measure_girth(self, name, cloth, ease, lo=.86, hi=1.2):
        """How much wider or narrower the limb's cloth is cut for our limb: its radius about the bone against the
        radius of the skin about ours, with the ease the cloth is to keep."""
        (hs, ts), (ht, tt) = E[name], limb_target(name)
        tname = {'UpperArm': 'upperarm', 'Forearm': 'lowerarm', 'Thigh': 'thigh', 'Knee': 'calf'}[name[:-2]] + ('_l' if name.endswith('.L') else '_r')
        lead = BB[np.arange(NB), BW.argmax(1)]
        skin = BP[lead == NAMES.index(tname)]
        def polar(pts, h, t):
            u = t - h; l = np.linalg.norm(u); u = u / l; d = pts - h; a = d @ u
            return a / l, np.linalg.norm(d - a[:, None] * u, axis=1)
        ts_, rs = polar(cloth, hs, ts); tt_, rt = polar(skin, ht, tt)
        bins = np.linspace(0, 1, 7); mid = (bins[:-1] + bins[1:]) / 2; s = []
        for a, b in zip(bins[:-1], bins[1:]):
            c, k = rs[(ts_ >= a) & (ts_ < b)], rt[(tt_ >= a) & (tt_ < b)]
            s.append((np.median(k) + ease) / np.median(c) if len(c) > 5 and len(k) > 5 else np.nan)
            print('  girth', name, round(a, 2), 'cloth r', round(float(np.median(c)) if len(c) else 0, 3), 'skin r', round(float(np.median(k)) if len(k) else 0, 3), 'scale', round(s[-1], 3))
        s = np.array(s); ok = ~np.isnan(s)
        s = np.clip(np.interp(mid, mid[ok], s[ok]), lo, hi)
        s = gaussian_filter1d(s, 1, mode='nearest')
        self.girth[name] = (mid, s)

    def apply(self, g):
        x = g['p']; out = np.zeros_like(x); torso = None
        for i, name in enumerate(g['bones']):
            w = g['W'][:, i]
            if w.max() <= 0: continue
            use = {'Wrist.R': 'Forearm.R', 'Wrist.L': 'Forearm.L', 'Hand.R': 'Forearm.R', 'Hand.L': 'Forearm.L',
                   'Foot.R': 'Knee.R', 'Foot.L': 'Knee.L', 'Toes.R': 'Knee.R', 'Toes.L': 'Knee.L'}.get(name, name)
            if use in E and limb_target(use) is not None:
                out += w[:, None] * self.limb(use, x)
            else:
                if torso is None: torso = self.torso(x)
                out += w[:, None] * torso
        for r in range(1, int(g['rigid'].max()) + 1):
            v = np.where(g['rigid'] == r)[0]
            a, b = x[v] - x[v].mean(0), out[v] - out[v].mean(0)
            u, s, vt = np.linalg.svd(a.T @ b); d = np.sign(np.linalg.det(u @ vt))
            R = (u * [1, 1, d]) @ vt
            scale = np.sqrt((b * b).sum() / max((a * a).sum(), 1e-12))
            out[v] = out[v].mean(0) + (a @ R) * min(max(scale, .9), 1.1)
        return out

def boots_warp(g):
    """Each boot is sized to the foot it covers and stood with the foot on its insole."""
    out = g['p'].copy()
    for side in (-1, 1):
        v = g['p'][:, 0] * side > 0
        foot = BP[(FOOT > .5) & (BP[:, 0] * side > 0)]
        s = g['p'][v]
        length = (foot[:, 2].max() - foot[:, 2].min() + .034) / (s[:, 2].max() - s[:, 2].min())
        width = (foot[:, 0].max() - foot[:, 0].min() + .030) / (s[:, 0].max() - s[:, 0].min())
        k = np.array([width, (length + width) / 2, length])
        centre_s = np.array([(s[:, 0].max() + s[:, 0].min()) / 2, s[:, 1].min(), s[:, 2].min()])
        centre_t = np.array([(foot[:, 0].max() + foot[:, 0].min()) / 2, foot[:, 1].min() - .024, foot[:, 2].min() - .016])
        out[v] = centre_t + (s - centre_s) * k
        print('boot', side, 'scale', np.round(k, 3))
    return out

def clear(g, p, layers, gap, keep=None, rounds=5):
    """Hold the cloth at least `gap` outside each surface under it, moving its neighbours with it so folds stay."""
    A = neighbours(len(p), g['tri'])
    for surface, least in layers:
        for _ in range(rounds):
            q, _, _, h, n = surface.closest(p)
            need = np.maximum(least - h, 0) * (np.abs(h) < .06)
            rim = getattr(surface, 'rim', None)
            if rim is not None: need = need * (rim.query(q)[0] > .012)
            if keep is not None: need = need * keep
            if need.max() < 2e-4: break
            push = need.copy()
            for _ in range(6): push = np.maximum(need, .85 * (A @ push))
            p = p + n * push[:, None]
    return p

def neck_hold(allow, level=1.47, radius=.07):
    """Three places round the neck (throat and either side of the nape) that a standing collar holds on to as
    one piece, so it keeps its line on any neck."""
    axis = JOINT['neck_01'] + (JOINT['head'] - JOINT['neck_01']) * (level - JOINT['neck_01'][1]) / (JOINT['head'][1] - JOINT['neck_01'][1])
    cand = np.where(allow)[0]; surf = Surface(BP, BT[allow[BT].all(1)])
    ring = axis + radius * np.array([[np.sin(t), 0, np.cos(t)] for t in (0, 2.094, -2.094)])
    places = surf.closest(ring)[0]
    return cand[cKDTree(BP[cand]).query(places)[1]]

def bind(p, allow, label, hold=None):
    """Three skin vertices round the nearest skin point, a few centimetres apart, so the cloth rides the broad
    surface and not one small triangle. Returns hm08 ids, weights and the offset in the resting frame.
    Points marked in `hold` all ride the one triangle given with it, widening with it by their share."""
    surf = Surface(BP, BT[allow[BT].all(1)])
    q, t, w, h, n = surf.closest(p)
    held = np.zeros(len(p), bool)
    if hold is not None: held, anchor, follow = hold
    cand = np.where(allow)[0]; tree = cKDTree(BP[cand])
    refs = np.zeros((len(p), 3), int); wts = np.zeros((len(p), 3)); off = np.zeros((len(p), 3))
    reach = np.clip(.03 + .6 * np.abs(h), .03, .06)
    _, near_small = tree.query(q, k=48)
    wide = np.where(reach > .04)[0]
    near_wide = dict(zip(wide, tree.query(q[wide], k=min(480, len(cand)))[1])) if len(wide) else {}
    for i in range(len(p)):
        radius = reach[i]
        c = cand[near_wide[i] if i in near_wide else near_small[i]]; d = BP[c] - q[i]
        ni = n[i]; d_t = d - np.outer(d @ ni, ni)
        good = (body.n[c] @ ni > .5) & (np.abs(d @ ni) < .03 + .3 * radius)
        if good.sum() < 6: good[:] = True
        c, d_t = c[good], d_t[good]
        r = np.linalg.norm(d_t, axis=1)
        up = np.array([0., 1., 0.]) if abs(ni[1]) < .9 else np.array([0., 0., 1.])
        ua = up - (up @ ni) * ni; ua /= np.linalg.norm(ua); ub = np.cross(ni, ua)
        ang = np.arctan2(d_t @ ub, d_t @ ua)
        def pick(target):
            score = np.abs(np.angle(np.exp(1j * (ang - target)))) + np.abs(r - radius) / radius * .6
            return c[np.argmin(score)]
        a, b, cc = pick(0.0), pick(2.094), pick(-2.094)
        tri = anchor if held[i] else np.array([a, b, cc])
        if len(set(tri)) < 3: tri = BT[allow[BT].all(1)][t[i]] if False else surf.tri[t[i]]
        A_, B_, C_ = BP[tri]
        nrm = np.cross(B_ - A_, C_ - A_); area = np.linalg.norm(nrm)
        if area < 1e-7: tri = surf.tri[t[i]]; A_, B_, C_ = BP[tri]; nrm = np.cross(B_ - A_, C_ - A_); area = np.linalg.norm(nrm)
        nrm /= area
        pp = p[i] - ((p[i] - A_) @ nrm) * nrm
        m = np.array([B_ - A_, C_ - A_]).T
        uv, *_ = np.linalg.lstsq(m, pp - A_, rcond=None)
        wt = np.array([1 - uv.sum(), uv[0], uv[1]])
        if held[i]: wt = 1 / 3 + follow[i] * (wt - 1 / 3)
        elif np.abs(wt).max() > 2.5:
            tri = surf.tri[t[i]]; wt = w[i]; A_, B_, C_ = BP[tri]
        base = wt @ BP[tri]; delta = p[i] - base
        def frame(P3):
            a_ = P3[1] - P3[0]; a_ = a_ / np.linalg.norm(a_); b_ = P3[2] - P3[0]
            n_ = np.cross(a_, b_); n_ = n_ / np.linalg.norm(n_); return np.array([a_, np.cross(n_, a_), n_])
        local = frame(BP[tri]) @ delta
        off[i] = frame(REST[tri]).T @ local
        refs[i] = tri; wts[i] = wt
    print(label, 'bound', len(p), 'mean offset mm', round(np.linalg.norm(off, axis=1).mean() * 1000, 1), 'max', round(np.linalg.norm(off, axis=1).max() * 1000, 1))
    return refs, wts, off

def worn(refs, wts, off, P=None, R=None):
    """Where human-library.js puts the points on a body with skin positions P."""
    P = BP if P is None else P
    out = np.zeros((len(refs), 3))
    for i in range(len(refs)):
        tri = refs[i]
        def frame(P3):
            a_ = P3[1] - P3[0]; a_ = a_ / np.linalg.norm(a_); b_ = P3[2] - P3[0]
            n_ = np.cross(a_, b_); n_ = n_ / np.linalg.norm(n_); return np.array([a_, np.cross(n_, a_), n_])
        out[i] = wts[i] @ P[tri] + frame(P[tri]).T @ (frame(REST[tri]) @ off[i])
    return out

def covered(layers):
    """Skin that lies under cloth with no opening near. Head and hands always stay."""
    hide = np.zeros(NB, bool)
    for p, tri in layers:
        s = Surface(p, tri)
        edges = {}
        for a, b, c in tri:
            for e in ((a, b), (b, c), (c, a)): edges[(min(e), max(e))] = edges.get((min(e), max(e)), 0) + 1
        rim = np.unique([v for e, k in edges.items() if k == 1 for v in e])
        if len(rim):
            _, _, _, hr, _ = body.closest(p[rim])
            far = cKDTree(p[rim])
        q, _, _, h, n = s.closest(BP + body.n * .002)
        out = ((q - BP) * body.n).sum(1)
        under = (np.abs(h) < .07) & (out > 0)
        if len(rim):
            d, i = far.query(BP)
            under &= ~((d < .03) & (out < .012 + d))
        hide |= under
    hide &= (HEAD < .5) & (HAND < .5)
    return hide

if __name__ == '__main__':
    OUT.mkdir(exist_ok=True)
    E = einar_bones(H / 'bones.txt')
    jacket, pants, boots = load('jacket'), load('pants'), load('boots')
    geo = np.load(H / 'geo1.npz')
    jacket = mirror_sleeve(jacket)
    complete_weights(jacket, ['jacket_main', 'jacket_collar1', 'jacket_collar2', 'sweater'])
    complete_weights(pants, ['pants_main'])
    boots['rigid'] = np.zeros(len(boots['p']), int)
    pm = geo['pants_main|p']
    crotch = float(pm[np.abs(pm[:, 0]) < .008][:, 1].min())
    jw = geo['jacket_main|w|DEF-UpperArm.R'] + geo['jacket_main|w|DEF-Forearm.R']
    warp = Warp(dict(knit=geo['jacket_main|p'][jw < .3].astype(float), seat=pm[pm[:, 1] > crotch + .02].astype(float), crotch=crotch))
    jm = piece_vertices(jacket, 'jacket_main'); pmv = piece_vertices(pants, 'pants_main')
    for side in 'RL':
        for bone, ease in (('UpperArm', .016), ('Forearm', .018)):
            name = bone + '.' + side
            w = jacket['W'][:, jacket['bones'].index(name)]
            warp.measure_girth(name, jacket['p'][jm & (w > .5)], ease)
        for bone, ease in (('Thigh', .014), ('Knee', .022)):
            name = bone + '.' + side
            w = pants['W'][:, pants['bones'].index(name)]
            warp.measure_girth(name, pants['p'][pmv & (w > .5)], ease)
    for bone in ('UpperArm', 'Forearm', 'Thigh', 'Knee'):
        a, b = warp.girth[bone + '.R'], warp.girth[bone + '.L']
        s = (a[1] + b[1]) / 2; warp.girth[bone + '.R'] = warp.girth[bone + '.L'] = (a[0], s)
        print('girth', bone, np.round(s, 3))
    fitted = {'jacket': warp.apply(jacket), 'pants': warp.apply(pants), 'boots': boots_warp(boots)}
    np.savez_compressed(OUT / 'warped.npz', **{k: v for k, v in fitted.items()})
    fitted['boots'] = clear(boots, fitted['boots'], [(body, .003)], .003)
    boot_s = with_rim(Surface(fitted['boots'], boots['tri']))
    fitted['pants'] = clear(pants, fitted['pants'], [(body, .006), (boot_s, .004)], .006)
    pants_s = with_rim(Surface(fitted['pants'], pants['tri'][pants['piece'] == pants['pieces'].index('pants_main')]))
    fitted['jacket'] = clear(jacket, fitted['jacket'], [(body, .006), (pants_s, .005)], .006)
    hide = np.zeros(NB, bool)
    for k, g in (('jacket', jacket), ('pants', pants), ('boots', boots)):
        h = covered([(fitted[k], g['tri'])])
        if k == 'boots': h |= (FOOT > .5) & (BP[:, 1] < fitted[k][:, 1].max() - .03)
        np.save(OUT / ('hide-' + k + '.npy'), IDS[h]); hide |= h
        print(k, 'hides', int(h.sum()))
    print('hidden skin vertices', int(hide.sum()), 'of', NB)
    for name, g in (('jacket', jacket), ('pants', pants), ('boots', boots)):
        p = fitted[name]
        if name == 'jacket':
            arm = np.zeros(len(p))
            for i, b in enumerate(g['bones']):
                if re.match(r'(UpperArm|Forearm|Wrist)', b): arm += g['W'][:, i]
            sleeve = arm > .5
            refs = np.zeros((len(p), 3), int); wts = np.zeros((len(p), 3)); off = np.zeros((len(p), 3))
            r, w, o = bind(p[sleeve], (ARM > .25) & (HAND < .6), 'jacket sleeves'); refs[sleeve], wts[sleeve], off[sleeve] = r, w, o
            stand = piece_vertices(g, 'jacket_collar1')
            stand |= (cKDTree(p[stand]).query(p)[0] < .035) & ~sleeve & (p[:, 2] < 0)
            knit = piece_vertices(g, 'sweater') & (p[:, 1] > 1.44)
            follow = np.where(knit, 1., .5); stand |= knit
            r, w, o = bind(p[~sleeve], (ARM < .6) & (LEG < .7) & (HEAD < .7), 'jacket body', (stand[~sleeve], neck_hold((ARM < .6) & (LEG < .7) & (HEAD < .3)), follow[~sleeve])); refs[~sleeve], wts[~sleeve], off[~sleeve] = r, w, o
        elif name == 'pants':
            refs, wts, off = bind(p, (ARM < .3) & (FOOT < .9), 'pants')
        else:
            refs, wts, off = bind(p, LEG > .5, 'boots')
        err = np.linalg.norm(worn(refs, wts, off) - p, axis=1).max()
        print(name, 'round trip error mm', round(err * 1000, 3))
        np.savez_compressed(OUT / (name + '.npz'), p=p, tri=g['tri'], uv=g['uv'], mat=g['mat'], piece=g['piece'],
                            mats=np.array(g['mats']), pieces=np.array(g['pieces']), refs=IDS[refs], wts=wts, off=off,
                            mirrored=g.get('mirrored', np.zeros(len(g['tri']), bool)))
    np.save(OUT / 'hide.npy', IDS[hide])
