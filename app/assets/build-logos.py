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


def build_it(ieung_w=90, ieung_h=74, i_x=106, i_h=84, sio_h=72, sio_y=122):
    """'잇' — 원본 글자 조각만 써서 만든다.

      ㅇ : '팅'의 받침 ㅇ(가로로 긴 스타디움) — 9분할로 가로·세로만 줄여 획 두께 유지
      ㅣ : '팅'의 ㅣ — 9분할로 세로만 줄임
      ㅅ : '소'의 ㅅ — **모양 그대로 비율을 유지한 채 통째로 축소**한다
           (9분할로 다리만 줄이면 78 아래로는 아치 구멍이 무너진다. 오너 지시대로
            '이'를 크게 두고 받침은 작게 가려면 균등 축소가 맞다 — 실제 폰트도
            받침을 작게 그린다)
    """
    g = Image.new('RGBA', (154, 231), (0, 0, 0, 0))

    ieung = nine_slice(src.crop((604, 137, 730, 196)), (40, 45, 41), (20, 19, 20), ieung_w, ieung_h)
    g.alpha_composite(ieung, (0, 36 + (i_h - ieung_h) // 2))

    i_bar = nine_slice(src.crop((698, 36, 729, 130)), (10, 11, 10), (20, 54, 20), 31, i_h)
    g.alpha_composite(i_bar, (i_x, 34))

    # ⚠️ '소'의 ㅅ 아래에는 ㅗ 의 세로 기둥이 겹쳐 있다 — 먼저 지우고 잘라 쓴다.
    siot_src = src.crop((292, 38, 418, 141)).copy()
    from PIL import ImageDraw as _D
    _D.Draw(siot_src).rectangle([49, 80, 82, 103], fill=(0, 0, 0, 0))
    sw = round(siot_src.width * sio_h / siot_src.height)
    siot = siot_src.resize((sw, sio_h), Image.LANCZOS)
    g.alpha_composite(siot, ((i_x + 31 - sw) // 2 + 6, sio_y))
    return g


def build(assets_dir='/Users/ourmine/dev/sodate/app/assets/', letter_ratio=0.90, stack_ref=None, splash_ref=None):
    """로고 3종(가로형·세로형·스플래시)을 한 번에 다시 만든다.
    letter_ratio = 글자 높이 / 하트 높이(231). 오너 지시로 0.90.
    """
    heart = src.crop((0, 0, 272, 231))
    mo = src.crop((745, 0, 899, 231))
    block = Image.new('RGBA', (320, 231), (0, 0, 0, 0))
    block.alpha_composite(mo, (0, 0))
    block.alpha_composite(build_it(), (150, 0))
    block = block.crop(block.getbbox())

    def letters(h):
        return block.resize((round(block.width * h / block.height), h), Image.LANCZOS)

    H = round(231 * letter_ratio)
    t = letters(H); X = 258 + 36; W = X + t.width
    wm = Image.new('RGBA', (W, 231), (0, 0, 0, 0))
    wm.alpha_composite(heart, (0, 0)); wm.alpha_composite(t, (X, (231 - H) // 2))
    wm.save(assets_dir + 'logo-wordmark.png')
    print(f'워드마크 {wm.size} → TopBar logoWordmark width = {round(W * 24 / 231)}')

    if stack_ref:
        base = Image.open(stack_ref).convert('RGBA')      # 하트만 있는 세로형 원본(0..380)
        TH = round(174 * H / 159); t2 = letters(TH); CW = max(base.width, t2.width)
        st = Image.new('RGBA', (CW, 381 + 89 + TH), (0, 0, 0, 0))
        st.alpha_composite(base.crop((0, 0, base.width, 381)), ((CW - base.width) // 2, 0))
        st.alpha_composite(t2, ((CW - t2.width) // 2, 381 + 89))
        st = st.crop(st.getbbox()); st.save(assets_dir + 'logo-stack.png')
        print(f'세로형 {st.size} → 높이비 ({st.height} / {st.width})')

    if splash_ref:
        hs = Image.open(splash_ref).convert('RGBA').crop((347, 263, 684, 557))
        TH2 = round(135 * H / 159); t3 = letters(TH2)
        cw = max(hs.width, t3.width); ch = hs.height + 69 + TH2
        blk = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
        blk.alpha_composite(hs, ((cw - hs.width) // 2, 0))
        blk.alpha_composite(t3, ((cw - t3.width) // 2, hs.height + 69))
        sp = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
        sp.alpha_composite(blk, ((1024 - cw) // 2, (1024 - ch) // 2))
        sp.save(assets_dir + 'splash-icon.png')
        b = sp.getbbox(); print(f'스플래시 내용폭 {(b[2]-b[0])/1024:.4f} → SPLASH_LOGO_W 배율')


if __name__ == '__main__':
    build(stack_ref='logo-stack-somit-trim.png', splash_ref='splash-icon-somit.png')
