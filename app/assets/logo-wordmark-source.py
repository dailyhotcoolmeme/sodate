"""소밋 워드마크 — 기존 '소개팅모아' 워드마크와 같은 글씨체로 '밋'을 만든다.

핵심: 새로 그리지 않고 **원본 글자를 잘라 붙인다**.
  '소' : 원본 첫 글자를 통째로 옮긴다.
  'ㅁ' : 원본 '모'의 ㅁ을 9분할(9-slice)로 줄인다 — 획 두께와 왼쪽아래 둥근
         모서리(반지름 54)를 그대로 둔 채 가운데 빈 구간만 잘라내 폭·높이를 맞춘다.
         (그냥 축소하면 획이 얇아져 글씨체가 달라진다)
  'ㅣ' : 원본 '팅'의 ㅣ를 그대로 옮긴다.
  'ㅅ' : 받침 자리는 높이가 57뿐이라 '소'의 ㅅ(103 높이)을 그대로는 못 쓴다.
         같은 규칙(오른쪽위만 둥근 아치, 세로획 31/28, 가로획 24)으로 그린다.

원본 실측값(1042x231): 글자 세로 36..194, 세로획 31, 가로획 24~26, 음절 간격 150,
받침 음절 뼈대는 '팅'에서: 초성 y37..127 / ㅣ y36..129 / 받침 y137..194.
"""
from PIL import Image, ImageDraw, ImageChops
import sys

SRC = 'orig_wordmark.png'          # 원본 소개팅모아 워드마크
S = 4
PINK = (233, 109, 152, 255)


def nine_slice(img, cols, rows, out_w, out_h):
    """cols=(왼쪽폭, 늘/줄일 구간폭, 오른쪽폭), rows=(위, 가운데, 아래).
    가운데 구간만 늘이거나 줄여서 out_w x out_h 로 만든다."""
    lw, mw, rw = cols
    th, mh, bh = rows
    new_mw = out_w - lw - rw
    new_mh = out_h - th - bh
    assert new_mw >= 0 and new_mh >= 0, (new_mw, new_mh)
    parts = []
    for (y0, h, nh) in ((0, th, th), (th, mh, new_mh), (th + mh, bh, bh)):
        row = []
        for (x0, w, nw) in ((0, lw, lw), (lw, mw, new_mw), (lw + mw, rw, rw)):
            p = img.crop((x0, y0, x0 + w, y0 + h))
            if (nw, nh) != (w, h):
                p = p.resize((max(nw, 1), max(nh, 1)), Image.NEAREST)
            row.append((p, nw, nh))
        parts.append(row)
    out = Image.new('RGBA', (out_w, out_h), (0, 0, 0, 0))
    y = 0
    for row in parts:
        x = 0
        h = row[0][2]
        for p, nw, nh in row:
            if nw > 0 and nh > 0:
                out.alpha_composite(p, (x, y))
            x += nw
        y += h
    return out


def rr(size, box, radius, corners):
    m = Image.new('L', size, 0)
    d = ImageDraw.Draw(m)
    x0, y0, x1, y1 = [v * S for v in box]
    r = radius * S
    if r <= 0:
        d.rectangle([x0, y0, x1, y1], fill=255)
    else:
        d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=255, corners=corners)
    return m


def build(out_path):
    src = Image.open(SRC).convert('RGBA')
    heart = src.crop((0, 0, 272, 231))
    so = src.crop((288, 0, 446, 231))

    # 원본 '모'의 ㅁ (x749..871, y38..142) → 100x90 으로 9분할 축소
    mieum_src = src.crop((749, 38, 871, 142))            # 122 x 104
    mieum = nine_slice(mieum_src, (61, 30, 31), (28, 22, 54), 100, 90)

    # 원본 '팅'의 ㅣ (x698..729, y36..130) — 그대로
    ieung_i = src.crop((698, 36, 729, 130))              # 31 x 94

    X = 442
    W = X + 150
    canvas = Image.new('RGBA', (W, 231), (0, 0, 0, 0))
    canvas.alpha_composite(heart, (0, 0))
    canvas.alpha_composite(so, (288, 0))
    canvas.alpha_composite(mieum, (X + 0, 37))
    canvas.alpha_composite(ieung_i, (X + 112, 36))

    # 종성 ㅅ — 오른쪽위만 둥근 아치(원본 '소'의 ㅅ과 같은 규칙), 아래는 열려 있다
    big = (W * S, 231 * S)
    mask = ImageChops.subtract(
        rr(big, (X + 12, 137, X + 140, 194), 26, (False, True, False, False)),
        rr(big, (X + 43, 161, X + 112, 205), 8, (False, True, False, False)),
    ).resize((W, 231), Image.LANCZOS)
    layer = Image.new('RGBA', (W, 231), PINK)
    layer.putalpha(mask)
    canvas.alpha_composite(layer)
    canvas.save(out_path)
    print('saved', out_path, canvas.size)


build(sys.argv[1] if len(sys.argv) > 1 else 'somit_wordmark.png')
