"""소밋 로고 3종 생성기 — 하트는 원본 그대로 두고 글자 크기만 바꿔 다시 뽑는다.

RATIO 하나만 고치면 세 자산이 같은 비율로 다시 만들어진다.
  RATIO = 글자 높이 / 하트 높이(231).  '소개팅모아' 때는 0.69 였는데 '소밋'은 두 글자라
  그 비율이면 하트보다 작아 보여 키웠다(2026-08-31 오너 지시 → 0.85 → 0.90).
출력 후 찍히는 상수들을 TopBar/_layout/onboarding/settings 에 그대로 반영할 것.
"""
from PIL import Image
import numpy as np, sys

A = '/Users/ourmine/dev/sodate/app/assets/'
RATIO = float(sys.argv[1]) if len(sys.argv) > 1 else 0.90

orig = Image.open('orig_wordmark.png').convert('RGBA')     # 옛 소개팅모아 워드마크(하트 원본)
T = Image.open('somit_text_raw.png').convert('RGBA')       # 소밋 글자(투명 추출본)
a = np.array(T); a[:, :, 0], a[:, :, 1], a[:, :, 2] = 234, 100, 145   # 브랜드 핑크로 통일
T = Image.fromarray(a, 'RGBA'); T = T.crop(T.getbbox())
def text(h): return T.resize((round(T.width * h / T.height), h), Image.LANCZOS)

H = round(231 * RATIO)

# 1) 가로형(톱바)
t = text(H); X = 258 + 34; W = X + t.width
wm = Image.new('RGBA', (W, 231), (0, 0, 0, 0))
wm.alpha_composite(orig.crop((0, 0, 272, 231)), (0, 0))
wm.alpha_composite(t, (X, (231 - H) // 2))
wm.save(A + 'logo-wordmark.png')

# 2) 세로형(설정·온보딩·JS 스플래시) — 하트 381 + 간격 89 + 글자
stack_src = Image.open('logo-stack-somit-trim.png').convert('RGBA')   # 하트 0..380
TH = round(174 * H / 159)
t2 = text(TH); CW = max(stack_src.width, t2.width)
st = Image.new('RGBA', (CW, 381 + 89 + TH), (0, 0, 0, 0))
st.alpha_composite(stack_src.crop((0, 0, stack_src.width, 381)), ((CW - stack_src.width) // 2, 0))
st.alpha_composite(t2, ((CW - t2.width) // 2, 381 + 89))
st = st.crop(st.getbbox()); st.save(A + 'logo-stack.png')

# 3) 네이티브 스플래시 — 1024 캔버스 가운데
heart_sp = Image.open('splash-icon-somit.png').convert('RGBA').crop((347, 263, 684, 557))
TH2 = round(135 * H / 159); t3 = text(TH2)
cw = max(heart_sp.width, t3.width); ch = heart_sp.height + 69 + TH2
blk = Image.new('RGBA', (cw, ch), (0, 0, 0, 0))
blk.alpha_composite(heart_sp, ((cw - heart_sp.width) // 2, 0))
blk.alpha_composite(t3, ((cw - t3.width) // 2, heart_sp.height + 69))
sp = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
sp.alpha_composite(blk, ((1024 - cw) // 2, (1024 - ch) // 2))
sp.save(A + 'splash-icon.png')
b = sp.getbbox()

print(f'글자/하트 비율 {RATIO:.0%} (글자 높이 {H})')
print(f'  워드마크 {wm.size} → TopBar logoWordmark width = {round(W * 24 / 231)}')
print(f'  세로형   {st.size} → 높이비 ({st.height} / {st.width})')
print(f'  스플래시 내용폭 {(b[2]-b[0])/1024:.4f} → SPLASH_LOGO_W 배율')
