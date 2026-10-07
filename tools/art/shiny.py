"""이로치(shiny) 스프라이트 만들기 — 처리된 assets/mon/<id>.webp를 HSV로 재채색해 <id>_shiny.webp로 저장.
포즈를 그대로 두기 위해 새로 생성하지 않고 원본을 재채색한다.

사용: python tools/art/shiny.py [id ...]        (인자가 없으면 RULES의 모든 id)
      python tools/art/shiny.py --preview cheese  (tools/out/art_raw/<id>_shiny_prev.png도 저장)

규칙(RULES[id])은 순서대로 적용하는 목록이다. 각 규칙은 원본 픽셀(재채색 전 값)로 대상 여부를 판정한다.
  hue: (lo, hi)       대상 색상 범위(도, lo>hi이면 360을 넘어 감싼다)
  smin/smax, vmin/vmax 대상 채도·명도 범위(0~1). vmin 기본 0.12 — 짙은 선은 건드리지 않는다.
  shift               색상 이동(도)
  set_h               색상을 이 값으로 고정(저채도 회색 털에 색을 입힐 때)
  s_mul, s_add, v_mul 채도·명도 조정
  v_pow               명도 감마(1 미만이면 어두운 털을 밝힌다 — 검은 털을 밝은 색으로 바꿀 때. 흰 부분은 1에 머문다)
  vfade               vmax 경계를 이 폭만큼 선형으로 줄인다(밝은 흰 털과 바뀐 털 사이 띠 방지)
가장자리가 갑자기 끊기지 않도록 색상 범위 경계 10° 안에서는 효과를 선형으로 줄인다.
"""
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MON = os.path.join(ROOT, 'assets', 'mon')
PREV = os.path.join(ROOT, 'tools', 'out', 'art_raw')

RULES = {
    # 노말: 주황 태비 → 은회색 태비(푸른 기). 크림색 가슴(채도 0.35 미만)은 그대로 둔다
    'cheese': [dict(hue=(10, 50), smin=0.35, set_h=215, s_mul=0.3, v_mul=0.9)],
    # 불꽃: 붉은 주황 불꽃 → 푸른 불꽃
    'flare': [dict(hue=(340, 60), smin=0.2, shift=190)],
    # 풀: 초록 → 단풍 주황(색상 고정 — 초록 폭이 60~105°로 넓어 이동만 하면 빨강·노랑이 섞여 탁해진다)
    'leaf': [dict(hue=(58, 170), smin=0.15, set_h=22, s_mul=1.6, v_mul=1.05)],
    # 전기: 노랑 → 주황 금빛
    'zap': [dict(hue=(40, 70), smin=0.25, shift=-22, s_mul=1.05)],
    # 격투: 황갈색 털 → 회청색, 붉은 천 → 남색
    'punch': [dict(hue=(5, 55), smin=0.1, set_h=215, s_mul=0.3, v_mul=0.85),
              dict(hue=(340, 5), smin=0.35, shift=230)],
    # 독: 보라 → 짙은 청록, 라임 무늬 → 주황
    'venom': [dict(hue=(250, 320), smin=0.12, shift=-95),
              dict(hue=(55, 110), smin=0.3, shift=-45)],
    # 땅: 모래색 → 붉은 점토
    'sand': [dict(hue=(15, 55), smin=0.1, shift=-22, s_mul=1.35)],
    # 비행: 하늘색 → 노을 복숭아색
    'wing': [dict(hue=(175, 250), smin=0.08, shift=165)],
    # 에스퍼: 라벤더 분홍 → 민트 청록
    'psy': [dict(hue=(250, 350), smin=0.08, shift=-130)],
    # 벌레: 날개 색 회전. 크림색 몸과 금장식(색상 15~75°)은 그대로 둔다
    'moth': [dict(hue=(75, 15), smin=0.25, shift=120)],
    # 바위: 회색 돌 → 붉은 사암, 호박 결정 → 하늘색 결정
    'rock': [dict(hue=(0, 360), smax=0.18, set_h=18, s_add=0.22),
             dict(hue=(20, 55), smin=0.35, shift=165)],
    # 고스트: 남보라 몸 → 진홍 보라, 청록 불꽃·눈 → 분홍
    'ghost': [dict(hue=(215, 290), smin=0.12, shift=60),
              dict(hue=(165, 214), smin=0.2, shift=135)],
    # 드래곤: 청록·남색 → 진홍·검붉은색
    'dragon': [dict(hue=(160, 250), smin=0.15, shift=165)],
    # 강철: 은색 → 금빛, 파란 눈 → 붉은 눈
    'iron': [dict(hue=(0, 360), smax=0.2, vmin=0.2, set_h=42, s_add=0.35),
             dict(hue=(180, 250), smin=0.3, shift=150)],
    # 페어리: 분홍 → 라벤더 하늘색
    'ribbon': [dict(hue=(290, 30), smin=0.08, shift=-110)],

    # ── 진화형(<id>2): 기본형 이로치와 같은 색 계열로 맞춘다 ──
    # 물: 하늘색 → 보라(나루냥 이로치와 같은 +62°)
    'naru2': [dict(hue=(170, 255), smin=0.08, shift=62)],
    # 얼음: 흰 털·연하늘 털 그림자(채도 0.38 미만) → 회색, 하늘색 결정·눈·냉기 → 보라
    'seol2': [dict(hue=(0, 360), smax=0.38, set_h=230, s_mul=0.15, v_mul=0.66),
              dict(hue=(165, 260), smin=0.38, shift=68, s_mul=1.1)],
    # 악: 검은 털·회색 줄무늬 → 황갈색, 명도 0.09 미만 선은 그대로
    'ssaga2': [dict(hue=(0, 360), smax=0.3, vmin=0.09, vmax=0.8, vfade=0.25, set_h=32, s_add=0.4, v_pow=0.3)],
    'cheese2': [dict(hue=(10, 50), smin=0.35, set_h=215, s_mul=0.3, v_mul=0.9)],
    'flare2': [dict(hue=(340, 60), smin=0.2, shift=190)],
    'leaf2': [dict(hue=(58, 170), smin=0.15, set_h=22, s_mul=1.6, v_mul=1.05)],
    'zap2': [dict(hue=(40, 70), smin=0.25, shift=-22, s_mul=1.05)],
    # 격투 진화형: 털·붉은 붕대는 격투냥 이로치와 같게(회청색 털, 남색 붕대). 남색 도복 → 자주색.
    # 금색 띠·장식은 털과 색상(28~40°)이 겹쳐 따로 고를 수 없으므로 털과 함께 은회색이 된다
    'punch2': [dict(hue=(5, 55), smin=0.1, set_h=215, s_mul=0.3, v_mul=0.85),
               dict(hue=(340, 5), smin=0.35, shift=230),
               dict(hue=(205, 255), smin=0.2, shift=115, s_mul=1.05, v_mul=1.1)],
    'venom2': [dict(hue=(250, 320), smin=0.12, shift=-95),
               dict(hue=(55, 110), smin=0.3, shift=-45)],
    'sand2': [dict(hue=(15, 55), smin=0.1, shift=-22, s_mul=1.35)],
    'wing2': [dict(hue=(175, 250), smin=0.08, shift=165)],
    'psy2': [dict(hue=(250, 350), smin=0.08, shift=-130)],
    # 벌레: 날개 색 회전 + 크림색 몸(채도 0.3 미만)도 연보라로 물들여 기본형 이로치보다 확실히 구별한다. 금장식은 그대로
    'moth2': [dict(hue=(75, 15), smin=0.25, shift=120),
              dict(hue=(15, 75), smin=0.04, smax=0.3, set_h=280, s_add=0.12)],
    'rock2': [dict(hue=(0, 360), smax=0.18, set_h=18, s_add=0.22),
              dict(hue=(20, 55), smin=0.35, shift=165)],
    'ghost2': [dict(hue=(215, 290), smin=0.12, shift=60),
               dict(hue=(165, 214), smin=0.2, shift=135)],
    'dragon2': [dict(hue=(160, 250), smin=0.15, shift=165)],
    'iron2': [dict(hue=(0, 360), smax=0.2, vmin=0.2, set_h=42, s_add=0.35),
              dict(hue=(180, 250), smin=0.3, shift=150)],
    'ribbon2': [dict(hue=(290, 30), smin=0.08, shift=-110)],
}

FEATHER = 10.0


def rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1)
    mn = rgb.min(-1)
    d = mx - mn
    h = np.zeros_like(mx)
    nz = d > 1e-6
    rm = nz & (mx == r)
    gm = nz & (mx == g) & ~rm
    bm = nz & ~rm & ~gm
    h[rm] = ((g - b)[rm] / d[rm]) % 6
    h[gm] = (b - r)[gm] / d[gm] + 2
    h[bm] = (r - g)[bm] / d[bm] + 4
    h = h * 60.0
    s = np.where(mx > 1e-6, d / np.maximum(mx, 1e-6), 0)
    return h, s, mx


def hsv_to_rgb(h, s, v):
    h = (h % 360) / 60.0
    i = np.floor(h).astype(int) % 6
    f = h - np.floor(h)
    p = v * (1 - s)
    q = v * (1 - s * f)
    t = v * (1 - s * (1 - f))
    out = np.zeros(h.shape + (3,), np.float32)
    for k, (a, b, c) in enumerate([(v, t, p), (q, v, p), (p, v, t), (p, q, v), (t, p, v), (v, p, q)]):
        m = i == k
        out[m, 0], out[m, 1], out[m, 2] = a[m], b[m], c[m]
    return out


def hue_weight(h, lo, hi):
    """색상 범위 안이면 1, 경계 FEATHER° 밖으로 갈수록 0."""
    if lo == 0 and hi == 360:
        return np.ones_like(h)
    width = (hi - lo) % 360
    rel = (h - lo) % 360          # lo에서 시계 방향 거리
    inside = rel <= width
    # 범위 밖 거리
    dist_out = np.minimum((lo - h) % 360, (h - hi) % 360)
    w = np.where(inside, 1.0, np.clip(1 - dist_out / FEATHER, 0, 1))
    return w


def recolor(rgba, rules):
    rgb = rgba[..., :3].astype(np.float32) / 255.0
    h0, s0, v0 = rgb_to_hsv(rgb)
    h, s, v = h0.copy(), s0.copy(), v0.copy()
    for r in rules:
        lo, hi = r.get('hue', (0, 360))
        w = hue_weight(h0, lo, hi)
        w = w * (s0 >= r.get('smin', 0)) * (s0 <= r.get('smax', 1.01))
        w = w * (v0 >= r.get('vmin', 0.12))
        if 'vfade' in r:
            w = w * np.clip((r['vmax'] - v0) / r['vfade'], 0, 1)
        else:
            w = w * (v0 <= r.get('vmax', 1.01))
        if not w.any():
            continue
        nh = h0 + r.get('shift', 0)
        if 'set_h' in r:
            nh = np.full_like(h0, r['set_h'])
        ns = np.clip(s0 * r.get('s_mul', 1.0) + r.get('s_add', 0.0), 0, 1)
        nv = np.clip(np.power(v0, r.get('v_pow', 1.0)) * r.get('v_mul', 1.0), 0, 1)
        # 색상은 가까운 쪽 각도 차이로, 채도·명도는 값 그대로 가중치만큼 보간한다
        dh = ((nh - h0 + 180) % 360) - 180
        sel = w > 0
        h[sel] = (h0 + dh * w)[sel]
        s[sel] = (s0 + (ns - s0) * w)[sel]
        v[sel] = (v0 + (nv - v0) * w)[sel]
    out = hsv_to_rgb(h, s, v)
    res = rgba.copy()
    res[..., :3] = np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8)
    return res


def run(mid, preview=False):
    src = os.path.join(MON, mid + '.webp')
    rgba = np.asarray(Image.open(src).convert('RGBA'))
    res = recolor(rgba, RULES[mid])
    im = Image.fromarray(res, 'RGBA')
    im.save(os.path.join(MON, mid + '_shiny.webp'), 'WEBP', quality=90, method=6)
    if preview:
        os.makedirs(PREV, exist_ok=True)
        a = Image.open(src).convert('RGBA')
        c = Image.new('RGBA', (a.width * 2, a.height), (40, 52, 80, 255))
        c.alpha_composite(a, (0, 0))
        c.alpha_composite(im, (a.width, 0))
        c.convert('RGB').resize((a.width, a.height // 2)).save(os.path.join(PREV, mid + '_shiny_prev.png'))
    print('저장', mid + '_shiny.webp')


if __name__ == '__main__':
    args = sys.argv[1:]
    preview = '--preview' in args
    ids = [a for a in args if not a.startswith('--')] or list(RULES)
    for i in ids:
        run(i, preview)
