"""소밋 워드마크 — 기존 '소개팅모아' 워드마크와 같은 글자체로 '밋'을 그린다.

원본(1042x231)에서 실측한 값을 그대로 쓴다:
  글자 세로 36..194, 세로획 31, 가로획 24~25, 음절 간격 150
  받침 있는 음절(팅) 뼈대: 초성 0..90 / 중성 ㅣ 105..136 / 받침 11..135, 받침 높이 57
  이 글씨체의 버릇: ㅁ은 왼쪽아래, ㅅ은 오른쪽위 모서리만 크게 둥글다
'소'는 원본 픽셀을 그대로 옮긴다(글씨체 100% 일치).
"""
from PIL import Image, ImageDraw, ImageChops
import sys

SRC = '/Users/ourmine/dev/sodate/app/assets/logo-wordmark.png'
S = 4
PINK = (233, 109, 152, 255)


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


def ring(size, outer, o_r, o_c, inner, i_r, i_c):
    return ImageChops.subtract(rr(size, outer, o_r, o_c), rr(size, inner, i_r, i_c))


def build(out_path):
    src = Image.open(SRC).convert('RGBA')
    heart = src.crop((0, 0, 272, 231))
    so = src.crop((288, 0, 446, 231))

    X = 442
    W = X + 150
    canvas = Image.new('RGBA', (W, 231), (0, 0, 0, 0))
    canvas.alpha_composite(heart, (0, 0))
    canvas.alpha_composite(so, (288, 0))

    big = (W * S, 231 * S)
    mask = Image.new('L', big, 0)

    # 초성 ㅁ — 왼쪽아래만 둥글게(원본 '모'의 ㅁ과 같은 버릇)
    mask = ImageChops.lighter(mask, ring(
        big,
        (X + 0, 37, X + 100, 127), 38, (False, False, False, True),
        (X + 31, 61, X + 69, 103), 14, (False, False, False, True),
    ))

    # 중성 ㅣ
    d = ImageDraw.Draw(mask)
    d.rectangle([(X + 112) * S, 36 * S, (X + 143) * S, 129 * S], fill=255)

    # 종성 ㅅ — 오른쪽위만 둥근 아치(원본 '소'의 ㅅ과 같은 모양), 아래는 열려 있다
    mask = ImageChops.lighter(mask, ring(
        big,
        (X + 12, 137, X + 140, 194), 26, (False, True, False, False),
        (X + 43, 161, X + 112, 205), 8, (False, True, False, False),
    ))

    mask = mask.resize((W, 231), Image.LANCZOS)
    layer = Image.new('RGBA', (W, 231), PINK)
    layer.putalpha(mask)
    canvas.alpha_composite(layer)
    canvas.save(out_path)
    print('saved', out_path, canvas.size)


build(sys.argv[1] if len(sys.argv) > 1 else 'somit_wordmark.png')
