"""'모잇' 워드마크 — 원본 '소개팅모아' 글자를 그대로 잘라 붙여 만든다(오너 지시).

  모  : 원본 '모' 를 통째로 복사
  잇  : ㅇ = 원본 '아' 의 ㅇ 을 9분할로 줄임(획 두께 보존)
        ㅣ = 원본 '팅' 의 ㅣ 그대로
        ㅅ = 원본 '소' 의 ㅅ — 받침 자리(57 높이)에 맞춰 줄이면 획이 얇아지므로
             줄인 뒤 팽창(MaxFilter)으로 원래 획 두께를 되살린다
받침 음절의 뼈대(초성 0..90 / ㅣ 105..136 / 받침 11..135)는 원본 '팅' 에서 실측한 값.
"""
from PIL import Image, ImageFilter
import numpy as np

SRC = 'orig_wordmark.png'
src = Image.open(SRC).convert('RGBA')


def nine_slice(img, cols, rows, out_w, out_h):
    lw, mw, rw = cols; th, mh, bh = rows
    nmw, nmh = out_w - lw - rw, out_h - th - bh
    out = Image.new('RGBA', (out_w, out_h), (0, 0, 0, 0)); y = 0
    for (y0, h, nh) in ((0, th, th), (th, mh, nmh), (th + mh, bh, bh)):
        x = 0
        for (x0, w, nw) in ((0, lw, lw), (lw, mw, nmw), (lw + mw, rw, rw)):
            p = img.crop((x0, y0, x0 + w, y0 + h))
            if (nw, nh) != (w, h): p = p.resize((max(nw, 1), max(nh, 1)), Image.NEAREST)
            if nw > 0 and nh > 0: out.alpha_composite(p, (x, y))
            x += nw
        y += nh
    return out


def alpha_only(img):
    """색을 브랜드 핑크로 통일한 알파 이미지"""
    a = np.array(img)
    a[:, :, 0], a[:, :, 1], a[:, :, 2] = 234, 100, 145
    return Image.fromarray(a, 'RGBA')


def build_it(ieung_w=88, ieung_h=52, i_x=104, i_h=58, sio_top=96, sio_w=126, sio_h=98):
    """'잇' — 원본 글자 조각만 써서 만든다. 크기 조절은 전부 9분할(가운데 직선 구간만
    잘라내기)로 해서 획 두께와 곡선이 원본 그대로 남는다.

      ㅇ : '팅'의 받침 ㅇ(가로로 긴 스타디움)을 가로만 줄여 씀
      ㅣ : '팅'의 ㅣ 를 세로만 줄여 씀
      ㅅ : '소'의 ㅅ 을 세로(다리 부분)만 줄여 씀 — 아치 곡선은 손대지 않는다
           (그냥 축소하면 획이 얇아지고, 팽창으로 되살리면 아치 구멍이 메워진다)
    """
    g = Image.new('RGBA', (154, 231), (0, 0, 0, 0))

    # ㅇ : 팅의 받침 ㅇ (x604..729, y137..195 = 125x58) → 가로만 88 로
    ieung = nine_slice(src.crop((604, 137, 730, 196)), (40, 45, 41), (20, 19, 20), ieung_w, ieung_h)
    g.alpha_composite(ieung, (0, 38))

    # ㅣ : 팅의 ㅣ (31x94) → 세로만 72 로 (위 20 / 가운데 / 아래 20)
    i_bar = nine_slice(src.crop((698, 36, 729, 130)), (10, 11, 10), (20, 54, 20), 31, i_h)
    g.alpha_composite(i_bar, (i_x, 34))

    # ㅅ : 소의 ㅅ (x292..418, y38..141 = 126x103). 행 분할 = 바+아치 62 / 다리 41
    # ⚠️ '소'의 ㅅ 아래에는 ㅗ 의 세로 기둥이 겹쳐 있다(x342..372, y120 아래).
    #    그대로 잘라 쓰면 아치 안쪽에 네모 조각이 남는다 — 먼저 지운다.
    siot_src = src.crop((292, 38, 418, 141)).copy()
    from PIL import ImageDraw as _D
    _D.Draw(siot_src).rectangle([49, 80, 82, 103], fill=(0, 0, 0, 0))
    siot = nine_slice(siot_src, (43, 32, 46), (62, 25, 16), sio_w, sio_h)
    g.alpha_composite(siot, (11, sio_top))
    return g


def build(out_path, letter_h=None):
    heart = src.crop((0, 0, 272, 231))
    mo = src.crop((745, 0, 899, 231))       # '모' 통째로
    it = build_it()
    X = 292                                  # 원본에서 글자가 시작하던 x
    W = X + 150 + it.width
    c = Image.new('RGBA', (W, 231), (0, 0, 0, 0))
    c.alpha_composite(heart, (0, 0))
    c.alpha_composite(mo, (X, 0))
    c.alpha_composite(it, (X + 150, 0))
    c = c.crop((0, 0, c.getbbox()[2], 231))
    c.save(out_path)
    print(out_path, c.size, '→ 톱바 폭(높이24)', round(c.width * 24 / 231))
    return c


if __name__ == '__main__':
    build('moit_orig_wm.png')
