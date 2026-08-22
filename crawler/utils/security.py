"""보안 유틸리티 — URL 화이트리스트 검증 및 텍스트 sanitize"""
import re
from urllib.parse import urlparse
from typing import Optional

# 크롤링 허용 도메인 화이트리스트
ALLOWED_DOMAINS: set[str] = {
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
    'app.notion.com',                 # 파이낸스라운지: 별도 사이트 없이 노션 페이지로 일정 공지
}

# 이벤트 source_url로 허용할 도메인 (아웃링크 대상)
OUTLINK_ALLOWED_DOMAINS: set[str] = ALLOWED_DOMAINS | {
    'booking.naver.com',
    'toss.im',
    'www.instagram.com',              # 파이낸스라운지·오프더레코드: 신청은 인스타 DM(사이트 없음)
    'docs.google.com',                 # 유니브리지소셜: 신청은 바이오의 구글폼
    'forms.gle',
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


def tidy_socialing_desc(text: Optional[str], max_length: int = 6000) -> Optional[str]:
    """소셜링 상세 설명 정리 — sanitize_text 와 달리 **줄바꿈을 보존**한다(소개팅 초기의
    '줄바꿈 없이 빼곡' 문제 방지). HTML 제거 + 깨진 이미지 자리(￼) 제거 + 장식선(¸.•´¨* 류
    한글/영숫자 없는 특수문자 라인) 제거 + 연속 빈 줄 축소. 문토·동행클럽 설명에 쓴다."""
    if not text:
        return None
    t = _HTML_TAG_RE.sub(' ', text).replace('￼', '')  # ￼ = U+FFFC
    lines = []
    for ln in t.split('\n'):
        s = ln.rstrip()
        stripped = s.strip()
        # 문자(한글/영숫자)가 하나도 없는 라인(장식선 ¸.•´¨*·단독 불릿·이모지만) → 버림
        if stripped and not re.search(r'[가-힣A-Za-z0-9]', stripped):
            continue
        # 줄 안의 가로 공백만 단일화(줄바꿈은 유지)
        lines.append(re.sub(r'[ \t]+', ' ', s))
    t = '\n'.join(lines)
    t = re.sub(r'[ \t]+\n', '\n', t)
    t = re.sub(r'\n{3,}', '\n\n', t).strip()
    if len(t) > max_length:
        t = t[:max_length] + '...'
    return t or None


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


# 본문(description) 추출 시 제외할 보일러플레이트 라인 키워드
# (네비게이션/푸터/공용 UI/쇼핑몰 안내 — 이벤트 특색과 무관)
_BOILERPLATE_KEYWORDS = (
    '로그인', '회원가입', '장바구니', '마이페이지', '위시리스트', '관심상품',
    '고객센터', '고객상담', '이용약관', '개인정보', '주문조회', '최근 본',
    '최근본', '공지사항', '카카오톡', '카카오 채널', '카카오채널', '전체메뉴',
    '카테고리', '맨위로', '홈으로', '적립금', '쿠폰', '리뷰쓰기', '후기작성',
    '배송조회', '반품', '환불', '교환/', '사업자', '통신판매', '대표이사',
    '상호명', '이메일무단수집', '무단수집거부', 'copyright', 'all rights reserved',
    'e-mail', 'menu', 'top',
)


# 날짜 회차 나열(예: "7.10(금) 오후 8시 로테이션 소개팅 C") — 대부분 지난 회차라 설명에서 제거.
# 날짜+시각이 반드시 있어야 매칭되므로 "로테이션 소개팅 A 남:95~" 같은 조건 설명은 보존된다.
_SCHEDULE_TUPLE_RE = re.compile(
    r'\d{1,2}\s*\.\s*\d{1,2}\s*(?:\([일월화수목금토]\))?\s*(?:오전|오후)?\s*\d{1,2}\s*시'
    r'(?:\s*\d{1,2}\s*분)?(?:\s*(?:로테이션\s*)?소개팅\s*[A-Da-d]?)?'
)


def strip_schedule(text: str) -> str:
    """설명에서 날짜 회차 나열만 제거."""
    return _WHITESPACE_RE.sub(' ', _SCHEDULE_TUPLE_RE.sub(' ', text)).strip()


def build_description(text: Optional[str], max_length: int = 6000) -> Optional[str]:
    """페이지 본문 텍스트에서 이벤트 특색이 담긴 설명 라인만 추려 반환.

    - 네비/푸터/쇼핑몰 안내 등 보일러플레이트 라인 제외
    - 한글이 거의 없는(메뉴/숫자/영문 UI) 라인 제외
    - 개인정보 포함 라인 제외
    - 중복 라인 제거 후 max_length(기본 800자)까지 이어붙임
    빈 결과면 None.
    """
    if not text:
        return None
    seen: set[str] = set()
    kept: list[str] = []
    running = 0
    for raw in text.split('\n'):
        line = _WHITESPACE_RE.sub(' ', raw).strip()
        # 날짜 회차 나열 제거(있으면) → 유용한 설명이 길이 제한에 밀려 잘리지 않게
        line = strip_schedule(line)
        if len(line) < 6:  # 너무 짧은 라인(버튼/메뉴 항목) 제외
            continue
        low = line.lower()
        if any(kw in low for kw in _BOILERPLATE_KEYWORDS):
            continue
        # 한글 비중이 낮은 라인(숫자·기호·영문 UI) 제외
        hangul = sum(1 for ch in line if '가' <= ch <= '힣')
        if hangul < 4:
            continue
        if contains_pii(line):
            continue
        if line in seen:
            continue
        seen.add(line)
        kept.append(line)
        running += len(line) + 1
        if running >= max_length:
            break
    if not kept:
        return None
    # 줄바꿈 유지 (sanitize_text는 \n을 공백으로 뭉개므로 사용하지 않음).
    # kept의 각 라인은 이미 내부 공백 정리됨 → \n으로 이어 원본 줄 구조 보존.
    result = '\n'.join(kept)
    if len(result) > max_length:
        result = result[:max_length].rstrip() + '...'
    return result or None


def extract_description_from_soup(soup, max_length: int = 6000) -> Optional[str]:
    """상세 페이지 soup에서 이벤트 설명을 견고하게 추출한다.

    og/meta 요약 + 본문 컨테이너(imweb .detail_detail_wrap / 네이버 에디터 /
    워드프레스 .entry-content 등)를 우선 사용해 리뷰·구매평 영역을 피하고,
    그래도 한글 본문이 부족하면 전체 본문 텍스트로 폴백한다. 결과는 build_description로 정제.
    """
    if soup is None:
        return None
    parts: list[str] = []
    og = soup.find('meta', property='og:description')
    if og and og.get('content'):
        parts.append(og['content'])
    md = soup.find('meta', attrs={'name': 'description'})
    if md and md.get('content'):
        parts.append(md['content'])
    for sel in (
        '.detail_detail_wrap', '.se-main-container', '.se-viewer',
        '.entry-content', '.prd_detail', '#prd_detail', '.shop_view_info',
    ):
        try:
            el = soup.select_one(sel)
        except Exception:
            el = None
        if el:
            parts.append(el.get_text('\n', strip=True))
    combined = '\n'.join(p for p in parts if p)
    # 컨테이너에서 한글 본문을 충분히 못 얻으면 전체 본문으로 폴백
    if sum(1 for ch in combined if '가' <= ch <= '힣') < 20:
        combined = combined + '\n' + soup.get_text('\n', strip=True)
    return build_description(combined, max_length)


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
