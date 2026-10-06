"""2img 원본(크로마키 배경) → 게임 스프라이트(768×768 투명 webp).

사용: python tools/art/process_sprite.py <원본.png> <출력.webp> [--key auto|green|magenta|blue] [--spill lo,hi] [--preview out.png]

절차(docs/engineering-notes.md "캐릭터 그림 만들기"):
  1. 알파 최솟값 확인 — 이미 투명이면 키아웃을 건너뛴다.
  2. 테두리 픽셀 중앙값 = 배경색. 거리 60~150 → 알파 0~1. 여기에 키 색 초과량(녹색 키면 G-max(R,B)) 25~200을
     알파 1~0으로 대응시킨 값과 작은 쪽을 쓰고, 반투명 픽셀은 배경 몫을 빼서 원래 색을 되살린다(unmix).
  3. 색 번짐 제거(despill): 녹색 키는 G ≤ max(R,B)+6, 파랑 키는 B ≤ max(R,G)+6.
     마젠타 키는 min(R,B) ≤ G+6으로 누르되 가장자리 띠(반투명 + 4px)에만 적용한다(보라 몸통 보호).
  4. 몸통과 떨어진 작은 조각(전체 불투명 면적의 0.15% 미만) 제거.
  5. 알파 바운딩 박스로 자른 뒤 정사각 캔버스(한 변 = 긴 변/0.94)에 발끝이 아래 3.1% 위,
     가로 가운데로 붙이고 768로 줄여 webp(q90, RGBA)로 저장.
"""
import argparse
import sys

import numpy as np
from PIL import Image

OUT = 768
FILL = 0.94
FOOT = 0.031
D0, D1 = 60.0, 150.0


def border_median(rgb):
    h, w, _ = rgb.shape
    b = max(4, min(h, w) // 100)
    edge = np.concatenate([
        rgb[:b].reshape(-1, 3), rgb[-b:].reshape(-1, 3),
        rgb[:, :b].reshape(-1, 3), rgb[:, -b:].reshape(-1, 3)])
    return np.median(edge, axis=0)


def classify_key(bg):
    r, g, b = bg
    if g > 150 and r < 110 and b < 110:
        return 'green'
    if r > 150 and b > 150 and g < 110:
        return 'magenta'
    if b > 150 and r < 110 and g < 110:
        return 'blue'
    return None


def chroma_key(rgb, bg):
    d = np.sqrt(((rgb - bg[None, None, :]) ** 2).sum(-1))
    return np.clip((d - D0) / (D1 - D0), 0.0, 1.0)


S0, S1 = 25.0, 200.0


def spill_amount(rgb, key):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    if key == 'green':
        return g - np.maximum(r, b)
    if key == 'magenta':
        return np.minimum(r, b) - g
    return b - np.maximum(r, g)


def unmix(rgb, alpha, bg, key, s0=S0, s1=S1):
    """불꽃·오라처럼 배경 위에 반쯤 비치게 그린 부분은 거리 기준 알파만으로는 불투명으로 남아
    키 색이 섞인 탁한 색(녹색 키면 올리브색)이 된다. 키 색 초과량(spill)으로 알파를 한 번 더 낮추고,
    P = a*C + (1-a)*BG 식으로 배경 몫을 빼서 원래 색 C를 되살린다."""
    a_sp = 1.0 - np.clip((spill_amount(rgb, key) - s0) / (s1 - s0), 0.0, 1.0)
    a = np.minimum(alpha, a_sp)
    safe = np.maximum(a, 0.05)[..., None]
    c = (rgb - (1.0 - a[..., None]) * bg[None, None, :]) / safe
    c = np.clip(c, 0, 255)
    mixed = (a < 0.999)[..., None]
    return np.where(mixed, c, rgb), a


def edge_band(alpha, px=4):
    """반투명 픽셀과 그 둘레 px 픽셀(가장자리 띠)."""
    from PIL import ImageFilter
    m = Image.fromarray(((alpha < 0.99) * 255).astype(np.uint8), 'L')
    m = m.filter(ImageFilter.MaxFilter(2 * px + 1))
    return np.asarray(m) > 0


def despill(rgb, key, alpha=None):
    """키 색 번짐 제거. 마젠타 키는 보라·분홍 몸통을 망치지 않도록 가장자리 띠(alpha 주변)에만 적용한다."""
    src = rgb.copy()
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    if key == 'green':
        g[:] = np.minimum(g, np.maximum(r, b) + 6)
    elif key == 'magenta':
        # 마젠타 번짐: R과 B가 함께 G보다 크게 튄다. 둘 중 작은 쪽을 G 근처로 누른다.
        lo = np.minimum(r, b)
        excess = np.clip(lo - (g + 6), 0, None)
        r[:] = r - excess
        b[:] = b - excess
    elif key == 'blue':
        b[:] = np.minimum(b, np.maximum(r, g) + 6)
    if key == 'magenta' and alpha is not None:
        band = edge_band(alpha)
        rgb[~band] = src[~band]
    return rgb


def remove_specks(alpha, frac=0.0015):
    """불투명 연결 성분 중 작은 것(면적 비율 frac 미만)을 지운다. scipy 없이 BFS로 라벨링."""
    mask = alpha > 0.05
    h, w = mask.shape
    labels = np.zeros((h, w), np.int32)
    sizes = [0]
    cur = 0
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if labels[y0, x0]:
            continue
        cur += 1
        stack = [(y0, x0)]
        labels[y0, x0] = cur
        n = 0
        while stack:
            y, x = stack.pop()
            n += 1
            for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= yy < h and 0 <= xx < w and mask[yy, xx] and not labels[yy, xx]:
                    labels[yy, xx] = cur
                    stack.append((yy, xx))
        sizes.append(n)
    sizes = np.array(sizes)
    total = sizes[1:].sum() or 1
    keep = sizes >= frac * total
    keep[0] = False
    out = alpha.copy()
    out[~keep[labels]] = 0
    return out


def place(rgba):
    a = rgba[..., 3]
    ys, xs = np.nonzero(a > 8)
    crop = rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    ch, cw = crop.shape[:2]
    side = int(round(max(ch, cw) / FILL))
    canvas = np.zeros((side, side, 4), np.uint8)
    bottom = side - int(round(side * FOOT))
    top = bottom - ch
    left = (side - cw) // 2
    canvas[top:bottom, left:left + cw] = crop
    im = Image.fromarray(canvas, 'RGBA')
    # 프리멀티플라이 상태로 줄여 가장자리 검은/녹색 테 방지
    arr = np.asarray(im).astype(np.float32) / 255.0
    pm = arr.copy()
    pm[..., :3] *= pm[..., 3:4]
    small = np.stack([np.asarray(Image.fromarray((pm[..., i] * 255).astype(np.uint8), 'L')
                                 .resize((OUT, OUT), Image.LANCZOS)).astype(np.float32) / 255.0
                      for i in range(4)], -1)
    al = small[..., 3:4]
    rgb = np.where(al > 1e-4, small[..., :3] / np.maximum(al, 1e-4), 0)
    out = np.concatenate([np.clip(rgb, 0, 1), al], -1)
    return Image.fromarray((out * 255 + 0.5).astype(np.uint8), 'RGBA')


def process(src, dst, key='auto', preview=None, spill=(S0, S1)):
    im = Image.open(src)
    rgba = np.asarray(im.convert('RGBA')).astype(np.float32)
    if rgba[..., 3].min() < 250:
        print('이미 투명 배경 — 키아웃 생략 (alpha min=%d)' % rgba[..., 3].min())
        # 이런 결과는 몸통 알파가 252~253(살짝 비침)이고 배경에 1~2짜리 잡티가 깔려 있다 → 8~245를 0~1로 다시 편다
        alpha = np.clip((rgba[..., 3] - 8.0) / (245.0 - 8.0), 0.0, 1.0)
        rgb = rgba[..., :3].copy()
        # 생성기가 배경을 미리 지운 경우에도 가장자리에 키 색 번짐이 남을 수 있다 — 키를 지정하면 번짐만 제거
        if key != 'auto':
            rgb = despill(rgb, key, alpha)
            print('가장자리 번짐 제거: %s 키' % key)
    else:
        rgb = rgba[..., :3].copy()
        bg = border_median(rgb)
        k = classify_key(bg) if key == 'auto' else key
        if k is None:
            sys.exit('배경색을 키 색으로 판별할 수 없음: %s' % bg)
        print('배경색 %s → %s 키' % (bg.astype(int).tolist(), k))
        alpha = chroma_key(rgb, bg)
        rgb, alpha = unmix(rgb, alpha, bg, k, *spill)
        rgb = despill(rgb, k, alpha)
    alpha = remove_specks(alpha)
    out = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype(np.uint8)
    res = place(out)
    res.save(dst, 'WEBP', quality=90, method=6)
    if preview:
        bgc = Image.new('RGBA', res.size, (40, 52, 80, 255))
        bgc.alpha_composite(res)
        bgc.convert('RGB').save(preview)
    print('저장', dst)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--key', default='auto', choices=['auto', 'green', 'magenta', 'blue'])
    ap.add_argument('--preview')
    ap.add_argument('--spill', default='%g,%g' % (S0, S1),
                    help='키 색 초과량 lo,hi → 알파 1~0. 불꽃처럼 배경색이 섞인 그림자가 남으면 15,90처럼 낮춘다')
    a = ap.parse_args()
    process(a.src, a.dst, a.key, a.preview, tuple(float(v) for v in a.spill.split(',')))
