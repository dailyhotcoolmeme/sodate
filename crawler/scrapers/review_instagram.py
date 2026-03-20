"""인스타그램 후기 크롤러 — DuckDuckGo 검색으로 instagram.com 포스트 수집"""
import re
import time
import httpx
from bs4 import BeautifulSoup
from datetime import datetime
from urllib.parse import unquote

from utils.logger import get_logger
from utils.supabase_client import get_supabase

logger = get_logger('review_instagram')

DDG_SEARCH = 'https://html.duckduckgo.com/html/'

COMPANY_KEYWORDS = {
    'yeonin':           ['site:instagram.com 연인어때 소개팅 후기', 'site:instagram.com 연인어때 로테이션'],
    'emotional-orange': ['site:instagram.com 에모셔널오렌지 소개팅 후기', 'site:instagram.com 에모셔널오렌지 로테이션'],
    'lovematching':     ['site:instagram.com 러브매칭 소개팅 후기', 'site:instagram.com 러브매칭 로테이션'],
    'frip':             ['site:instagram.com 프립 소개팅 후기'],
    'munto':            ['site:instagram.com 문토 소개팅 후기'],
    'modparty':         ['site:instagram.com 모드파티 소개팅 후기', 'site:instagram.com 모드파티 후기'],
    'lovecasting':      ['site:instagram.com 러브캐스팅 소개팅 후기'],
    'talkblossom':      ['site:instagram.com 토크블라썸 소개팅 후기'],
}

HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/124.0.0.0 Safari/537.36'
    ),
    'Accept-Language': 'ko-KR,ko;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}


def fetch_instagram_results(keyword: str) -> list[dict]:
    """DuckDuckGo HTML 검색으로 instagram.com 포스트 수집"""
    results = []
    try:
        resp = httpx.get(
            DDG_SEARCH,
            params={'q': keyword, 'kl': 'kr-kr'},
            headers=HEADERS, timeout=15, follow_redirects=True
        )
        resp.raise_for_status()

        # rate-limit/captcha 감지
        if resp.status_code == 202 or 'anomaly' in resp.text[:200].lower():
            logger.warning(f'DuckDuckGo 차단 감지 ({keyword}), 재시도 대기 중...')
            time.sleep(30)
            resp = httpx.get(
                DDG_SEARCH,
                params={'q': keyword, 'kl': 'kr-kr'},
                headers=HEADERS, timeout=15, follow_redirects=True
            )

        soup = BeautifulSoup(resp.text, 'html.parser')

        seen_urls: set = set()
        for a in soup.find_all('a', href=True):
            href = a.get('href', '')

            # DuckDuckGo 리다이렉트 URL 파싱
            m = re.search(r'uddg=(https?%3A%2F%2F[^&]+)', href)
            if not m:
                continue
            url = unquote(m.group(1)).split('?')[0].rstrip('/')

            # 개별 포스트/릴스만 수집
            if 'instagram.com/p/' not in url and 'instagram.com/reel' not in url:
                continue
            if url in seen_urls:
                continue
            seen_urls.add(url)

            # 제목/설명 추출 — 가장 긴 텍스트 링크를 제목으로
            title = a.get_text(strip=True)
            desc = ''
            parent = a.find_parent('div') or a.find_parent('li')
            if parent:
                all_text = parent.get_text(' ', strip=True)
                if len(all_text) > len(title):
                    desc = all_text[:300]

            content = title if title else desc
            if not content:
                content = keyword.replace('site:instagram.com ', '')

            results.append({
                'source': 'instagram',
                'content': content[:1000],
                'source_url': url,
                'thumbnail_url': None,
                'published_at': None,
                'author_name': None,
            })

    except Exception as e:
        logger.warning(f'인스타그램 검색 실패 ({keyword}): {e}')

    return results


def run_instagram_crawl():
    """전체 업체 인스타그램 후기 크롤링"""
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
            reviews = fetch_instagram_results(keyword)
            all_reviews.extend(reviews)
            time.sleep(5)  # DuckDuckGo rate-limit 방지

        # 중복 URL 제거
        seen: set = set()
        unique = []
        for r in all_reviews:
            if r['source_url'] not in seen:
                seen.add(r['source_url'])
                unique.append(r)

        saved = 0
        for review in unique:
            try:
                review['company_id'] = company_id
                review['crawled_at'] = datetime.utcnow().isoformat()
                res = supabase.table('reviews').upsert(
                    review, on_conflict='source_url'
                ).execute()
                if res.data:
                    saved += 1
            except Exception as e:
                logger.error(f'후기 저장 실패: {review.get("source_url")} - {e}')

        logger.info(f'[{slug}] 인스타 후기 {saved}건 저장 (발견: {len(unique)}건)')
        time.sleep(10)  # 업체간 대기


if __name__ == '__main__':
    run_instagram_crawl()
