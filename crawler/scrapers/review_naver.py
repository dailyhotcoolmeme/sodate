"""네이버 블로그 후기 크롤러 — 업체별 블로그 후기 수집"""
import re
import time
import httpx
from bs4 import BeautifulSoup
from datetime import datetime
from typing import Optional

from utils.logger import get_logger
from utils.supabase_client import get_supabase

logger = get_logger('review_naver')

NAVER_BLOG_SEARCH = 'https://search.naver.com/search.naver'

# 업체별 검색 키워드
COMPANY_KEYWORDS = {
    'yeonin': ['연인어때 후기', '연인어때 소개팅 후기'],
    'emotional-orange': ['에모셔널오렌지 후기', '에모셔널 오렌지 소개팅 후기'],
    'frip': ['프립 소개팅 후기', '프립 로테이션 후기'],
    'munto': ['문토 소개팅 후기', '문토 로테이션 후기'],
    'modparty': ['모드파티 후기', '모드파티 소개팅 후기'],
    'lovecasting': ['러브캐스팅 후기', '러브캐스팅 소개팅 후기'],
    'talkblossom': ['토크블라썸 후기', '토크블라썸 소개팅 후기'],
}

HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/124.0.0.0 Safari/537.36'
    ),
    'Accept-Language': 'ko-KR,ko;q=0.9',
}


def canonical_post_url(href: str) -> Optional[str]:
    """실제 '블로그 글' 주소만 정규화해서 반환. 블로그 메인/작성자 링크는 None.
    - blog.naver.com/<id>/<logNo>            → 그대로
    - .../PostView.naver?blogId=x&logNo=123  → blog.naver.com/x/123 로 변환
    - m.blog.naver.com 도 동일 처리
    글 번호(logNo)가 없으면(=메인 주소) None → 후기에서 제외.
    """
    if not href:
        return None
    # PostView 형식: 쿼리스트링에서 blogId + logNo 추출
    m = re.search(r'blogId=([^&]+).*?logNo=(\d+)', href)
    if m:
        return f'https://blog.naver.com/{m.group(1)}/{m.group(2)}'
    # 경로 형식: blog.naver.com/<id>/<숫자>
    base = href.split('?')[0].split('#')[0]
    m = re.search(r'(?:m\.)?blog\.naver\.com/([^/?#]+)/(\d+)', base)
    if m:
        return f'https://blog.naver.com/{m.group(1)}/{m.group(2)}'
    return None


# 검색 결과에서 날짜를 위치로 맞춰 읽다 보면(date_idx) 어긋나 비는 건이 생긴다
# (2026-07-30: 511건 중 38건이 비어 있었다). 그때는 글 자체를 열어 게시일을 읽는다.
# 네이버 블로그 본문은 iframe(PostView.naver) 안에 있고, 게시일은 se_publishDate 에 있다.
_IFRAME_RE = re.compile(r'src="(/PostView\.naver[^"]+)"')
_PUBDATE_RE = re.compile(r'se_publishDate[^>]*>\s*([^<]+?)\s*<')


def fetch_blog_published_at(url: str) -> Optional[str]:
    """네이버 블로그 글의 실제 게시일(ISO). 못 읽으면 None."""
    try:
        outer = httpx.get(url, headers=HEADERS, timeout=15, follow_redirects=True).text
        m = _IFRAME_RE.search(outer)
        if not m:
            return None
        inner_url = 'https://blog.naver.com' + m.group(1).replace('&amp;', '&')
        inner = httpx.get(inner_url, headers=HEADERS, timeout=15, follow_redirects=True).text
        d = _PUBDATE_RE.search(inner)
        if not d:
            return None
        # "2025. 12. 7. 23:32" 형태
        p = re.match(r'(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?(?:\s*(\d{1,2}):(\d{2}))?', d.group(1))
        if not p:
            return None
        y, mo, day = int(p.group(1)), int(p.group(2)), int(p.group(3))
        hh, mm = int(p.group(4) or 0), int(p.group(5) or 0)
        return datetime(y, mo, day, hh, mm).isoformat()
    except Exception as e:
        logger.debug(f'블로그 게시일 조회 실패 {url}: {e}')
        return None


def fetch_naver_blog_results(keyword: str) -> list[dict]:
    """네이버 블로그 검색 결과에서 후기 파싱 (URL 기반 그룹핑)"""
    results = []
    try:
        params = {
            'where': 'blog',
            'query': keyword,
        }
        resp = httpx.get(
            NAVER_BLOG_SEARCH, params=params,
            headers=HEADERS, timeout=15, follow_redirects=True
        )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        # blog.naver.com URL 기반으로 그룹핑
        from collections import defaultdict
        url_to_texts: dict = defaultdict(lambda: {'title': '', 'desc': '', 'thumb': None, 'date': None})

        all_links = soup.find_all('a', href=True)
        for a in all_links:
            raw = a.get('href', '')
            if 'blog.naver.com' not in raw:
                continue
            # 글 주소(logNo 있음)만 채택. 블로그 메인/작성자 링크는 스킵.
            href = canonical_post_url(raw)
            if not href:
                continue
            text = a.get_text(strip=True)
            # 긴 텍스트 = 제목, 중간 텍스트 = 설명
            if len(text) > 15 and not url_to_texts[href]['title']:
                url_to_texts[href]['title'] = text
            elif 10 < len(text) <= 200 and not url_to_texts[href]['desc']:
                url_to_texts[href]['desc'] = text
            # 썸네일 이미지
            img = a.find('img')
            if img and not url_to_texts[href]['thumb']:
                src = img.get('src', '')
                if src and 'favicon' not in src and 'icon' not in src.lower():
                    url_to_texts[href]['thumb'] = src

        # 날짜 텍스트 추출 (전체 페이지에서)
        date_texts = [t for t in soup.stripped_strings if re.match(r'\d{4}\.\s*\d{1,2}\.\s*\d{1,2}', t)]

        seen_urls: set = set()
        date_idx = 0
        for url, data in list(url_to_texts.items())[:8]:
            if url in seen_urls or not data['title']:
                continue
            seen_urls.add(url)

            content = data['title']
            if data['desc']:
                content += '. ' + data['desc']

            pub_date = None
            if date_idx < len(date_texts):
                m = re.search(r'(\d{4})[.\s]+(\d{1,2})[.\s]+(\d{1,2})', date_texts[date_idx])
                if m:
                    try:
                        pub_date = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
                    except ValueError:
                        pass
                date_idx += 1
            if not pub_date:
                pub_date = fetch_blog_published_at(url)
                time.sleep(0.5)

            results.append({
                'source': 'naver_blog',
                'content': content[:1000],
                'source_url': url,
                'thumbnail_url': data['thumb'],
                'published_at': pub_date,
                'author_name': None,
            })

    except Exception as e:
        logger.warning(f'네이버 블로그 검색 실패 ({keyword}): {e}')

    return results


def save_reviews(company_id: str, reviews: list[dict]) -> int:
    """리뷰 DB 저장"""
    supabase = get_supabase()
    saved = 0
    for review in reviews:
        try:
            review['company_id'] = company_id
            review['crawled_at'] = datetime.utcnow().isoformat()
            # 게시일을 못 읽었으면 키를 빼고 보낸다 — None 으로 덮어쓰면
            # 이미 확보한 정확한 게시일이 지워진다.
            payload = {k: v for k, v in review.items()
                       if not (k == 'published_at' and v is None)}
            result = supabase.table('reviews').upsert(
                payload, on_conflict='source_url'
            ).execute()
            if result.data:
                saved += 1
        except Exception as e:
            logger.error(f'후기 저장 실패: {review.get("source_url")} - {e}')
    return saved


def run_review_crawl():
    """전체 업체 후기 크롤링"""
    supabase = get_supabase()

    for slug, keywords in COMPANY_KEYWORDS.items():
        try:
            result = supabase.table('companies').select('id').eq('slug', slug).single().execute()
            company_id = result.data['id']
        except Exception:
            logger.warning(f'업체 없음: {slug}')
            continue

        all_reviews = []
        for keyword in keywords:
            reviews = fetch_naver_blog_results(keyword)
            all_reviews.extend(reviews)
            time.sleep(1.5)

        # 중복 URL 제거
        seen = set()
        unique = []
        for r in all_reviews:
            if r['source_url'] not in seen:
                seen.add(r['source_url'])
                unique.append(r)

        saved = save_reviews(company_id, unique)
        logger.info(f'[{slug}] 후기 {saved}건 저장 (발견: {len(unique)}건)')
        time.sleep(2)


if __name__ == '__main__':
    run_review_crawl()
