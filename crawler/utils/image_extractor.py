"""이미지 URL 추출 유틸리티"""
import re
from urllib.parse import urljoin
from typing import Optional
from bs4 import BeautifulSoup, Tag


def extract_images(soup: BeautifulSoup, base_url: str, limit: int = 5) -> list[str]:
    """BeautifulSoup 객체에서 이미지 URL을 추출하여 최대 limit개 반환"""
    urls: list[str] = []

    for img in soup.find_all('img'):
        src = _get_img_src(img)
        if not src:
            continue
        abs_url = _to_absolute(src, base_url)
        if abs_url and _is_valid_image_url(abs_url):
            urls.append(abs_url)
        if len(urls) >= limit:
            break

    return urls


def extract_og_image(soup: BeautifulSoup) -> Optional[str]:
    """og:image 메타 태그에서 이미지 URL 추출"""
    og = soup.find('meta', property='og:image')
    if og and og.get('content'):
        return og['content']
    return None


def _get_img_src(img: Tag) -> Optional[str]:
    """lazy-load 속성 포함한 src 추출"""
    for attr in ('src', 'data-src', 'data-lazy-src', 'data-original'):
        val = img.get(attr)
        if val and not val.startswith('data:'):
            return val.strip()
    return None


def _to_absolute(url: str, base_url: str) -> Optional[str]:
    if not url:
        return None
    if url.startswith('http://') or url.startswith('https://'):
        return url
    if url.startswith('//'):
        return 'https:' + url
    return urljoin(base_url, url)


def _is_valid_image_url(url: str) -> bool:
    """이미지 URL 유효성 검사 (확장자 또는 일반적인 이미지 경로)"""
    lower = url.lower()
    image_exts = ('.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif')
    if any(lower.split('?')[0].endswith(ext) for ext in image_exts):
        return True
    # 확장자 없어도 이미지 CDN 경로면 허용
    image_patterns = ['cdn', 'image', 'img', 'thumb', 'photo', 'media', 'upload']
    return any(p in lower for p in image_patterns)
