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
    """네이버 블로그 검색 결과에서 후기 파싱"""
    results = []
    try:
        params = {
            'where': 'blog',
            'query': keyword,
            'sm': 'tab_opt',
            'nso': 'so:r,p:1m',  # 최근 1달 기준
        }
        resp = httpx.get(
            NAVER_BLOG_SEARCH, params=params,
            headers=HEADERS, timeout=15, follow_redirects=True
        )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')

        # 블로그 검색 결과 파싱
        items = soup.select('.api_txt_lines, .total_tit, .desc')
        blog_items = soup.select('li.bx')

        for item in blog_items[:5]:
            try:
                title_el = item.select_one('.title_link, .api_txt_lines.total_tit')
                desc_el = item.select_one('.api_txt_lines.dsc_txt, .desc')
                link_el = item.select_one('a.title_link, a.total_tit')
                date_el = item.select_one('.sub_time, .date, span.sub_txt')
                thumb_el = item.select_one('img.thumb, img._thumb')

                if not title_el or not link_el:
                    continue

                title = title_el.get_text(strip=True)
                content = f"{title}. {desc_el.get_text(strip=True) if desc_el else ''}"
                url = link_el.get('href', '')
                thumbnail = thumb_el.get('src') if thumb_el else None

                # 날짜 파싱
                pub_date = None
                if date_el:
                    date_text = date_el.get_text(strip=True)
                    date_match = re.search(r'(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})', date_text)
                    if date_match:
                        y, m, d = date_match.groups()
                        pub_date = datetime(int(y), int(m), int(d)).isoformat()

                if url and content:
                    results.append({
                        'source': 'naver_blog',
                        'content': content[:1000],
                        'source_url': url,
                        'thumbnail_url': thumbnail,
                        'published_at': pub_date,
                        'author_name': None,
                    })
            except Exception:
                continue

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
