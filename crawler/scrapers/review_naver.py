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
    'lovematching': ['러브매칭 후기', '러브매칭 소개팅 후기'],
    'frip': ['프립 소개팅 후기', '프립 로테이션 후기'],
    'munto': ['문토 소개팅 후기', '문토 로테이션 후기'],
    'modparty': ['모드파티 후기', '모드파티 소개팅 후기'],
    'lovecasting': ['러브캐스팅 후기', '러브캐스팅 소개팅 후기'],
    'solooff': ['솔로오프 후기', '솔로오프 소개팅 후기'],
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
            href = a.get('href', '')
            if 'blog.naver.com' not in href:
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
            result = supabase.table('reviews').upsert(
                review, on_conflict='source_url'
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
