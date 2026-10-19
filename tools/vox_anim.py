"""Reference port of MagicaVoxel 0.99.7.2 animation semantics (.vox v200).

Ported from the decompiled binary (see docs/magicavoxel-re.md):
  ***REMOVED***  scene reader (nTRN / nSHP / nGRP / META)
  ***REMOVED***  per-frame evaluator (keyframe search, lerp, rounding)

Usage:
  python3 tools/vox_anim.py               # run self-check
  python3 tools/vox_anim.py scene.vox     # print every animated node per frame
"""
import math
import struct
import sys
from bisect import bisect_left
from dataclasses import dataclass, field

MAX_FRAME = 360  # scene clamps the current frame to [0, 360]
IDENTITY_ROT = 4  # packed rotation byte for the identity matrix


@dataclass
class XformKey:
    f: int
    t: tuple
    r: int


@dataclass
class ShapeKey:
    f: int
    model: int


@dataclass
class Node:
    kind: str  # 'nTRN' | 'nSHP' | 'nGRP'
    attrs: dict
    keys: list = field(default_factory=list)
    children: list = field(default_factory=list)
    layer: int = -1


def _str(b, o):
    n, = struct.unpack_from('<i', b, o)
    return b[o + 4:o + 4 + n].decode('utf-8', 'replace'), o + 4 + n


def _dict(b, o):
    n, = struct.unpack_from('<i', b, o)
    o += 4
    d = {}
    for _ in range(n):
        k, o = _str(b, o)
        d[k], o = _str(b, o)
    return d, o


def valid_rot(r):
    """Reader rejects malformed rotation bytes and falls back to identity."""
    r &= 0x7f
    i0, i1 = r & 3, (r >> 2) & 3
    return IDENTITY_ROT if i0 > 2 or i1 > 2 or i0 == i1 else r


def parse(path):
    b = open(path, 'rb').read()
    if b[:4] != b'VOX ':
        raise ValueError(f'{path}: not a .vox file')
    n, m = struct.unpack_from('<ii', b, 12)  # MAIN
    o, end = 20 + n, 20 + n + m
    nodes, meta = {}, {}
    while o < end:
        cid = b[o:o + 4].decode('latin1')
        n, m = struct.unpack_from('<ii', b, o + 4)
        c = b[o + 12:o + 12 + n]
        o += 12 + n + m
        if cid == 'META':
            meta, _ = _dict(c, 0)
        if cid not in ('nTRN', 'nSHP', 'nGRP'):
            continue
        nid, = struct.unpack_from('<i', c, 0)
        attrs, p = _dict(c, 4)
        node = Node(cid, attrs)
        if cid == 'nTRN':
            child, _reserved, node.layer, nf = struct.unpack_from('<iiii', c, p)
            p += 16
            node.children = [child]
            for _ in range(nf):
                d, p = _dict(c, p)
                t = tuple(int(v) for v in d.get('_t', '0 0 0').split())
                node.keys.append(XformKey(int(d.get('_f', -1)), t, valid_rot(int(d.get('_r', IDENTITY_ROT)))))
        elif cid == 'nSHP':
            nm, = struct.unpack_from('<i', c, p)
            p += 4
            for _ in range(nm):
                mid, = struct.unpack_from('<i', c, p)
                d, p = _dict(c, p + 4)
                node.keys.append(ShapeKey(int(d.get('_f', -1)), mid))
        else:
            nc, = struct.unpack_from('<i', c, p)
            node.children = list(struct.unpack_from(f'<{nc}i', c, p + 4))
        node.keys.sort(key=lambda k: k.f)  # the evaluator binary-searches by frame
        nodes[nid] = node
    return nodes, meta


def _wrap(keys, t, loop):
    if not loop:
        return t
    first = keys[0].f
    return first + (t - first) % (keys[-1].f - first + 1)


def _key_index(keys, t):
    """Last key with f <= t; the first key when t precedes every key."""
    fs = [k.f for k in keys]
    i = bisect_left(fs, t)
    if (i == len(fs) or fs[i] != t) and i > 0:
        i -= 1
    return i


def eval_xform(keys, t, loop=False):
    """Translation lerps and rounds half up; rotation holds the previous key."""
    t = _wrap(keys, t, loop)
    i = _key_index(keys, t)
    a = keys[i]
    b, s = a, 0.0
    if i + 1 < len(keys):
        b = keys[i + 1]
        s = (t - a.f) / (b.f - a.f)
        s = min(s, 1.0) if s >= 0.0 else 0.0
    pos = tuple(math.floor(pa + (pb - pa) * s + 0.5) for pa, pb in zip(a.t, b.t))
    return pos, a.r


def eval_shape(keys, t, loop=False):
    """Model swaps are stepped: the model of the last key at or before t."""
    return keys[_key_index(keys, _wrap(keys, t, loop))].model


def _selftest():
    # Keys taken from vox/anim/T-Rex-m.vox (nTRN id 2).
    trex = [XformKey(0, (0, 0, 13), 4), XformKey(11, (44, 0, 13), 4), XformKey(19, (148, 0, 13), 17)]
    assert eval_xform(trex, 0) == ((0, 0, 13), 4)
    assert eval_xform(trex, 5) == ((20, 0, 13), 4)  # 44 * 5/11 = 20.0
    assert eval_xform(trex, 15) == ((96, 0, 13), 4)  # 44 + 104 * 0.5, rotation still held
    assert eval_xform(trex, 19) == ((148, 0, 13), 17)
    assert eval_xform(trex, 30) == ((148, 0, 13), 17)  # holds after the last key
    assert eval_xform(trex, 25, loop=True) == eval_xform(trex, 5)  # span = 19 - 0 + 1
    assert eval_xform([XformKey(5, (7, 7, 7), 4), XformKey(9, (0, 0, 0), 4)], 0) == ((7, 7, 7), 4)
    # floor(x + 0.5): -0.5 rounds to 0, not away from zero.
    assert eval_xform([XformKey(0, (0, 0, 0), 4), XformKey(2, (-1, 1, 3), 4)], 1) == ((0, 1, 2), 4)
    shp = [ShapeKey(0, 10), ShapeKey(2, 11)]
    assert [eval_shape(shp, t) for t in range(4)] == [10, 10, 11, 11]
    assert eval_shape(shp, 5, loop=True) == 11  # 0 + 5 % 3 = 2
    assert valid_rot(0) == IDENTITY_ROT and valid_rot(17) == 17
    print('self-check ok')


def _dump(path):
    nodes, meta = parse(path)
    animated = {nid: n for nid, n in nodes.items() if len(n.keys) > 1}
    lo, hi = (int(v) for v in meta.get('_anim_range', f'0 {MAX_FRAME}').split())
    last = max((k.f for n in animated.values() for k in n.keys), default=0)
    hi = min(hi, max(last, lo))
    for nid, n in sorted(animated.items()):
        loop = n.attrs.get('_loop') == '1'
        print(f'{n.kind} {nid} loop={loop} keys={[k.f for k in n.keys]}')
        for t in range(lo, hi + 1):
            v = eval_xform(n.keys, t, loop) if n.kind == 'nTRN' else eval_shape(n.keys, t, loop)
            print(f'  {t:3d}: {v}')


if __name__ == '__main__':
    if len(sys.argv) == 1:
        _selftest()
    for p in sys.argv[1:]:
        _dump(p)
