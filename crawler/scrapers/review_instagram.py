"""인스타그램 후기 크롤러 — DuckDuckGo 검색으로 instagram.com 포스트 수집.
썸네일은 링크프리뷰봇(facebookexternalhit) UA로 og:image를 얻어
Supabase Storage(review-thumbs)에 재호스팅한다(인스타 CDN URL은 ~4일 만료되므로)."""
import os
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

# 링크 프리뷰 봇 UA — 로그인 없이 og:image(썸네일)를 노출받는다
FB_UA = 'facebookexternalhit/1.1'
THUMB_BUCKET = 'review-thumbs'


def _og_image(post_url: str) -> str | None:
    try:
        r = httpx.get(post_url, headers={'User-Agent': FB_UA, 'Accept-Language': 'ko-KR,ko;q=0.9'},
                      timeout=12, follow_redirects=True)
        m = re.search(r'property="og:image" content="([^"]+)"', r.text)
        if m:
            return m.group(1).replace('&amp;', '&')
    except Exception as e:
        logger.debug(f'og:image 실패 {post_url}: {e}')
    return None


def fetch_and_store_thumb(supabase, source_url: str) -> str | None:
    """인스타 게시물/릴스 썸네일을 Storage에 재호스팅 → 공개 URL. 실패 시 None."""
    m = re.search(r'/(p|reel|reels|tv)/([^/?#]+)', source_url)
    if not m:
        return None
    code = m.group(2)
    img = _og_image(source_url)
    if not img:
        return None
    try:
        resp = httpx.get(img, headers={'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'},
                         timeout=12, follow_redirects=True)
        if resp.status_code != 200 or not resp.content:
            return None
        path = f'insta/{code}.jpg'
        supabase.storage.from_(THUMB_BUCKET).upload(
            path, resp.content,
            {'content-type': 'image/jpeg', 'upsert': 'true'},
        )
        base = os.environ['SUPABASE_URL'].rstrip('/')
        return f'{base}/storage/v1/object/public/{THUMB_BUCKET}/{path}'
    except Exception as e:
        logger.warning(f'인스타 썸네일 저장 실패 {source_url}: {e}')
        return None


def backfill_thumbs():
    """기존 썸네일 없는 인스타 후기에 재호스팅 썸네일을 채운다."""
    supabase = get_supabase()
    rows = supabase.table('reviews').select('id, source_url') \
        .eq('source', 'instagram').is_('thumbnail_url', 'null').execute().data or []
    logger.info(f'인스타 썸네일 백필 대상: {len(rows)}건')
    done = 0
    for row in rows:
        url = fetch_and_store_thumb(supabase, row['source_url'])
        if url:
            try:
                supabase.table('reviews').update({'thumbnail_url': url}).eq('id', row['id']).execute()
                done += 1
            except Exception as e:
                logger.warning(f'썸네일 저장 실패(스킵) {row["id"]}: {e}')
        time.sleep(1.2)
    logger.info(f'인스타 썸네일 백필 완료: {done}/{len(rows)}건')

COMPANY_KEYWORDS = {
    'yeonin':           ['site:instagram.com 연인어때 소개팅 후기', 'site:instagram.com 연인어때 로테이션'],
    'emotional-orange': ['site:instagram.com 에모셔널오렌지 소개팅 후기', 'site:instagram.com 에모셔널오렌지 로테이션'],
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
                # 게시일은 취득 불가. 2026-07-30 전부 실측 확인:
                #   게시물 HTML / 임베드 HTML / 임베드 브라우저 렌더링 /
                #   렌더링 중 네트워크 응답 전수 스캔 → taken_at 계열 0건
                #   공식 oEmbed 302(토큰 필요), GraphQL require_login,
                #   shortcode 디코딩은 2040년 등 불가능한 값
                # 로그인 크롤링은 프로젝트 금지 사항이라 대안이 없다. 수집일로 대체하거나
                # "1년 전"류를 환산하면 실제 게시일과 어긋나므로 추정하지 않고 비워 둔다.
                # 앱/admin은 이 경우 '확인 불가'로 표기한다.
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
                # 썸네일 재호스팅(실패해도 후기는 저장)
                thumb = fetch_and_store_thumb(supabase, review['source_url'])
                if thumb:
                    review['thumbnail_url'] = thumb
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
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == 'backfill':
        backfill_thumbs()
    else:
        run_instagram_crawl()
