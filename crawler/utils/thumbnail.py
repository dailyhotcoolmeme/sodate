"""피드 썸네일을 작게 다시 구워 R2에 재호스팅한다.

## 왜 필요한가 (2026-08-19 실측)

오너 제보 "모임 피드 불러올 때 오래 걸린다"를 재보니 서버 쿼리는 멀쩡했다
(60건 0.24~0.47초, JSON 53KB). 진짜 원인은 **첫 화면 60카드의 썸네일 합계 19.26MB**.

| CDN                  | 카드 | 합계    | 평균   | 최대   |
|----------------------|------|---------|--------|--------|
| cdn.imweb.me         | 18   | 16.3MB  | 907KB  | 1.4MB  |
| images.munto.kr      | 14   |  2.2MB  | 160KB  | 603KB  |
| res.cloudinary.com   | 23   |  1.1MB  |  50KB  | 116KB  |

카드는 200pt 높이인데 imweb 쪽은 1024x1310 원본 PNG를 그대로 준다. 반면 프립은
URL에 `w_500,q_auto,f_auto` 변환이 박혀 있어 이미 50KB다 — **정답이 데이터 안에 있었다.**

imweb·munto CDN은 리사이즈 파라미터를 지원하지 않는다(`?w=760`, `?width=760`,
`?thumbnail=760x420`, `?f=webp` 전부 원본 그대로 반환하는 것을 실측 확인). 그래서
우리가 직접 받아서 다시 굽는다. 실측 감소율:

    1392KB -> 19KB (98.6%)  /  1124KB -> 42KB (96.2%)
    1063KB -> 74KB (93.1%)  /   97KB -> 21KB (78.7%)
    => 첫 화면 19.26MB -> 약 0.82MB (96% 감소)

## 설계 원칙

- **실패해도 크롤을 절대 안 막는다.** 무슨 일이 생기든 원본 URL을 그대로 돌려준다.
  썸네일이 조금 큰 것보다 일정이 안 들어오는 게 훨씬 나쁘다.
- **키는 원본 URL의 해시**라서 같은 원본은 늘 같은 키가 된다. 재크롤 때 R2에 이미
  있으면 내려받지도 않고 그 URL만 돌려준다(HEAD 한 번). 업체가 이미지를 바꾸면
  URL도 바뀌는 게 보통이라 이 방식으로 충분하다.
- **이미 최적화된 건 건드리지 않는다** — 우리 R2, 그리고 변환 파라미터가 박힌
  cloudinary URL(프립)은 그대로 통과시킨다. 괜히 다시 구우면 화질만 손해다.
"""
import hashlib
import io
import os
import re
from typing import Optional

import httpx

from utils.logger import get_logger
from utils.r2_client import PUBLIC_MEDIA_BASE, object_exists, upload_bytes

logger = get_logger('thumbnail')

# 카드는 폭 361pt · 높이 200pt(@3x ≈ 1083x600). 긴 변 900이면 3배 화면에서도 충분하고,
# 여기서 더 키워봐야 눈에 띄는 차이 없이 용량만 는다.
MAX_EDGE = 900
WEBP_QUALITY = 76
# 원본이 이보다 크면 아예 안 받는다(스캔 원고 같은 초대형 파일 방어).
MAX_SOURCE_BYTES = 25 * 1024 * 1024
DOWNLOAD_TIMEOUT = 20

# 이미 작게 서빙되는 것들 — 다시 구울 이유가 없다.
#   · 우리 R2: 이 함수가 만든 결과거나 우리가 올린 로고
#   · cloudinary 변환 URL: 프립. `/upload/c_fill,f_auto,h_500,q_auto,w_500/` 처럼
#     변환 세그먼트가 들어 있으면 이미 리사이즈된 것이다(실측 평균 50KB).
_CLOUDINARY_TRANSFORMED = re.compile(r'/upload/[^/]*[whq]_\d+[^/]*/')


def _already_small(url: str) -> bool:
    if url.startswith(f'{PUBLIC_MEDIA_BASE}/media/'):
        return True
    if 'res.cloudinary.com' in url and _CLOUDINARY_TRANSFORMED.search(url):
        return True
    return False


def _key_for(url: str) -> str:
    return f'thumbs/{hashlib.sha1(url.encode("utf-8")).hexdigest()[:24]}.webp'


def _shrink(raw: bytes) -> Optional[bytes]:
    """원본 바이트 -> 900px WebP 바이트. 못 열면 None."""
    from PIL import Image, ImageOps

    try:
        im = Image.open(io.BytesIO(raw))
        # EXIF 방향을 실제 픽셀로 적용해두지 않으면 다시 구울 때 옆으로 눕는다.
        im = ImageOps.exif_transpose(im)
        # 애니메이션 GIF/WebP는 첫 프레임만 쓴다(피드 썸네일은 정지 이미지로 충분).
        im = im.convert('RGB')
        w, h = im.size
        scale = MAX_EDGE / max(w, h)
        if scale < 1:
            im = im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, 'WEBP', quality=WEBP_QUALITY, method=6)
        return buf.getvalue()
    except Exception as e:
        logger.warning(f'썸네일 디코드/인코드 실패: {e}')
        return None


def optimize_thumbnail(url: Optional[str]) -> Optional[str]:
    """원본 썸네일 URL -> 작게 구운 R2 URL. 어떤 실패든 원본 URL을 그대로 돌려준다."""
    if not url or not url.startswith('http'):
        return url
    if _already_small(url):
        return url

    key = _key_for(url)
    public = f'{PUBLIC_MEDIA_BASE}/media/{key}'

    try:
        # 이미 구워둔 게 있으면 내려받지 않는다 — 재크롤에서 이 경로가 대부분이다.
        if object_exists(key):
            return public
    except Exception as e:
        # R2 조회가 안 되면 재호스팅 자체를 포기한다(원본으로 계속 서비스).
        logger.warning(f'R2 조회 실패, 원본 유지 ({url[:80]}): {e}')
        return url

    try:
        with httpx.Client(timeout=DOWNLOAD_TIMEOUT, follow_redirects=True) as c:
            r = c.get(url, headers={'User-Agent': 'Mozilla/5.0'})
            r.raise_for_status()
            raw = r.content
    except Exception as e:
        logger.warning(f'썸네일 내려받기 실패, 원본 유지 ({url[:80]}): {e}')
        return url

    if len(raw) > MAX_SOURCE_BYTES:
        logger.warning(f'썸네일 원본이 너무 큼({len(raw)/1024/1024:.1f}MB), 원본 유지: {url[:80]}')
        return url

    small = _shrink(raw)
    if small is None:
        return url
    # 다시 구웠는데 더 커지는 경우(이미 잘 압축된 작은 JPG 등)는 원본이 낫다.
    if len(small) >= len(raw):
        return url

    try:
        upload_bytes(key, small, 'image/webp')
    except Exception as e:
        logger.warning(f'썸네일 업로드 실패, 원본 유지 ({url[:80]}): {e}')
        return url

    logger.info(f'썸네일 재호스팅 {len(raw)//1024}KB -> {len(small)//1024}KB  {url[:70]}')
    return public


def optimize_thumbnails(urls: Optional[list]) -> Optional[list]:
    """썸네일 목록 전체를 최적화한다. 원본 순서를 그대로 유지한다."""
    if not urls:
        return urls
    # R2 자격증명이 없는 환경(로컬 테스트 등)에서는 통째로 건너뛴다.
    if not os.environ.get('R2_ENDPOINT'):
        return urls
    return [optimize_thumbnail(u) or u for u in urls]
