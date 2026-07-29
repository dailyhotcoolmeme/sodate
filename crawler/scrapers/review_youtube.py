"""유튜브 후기 크롤러 — 업체별 유튜브 검색(쇼츠+영상) 수집.
썸네일은 i.ytimg.com 영구 고정 URL이라 재호스팅 불필요.
쇼츠는 source_url 이 /shorts/ 로, 일반 영상은 /watch?v= 로 저장(앱에서 구분)."""
import re
import time
import json
import httpx
from datetime import datetime, timezone, timedelta
from typing import Optional

from utils.logger import get_logger
from utils.supabase_client import get_supabase

logger = get_logger('review_youtube')

YT_SEARCH = 'https://www.youtube.com/results'

# 귀속 정확도: 제목에 '해당 업체 상호'가 있어야만 그 업체 후기로 인정.
# (일반 소개팅 영상이 니치 업체에 오귀속되는 것을 방지 — 물량보다 정확도 우선)
COMPANY_ALIASES = {
    'yeonin':            ['연인어때'],
    'emotional-orange':  ['에모셔널오렌지', '에모셔널 오렌지'],
    'frip':              ['프립'],
    'munto':             ['문토'],
    'modparty':          ['모드파티'],
    'lovecasting':       ['러브캐스팅'],
    'talkblossom':       ['토크블라썸'],
    'yeongyul':          ['괜찮소'],
    'inssumparty':       ['인썸파티'],
    'secretsalon':       ['시크릿살롱'],
    'twoyeonsi':         ['이연시'],
    'flipo':             ['플리포'],
    'lovecommunity-loco': ['로꼬'],
}

# 상호 + 아래 주제어가 '둘 다' 제목에 있어야 소개팅 후기로 인정.
# (프립=활동플랫폼, 문토=소셜링, 로꼬=동명 래퍼 등 비-소개팅 영상 오검출 방지)
TOPIC = ['소개팅', '로테이션']

MAX_PER_KEYWORD = 15

HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/124.0.0.0 Safari/537.36'
    ),
    'Accept-Language': 'ko-KR,ko;q=0.9',
}


def _title(t: Optional[dict]) -> Optional[str]:
    if not t:
        return None
    if 'runs' in t:
        return ''.join(r.get('text', '') for r in t['runs'])
    return t.get('simpleText')


# 유튜브는 절대 날짜를 안 주고 "1년 전 / 7개월 전 / 3주 전" 상대 표기만 준다
# (publishedTimeText). 게시일이 비면 후기 목록에서 언제 글인지 알 수 없어(오너 지적
# 2026-07-30) 상대 표기를 절대 날짜로 환산해 저장한다. 일 단위 근사치다.
_REL_RE = re.compile(r'(\d+)\s*(초|분|시간|일|주|개월|년)\s*전')
_REL_DAYS = {'초': 0, '분': 0, '시간': 0, '일': 1, '주': 7, '개월': 30, '년': 365}


def _published_at_from_relative(text: str | None):
    """'7개월 전' → ISO 날짜 문자열. 못 읽으면 None."""
    if not text:
        return None
    m = _REL_RE.search(text)
    if not m:
        return None
    n, unit = int(m.group(1)), m.group(2)
    days = n * _REL_DAYS.get(unit, 0)
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _walk(o, items: list):
    """ytInitialData 를 순회하며 (kind, videoId, title) 수집."""
    if isinstance(o, dict):
        if 'videoRenderer' in o:
            v = o['videoRenderer']
            items.append(('video', v.get('videoId'), _title(v.get('title')),
                          (v.get('publishedTimeText') or {}).get('simpleText')))
        if 'shortsLockupViewModel' in o:  # 신형 쇼츠
            v = o['shortsLockupViewModel']
            vid = (v.get('onTap', {}).get('innertubeCommand', {})
                   .get('reelWatchEndpoint', {}) or {}).get('videoId')
            title = (v.get('overlayMetadata', {}).get('primaryText', {}) or {}).get('content')
            # 쇼츠는 게시일 표기가 없는 경우가 많다
            items.append(('short', vid, title, None))
        if 'reelItemRenderer' in o:  # 구형 쇼츠 폴백
            v = o['reelItemRenderer']
            items.append(('short', v.get('videoId'), _title(v.get('headline')), None))
        for val in o.values():
            _walk(val, items)
    elif isinstance(o, list):
        for x in o:
            _walk(x, items)


def fetch_youtube_results(keyword: str, aliases: list[str]) -> list[dict]:
    """유튜브 검색 결과 페이지에서 후기 영상/쇼츠 파싱. 제목에 상호(aliases)가 있어야 채택."""
    results = []
    try:
        resp = httpx.get(
            YT_SEARCH,
            params={'search_query': keyword, 'hl': 'ko', 'gl': 'KR'},
            headers=HEADERS, timeout=15, follow_redirects=True,
        )
        resp.raise_for_status()
        m = re.search(r'var ytInitialData = (\{.*?\});</script>', resp.text)
        if not m:
            logger.warning(f'ytInitialData 없음 ({keyword})')
            return results
        data = json.loads(m.group(1))

        items: list = []
        _walk(data, items)

        seen: set = set()
        for kind, vid, title, pub_text in items:
            if not vid or not title or vid in seen:
                continue
            # 상호 + 소개팅/로테이션 둘 다 있어야 채택(오검출 방지)
            if not (any(a in title for a in aliases) and any(t in title for t in TOPIC)):
                continue
            seen.add(vid)
            if kind == 'short':
                url = f'https://www.youtube.com/shorts/{vid}'
            else:
                url = f'https://www.youtube.com/watch?v={vid}'
            results.append({
                'source': 'youtube',
                'content': title[:1000],
                'source_url': url,
                'thumbnail_url': f'https://i.ytimg.com/vi/{vid}/hqdefault.jpg',
                'published_at': _published_at_from_relative(pub_text),
                'author_name': None,
            })
            if len(results) >= MAX_PER_KEYWORD:
                break
    except Exception as e:
        logger.warning(f'유튜브 검색 실패 ({keyword}): {e}')

    return results


def run_youtube_crawl():
    """전체 업체 유튜브 후기 크롤링."""
    supabase = get_supabase()

    for slug, aliases in COMPANY_ALIASES.items():
        try:
            result = supabase.table('companies').select('id').eq('slug', slug).single().execute()
            company_id = result.data['id']
        except Exception:
            logger.warning(f'업체 없음: {slug}')
            continue

        # 브랜드명 기반 다중 쿼리로 상호-언급 영상을 최대한 발굴(정확도는 제목 필터로 유지)
        name = aliases[0]
        keywords = [f'{name} 소개팅 후기', f'{name} 후기', f'{name} 로테이션 소개팅', name]
        all_reviews = []
        for keyword in keywords:
            all_reviews.extend(fetch_youtube_results(keyword, aliases))
            time.sleep(2)

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

        logger.info(f'[{slug}] 유튜브 후기 {saved}건 저장 (발견: {len(unique)}건)')
        time.sleep(3)


if __name__ == '__main__':
    run_youtube_crawl()
