"""보안 유틸리티 — URL 화이트리스트 검증 및 텍스트 sanitize"""
import re
from urllib.parse import urlparse
from typing import Optional

# 크롤링 허용 도메인 화이트리스트
ALLOWED_DOMAINS: set[str] = {
    'lovematching.kr',
    'www.lovematching.kr',
    'yeonin.co.kr',
    'www.yeonin.co.kr',
    'emotional0ranges.com',
    'www.emotional0ranges.com',
    'frip.co.kr',
    'www.frip.co.kr',
    'gql.frip.co.kr',
    'munto.kr',
    'www.munto.kr',
    'somoim.co.kr',
    'www.somoim.co.kr',
    'modparty.co.kr',
    'www.modparty.co.kr',
    'solo-off.com',
    'www.solo-off.com',
    'talkblossom.co.kr',
    'www.talkblossom.co.kr',
    'lovecasting.co.kr',
    'www.lovecasting.co.kr',
    'yeongyul.com',
    'www.yeongyul.com',
    'inssumparty.co.kr',
    'www.inssumparty.co.kr',
    '2yeonsi.com',
    'www.2yeonsi.com',
    'seolrem1.com',
    'www.seolrem1.com',
    'secretsalon.co.kr',
    'www.secretsalon.co.kr',
    'flipo.co.kr',
    'www.flipo.co.kr',
    'lovecommunity.imweb.me',
}

# 이벤트 source_url로 허용할 도메인 (아웃링크 대상)
OUTLINK_ALLOWED_DOMAINS: set[str] = ALLOWED_DOMAINS | {
    'booking.naver.com',
    'toss.im',
}

# 개인정보성 패턴 — 크롤링 금지
_PII_PATTERNS = [
    re.compile(r'\d{3}-\d{3,4}-\d{4}'),   # 전화번호
    re.compile(r'[가-힣]{2,4}\s*\d{6}'),   # 이름+주민번호 형태
    re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'),  # 이메일
]

# HTML 태그 제거용
_HTML_TAG_RE = re.compile(r'<[^>]+>')
# 과도한 공백 제거
_WHITESPACE_RE = re.compile(r'\s+')


def is_allowed_crawl_url(url: str) -> bool:
    """크롤링 대상 URL이 허용된 도메인인지 확인"""
    try:
        parsed = urlparse(url)
        return parsed.netloc in ALLOWED_DOMAINS
    except Exception:
        return False


def is_allowed_source_url(url: str) -> bool:
    """이벤트 source_url(아웃링크)이 허용된 도메인인지 확인"""
    try:
        parsed = urlparse(url)
        return parsed.netloc in OUTLINK_ALLOWED_DOMAINS
    except Exception:
        return False


def sanitize_text(text: Optional[str], max_length: int = 1000) -> Optional[str]:
    """HTML 제거, 공백 정리, 길이 제한 적용"""
    if not text:
        return None
    cleaned = _HTML_TAG_RE.sub(' ', text)
    cleaned = _WHITESPACE_RE.sub(' ', cleaned).strip()
    if len(cleaned) > max_length:
        cleaned = cleaned[:max_length] + '...'
    return cleaned if cleaned else None


def sanitize_url(url: Optional[str], base_url: str = '') -> Optional[str]:
    """URL 유효성 확인 후 반환 (javascript:, data: 등 위험 scheme 제거)"""
    if not url:
        return None
    url = url.strip()
    if url.startswith(('javascript:', 'data:', 'vbscript:')):
        return None
    if url.startswith('//'):
        url = 'https:' + url
    if url.startswith('/') and base_url:
        from urllib.parse import urljoin
        url = urljoin(base_url, url)
    if not url.startswith(('http://', 'https://')):
        return None
    return url


def contains_pii(text: str) -> bool:
    """텍스트에 개인정보(전화번호, 이메일 등)가 포함되어 있는지 확인"""
    for pattern in _PII_PATTERNS:
        if pattern.search(text):
            return True
    return False


_ALLOWED_IMAGE_EXTS = {'jpg', 'jpeg', 'png', 'webp', 'gif'}


def is_valid_image_url(url: Optional[str]) -> bool:
    """이미지 URL 유효성 검사 (http/https + 허용 확장자)"""
    if not url:
        return False
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ('http', 'https'):
            return False
        ext = parsed.path.lower().rsplit('.', 1)[-1]
        return ext in _ALLOWED_IMAGE_EXTS
    except Exception:
        return False
