"""탭 아이콘 공통 처리 — 외부 선화(래스터)를 탭바용 PNG 로 만든다.

핵심: **모든 아이콘의 잉크(그림) 세로 높이를 같게** 맞춘다.
아이콘마다 원본 여백이 제각각이라 그냥 정사각형에 담으면 위아래 선이 안 맞는다
(2026-08-31 오너 지적: "위아래 선 높이가 맞아야 한다").
가로가 넘치면 그때만 가로 기준으로 줄인다.
"""
from PIL import Image, ImageFilter
import numpy as np

CANVAS = 256          # 내보낼 정사각 캔버스
INK_H = 0.82          # 잉크가 캔버스 높이에서 차지할 비율 — 모든 아이콘이 이 값으로 통일된다
                      # (가장 옆으로 넓은 아이콘이 캔버스 안에 들어가는 최대치. 더 넓은
                      #  아이콘이 새로 들어오면 이 값을 낮춰 전체를 다시 뽑아야 한다)
INK_W_MAX = 1.0       # 가로 상한(넘치면 그때만 가로 기준으로 줄인다 — 그러면 높이가 어긋난다)
DILATE = 7            # 선 굵히기(작게 줄여도 보이게)


def extract(jpg, box, bg=205.0, fg=90.0):
    """스캔/캡처 이미지에서 선만 알파로 뽑는다(흰 배경·체커보드 제거)."""
    a = np.array(Image.open(jpg).convert('RGB')).astype(float)
    y0, y1, x0, x1 = box
    g = a[y0:y1, x0:x1].mean(axis=2)
    alpha = np.clip((bg - g) / (bg - fg), 0, 1)
    return Image.fromarray((alpha * 255).astype(np.uint8), 'L')


def build(mask, out):
    if DILATE:
        mask = mask.filter(ImageFilter.MaxFilter(DILATE))
    ink = Image.merge('RGBA', [Image.new('L', mask.size, 255)] * 3 + [mask])
    ink = ink.crop(ink.getbbox())
    h = round(CANVAS * INK_H)
    w = round(ink.width * h / ink.height)
    if w > CANVAS * INK_W_MAX:                      # 가로가 넘치면 가로 기준
        w = round(CANVAS * INK_W_MAX)
        h = round(ink.height * w / ink.width)
    ink = ink.resize((w, h), Image.LANCZOS)
    canvas = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(ink, ((CANVAS - w) // 2, (CANVAS - h) // 2))
    canvas.save(out)
    print(f'{out}: 잉크 {w}x{h} / 캔버스 {CANVAS}')
    return canvas
