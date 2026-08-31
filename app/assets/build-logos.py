"""모잇 로고 3종 생성기 — 글자는 '배달의민족 주아(BM Jua)' 로 조판한다.

옛 '소개팅모아' 글자를 잘라 붙여 '잇' 을 만드는 방식은 균형이 안 맞아 폐기했다
(2026-08-31 오너 판단). 이제 글자는 폰트로 짜고, 하트만 원본을 그대로 쓴다.

RATIO = 글자 높이 / 하트 높이(231). 오너 지시로 0.90.
TRACK = 자간(px, 300pt 기준). 음수면 좁아진다.
출력 후 찍히는 상수들을 TopBar/_layout/onboarding/settings 에 반영할 것.
"""
from PIL import Image, ImageDraw, ImageFont
import sys

SRC = 'orig_wordmark.png'                 # 하트 원본이 들어 있는 옛 워드마크
FONT = '/System/Library/AssetsV2/com_apple_MobileAsset_Font8/b37171b0cb7d2044e39dd8001c23a0e540f91207.asset/AssetData/BMJua-Regular.otf'
PINK = (234, 100, 145, 255)               # 옛 워드마크와 같은 분홍
RATIO = float(sys.argv[1]) if len(sys.argv) > 1 else 0.90
TRACK = -6

src = Image.open(SRC).convert('RGBA')


def letters_block(text='모잇'):
    f = ImageFont.truetype(FONT, 300)
    t = Image.new('RGBA', (1600, 700), (0, 0, 0, 0))
    d = ImageDraw.Draw(t)
    x = 0
    for ch in text:
        d.text((x, 150), ch, font=f, fill=PINK)
        x += d.textlength(ch, font=f) + TRACK
    return t.crop(t.getbbox())


BLOCK = letters_block()
def letters(h):
    return BLOCK.resize((round(BLOCK.width * h / BLOCK.height), h), Image.LANCZOS)


def build(assets='/Users/ourmine/dev/sodate/app/assets/',
          stack_ref='logo-stack-somit-trim.png', splash_ref='splash-icon-somit.png'):
    heart = src.crop((0, 0, 272, 231))
    H = round(231 * RATIO)

    t = letters(H); X = 258 + 36; W = X + t.width
    wm = Image.new('RGBA', (W, 231), (0, 0, 0, 0))
    wm.alpha_composite(heart, (0, 0)); wm.alpha_composite(t, (X, (231 - H) // 2))
    wm.save(assets + 'logo-wordmark.png')
    print(f'워드마크 {wm.size} → TopBar logoWordmark width = {round(W * 24 / 231)}')

    base = Image.open(stack_ref).convert('RGBA')
    TH = round(174 * H / 159); t2 = letters(TH); CW = max(base.width, t2.width)
    st = Image.new('RGBA', (CW, 381 + 89 + TH), (0, 0, 0, 0))
    st.alpha_composite(base.crop((0, 0, base.width, 381)), ((CW - base.width) // 2, 0))
    st.alpha_composite(t2, ((CW - t2.width) // 2, 381 + 89))
    st = st.crop(st.getbbox()); st.save(assets + 'logo-stack.png')
    print(f'세로형 {st.size} → 높이비 ({st.height} / {st.width})')

    hs = Image.open(splash_ref).convert('RGBA').crop((347, 263, 684, 557))
    TH2 = round(135 * H / 159); t3 = letters(TH2)
    cw = max(hs.width, t3.width); ch = hs.height + 69 + TH2
    blk = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
    blk.alpha_composite(hs, ((cw - hs.width) // 2, 0))
    blk.alpha_composite(t3, ((cw - t3.width) // 2, hs.height + 69))
    sp = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    sp.alpha_composite(blk, ((1024 - cw) // 2, (1024 - ch) // 2))
    sp.save(assets + 'splash-icon.png')
    b = sp.getbbox(); print(f'스플래시 내용폭 {(b[2]-b[0])/1024:.4f} → SPLASH_LOGO_W 배율')


if __name__ == '__main__':
    build()
