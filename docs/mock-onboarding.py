"""온보딩 화면 목업 — 실제 코드의 수치·색·아이콘을 그대로 써서 그린다.
(온보딩은 한 번만 뜨는 화면이라 기기에서 다시 보기 어렵다. 문구·배치 확인용)"""
from PIL import Image, ImageDraw, ImageFont
import json, re, pathlib

ROOT = '/Users/ourmine/dev/sodate/app/'
IONI_TTF = ROOT + 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf'
IONI_MAP = json.load(open(ROOT + 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json'))
PRE = '/Users/ourmine/Library/Fonts/Pretendard-%s.otf'

# 실제 화면 값(LightColors)
BG, TEXT, SUB, PRIMARY, BORDER = '#F5F5F5', '#111111', '#555555', '#FF6B9D', '#E0E0E0'
W, H = 390, 844                      # iPhone 기준 논리 픽셀
S = 2                                # 2배로 그려 선명하게

src = pathlib.Path(ROOT + 'app/onboarding.tsx').read_text(encoding='utf-8')
block = src[src.index('const SLIDES'):src.index(']\n\nexport default')]
slides = []
for m in re.finditer(r"\{\s*icon: '([^']+)',\s*color: '([^']+)',\s*title: '([^']+)',\s*(logo: true,\s*)?subtitle: '([^']*)',", block):
    slides.append(dict(icon=m.group(1), color=m.group(2), title=m.group(3),
                       logo=bool(m.group(4)), subtitle=m.group(5).replace('\\n', '\n')))

def draw_slide(sl, idx, total):
    im = Image.new('RGB', (W * S, H * S), BG)
    d = ImageDraw.Draw(im)
    f_title = ImageFont.truetype(PRE % 'ExtraBold', 28 * S)
    f_sub = ImageFont.truetype(PRE % 'Regular', 16 * S)
    f_skip = ImageFont.truetype(PRE % 'Regular', 14 * S)
    f_btn = ImageFont.truetype(PRE % 'Bold', 16 * S)

    if idx < total - 1:                                   # 건너뛰기
        d.text((W * S - 24 * S, 68 * S), '건너뛰기', font=f_skip, fill='#999999', anchor='ra')

    cy = H * S // 2 - 60 * S
    if sl['logo']:
        logo = Image.open(ROOT + 'assets/logo-stack.png').convert('RGBA')
        lh = round(200 * (698 / 821)) * S; lw = round(logo.width * lh / logo.height)
        logo = logo.resize((lw, lh), Image.LANCZOS)
        im.paste(logo, ((W * S - lw) // 2, cy - lh // 2), logo)
        bottom = cy + lh // 2 + 32 * S
    else:
        r = 60 * S
        d.ellipse([W * S // 2 - r, cy - r, W * S // 2 + r, cy + r], fill=sl['color'] + '22' if False else _mix(sl['color']))
        gf = ImageFont.truetype(IONI_TTF, 60 * S)
        ch = chr(IONI_MAP[sl['icon']])
        d.text((W * S // 2, cy), ch, font=gf, fill=sl['color'], anchor='mm')
        d.text((W * S // 2, cy + r + 40 * S), sl['title'], font=f_title, fill=TEXT, anchor='ma')
        bottom = cy + r + 40 * S + 34 * S + 16 * S

    y = bottom
    for line in sl['subtitle'].split('\n'):
        d.text((W * S // 2, y), line, font=f_sub, fill=SUB, anchor='ma')
        y += 24 * S

    dy = H * S - (32 + 48 + 52 + 24) * S                   # 도트
    tw = total * 8 * S + (total - 1) * 8 * S + 16 * S
    x = (W * S - tw) // 2
    for i in range(total):
        w = 24 * S if i == idx else 8 * S
        d.rounded_rectangle([x, dy, x + w, dy + 8 * S], radius=4 * S, fill=PRIMARY if i == idx else BORDER)
        x += w + 8 * S

    by = H * S - (48 + 52) * S                              # 버튼
    d.rounded_rectangle([32 * S, by, (W - 32) * S, by + 52 * S], radius=14 * S, fill=PRIMARY)
    d.text((W * S // 2, by + 26 * S), '시작하기' if idx == total - 1 else '다음',
           font=f_btn, fill='white', anchor='mm')
    return im.resize((W, H), Image.LANCZOS)


def _mix(hexc, a=0.13):
    c = tuple(int(hexc[i:i+2], 16) for i in (1, 3, 5))
    return tuple(round(v * a + 245 * (1 - a)) for v in c)


sheet = Image.new('RGB', (W * len(slides) + 20 * (len(slides) + 1), H + 40), '#DDDDDD')
for i, sl in enumerate(slides):
    sheet.paste(draw_slide(sl, i, len(slides)), (20 + i * (W + 20), 20))
sheet.save('onboarding_mock.png')
print('슬라이드', len(slides), '장 →', sheet.size)
