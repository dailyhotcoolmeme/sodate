"""스토어 스크린샷 생성 — 오너가 안드로이드 실기기에서 찍은 원본으로 만든다.

안드로이드(Play): 원본 그대로 PNG 변환(1080x2111, 비율 제한 없음).
iOS: 애플이 요구하는 정확한 픽셀 크기로 맞춘다.
  6.9" = 1290x2796 / 6.5" = 1242x2688
  원본 비율(0.512)이 애플 비율(0.461)보다 세로가 짧아, 가로를 채우면 세로가 모자란다.
  → 가로를 맞춘 뒤 위아래를 **그 화면 자체의 가장자리 색**으로 채운다.
    (톱바/탭바 배경색이라 이어붙인 티가 안 난다. 잘라내면 내용이 날아간다.)
"""
from PIL import Image
import pathlib

SRC = sorted(pathlib.Path('shots').glob('*.jpg'))
OUT = pathlib.Path('/Users/ourmine/dev/sodate/docs/store-assets')

def edge_color(im, top=True):
    row = 2 if top else im.height - 3
    px = [im.getpixel((x, row)) for x in range(0, im.width, max(1, im.width // 40))]
    return tuple(sum(c[i] for c in px) // len(px) for i in range(3))

def fit(im, W, H):
    w = W
    h = round(im.height * W / im.width)
    im2 = im.resize((w, h), Image.LANCZOS)
    if h >= H:                       # 세로가 남으면 가운데 기준으로 자른다
        y = (h - H) // 2
        return im2.crop((0, y, W, y + H))
    canvas = Image.new('RGB', (W, H))
    top_c, bot_c = edge_color(im2, True), edge_color(im2, False)
    pad = H - h
    up = pad // 2
    canvas.paste(Image.new('RGB', (W, up), top_c), (0, 0))
    canvas.paste(Image.new('RGB', (W, pad - up), bot_c), (0, up + h))
    canvas.paste(im2, (0, up))
    return canvas

targets = {'android': None, 'ios-6.9': (1290, 2796), 'ios-6.5': (1242, 2688)}
for name, size in targets.items():
    d = OUT / name
    for old in d.glob('*.png'):
        old.unlink()
    for i, f in enumerate(SRC, 1):
        im = Image.open(f).convert('RGB')
        out = im if size is None else fit(im, *size)
        p = d / f'{i:02d}.png'
        out.save(p)
        print(f'{p.relative_to(OUT.parent.parent)} {out.size}')
