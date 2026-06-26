"""예정 날짜 발견기 (load_option 정확판) — 검증된 추출 방식으로 깨끗한 날짜+링크만 적재.

규칙:
- imweb: 상품목록(Playwright) → 각 상품 load_option.cm → 선택가능 날짜(정확 KST 시간) + 링크
- wix(투연시): calendar_scheduler API
- 시간대: KST로 저장(+09:00) → admin/앱에서 한국시간 그대로 표시
- 창(window): 오늘 ~ 오늘+60일 만. 과거·2개월 초과는 제외
- 과거 후보 자동 삭제(매 실행 시), 업체별 미등록 후보는 새로고침(registered=true는 보존)

실행: python discover_candidates.py            # 전체
      python discover_candidates.py inssumparty # 특정
"""
import re
import sys
import json
from datetime import datetime, timedelta, timezone
from html import unescape

import httpx
from playwright.sync_api import sync_playwright
from dotenv import dotenv_values

ENV = dotenv_values('/Users/ourmine/dev/sodate/crawler/.env')
from supabase import create_client
sb = create_client(ENV['SUPABASE_URL'], ENV['SUPABASE_SERVICE_ROLE_KEY'])

KST = timezone(timedelta(hours=9))
NOW = datetime.now(KST)
HORIZON = NOW + timedelta(days=60)  # 오늘+2개월
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36')

# imweb load_option 방식 업체: slug → 상품목록 URL들
IMWEB = {
    'inssumparty':        ['https://www.inssumparty.co.kr/party'],
    'emotional-orange':   ['https://emotional0ranges.com/date'],
    'secretsalon':        ['https://secretsalon.co.kr/36'],
    'lovecommunity-loco': ['https://lovecommunity.imweb.me/party'],
    'flipo':              ['https://flipo.co.kr/Fruit', 'https://flipo.co.kr/vegetable'],
}
# wix calendar 업체
WIX = {
    'twoyeonsi': {'list': 'https://2yeonsi.com/?idx=c66d7a938c66fb',
                  'idx': 'c66d7a938c66fb', 'col': 'column_66ebf3d35296a'},
}

REGION_KEYS = ['강남', '역삼', '선릉', '성수', '홍대', '신촌', '을지로', '수원', '인천',
               '대전', '부산', '서면', '일산', '분당', '성동', '구로', '가산', '삼성', '사당', '천안']

LABEL_RE = re.compile(r"selectRequireOption\('prod',\s*\d+,\s*'[^']+',\s*'[^']+',\s*'([^']+)'")
KDATE_RE = re.compile(r'(\d{1,2})\s*월\s*(\d{1,2})\s*일|(\d{1,2})/(\d{1,2})')
KHMM_RE = re.compile(r'(\d{1,2}):(\d{2})')
KHOUR_RE = re.compile(r'(\d{1,2})\s*시')
AM_WORDS = ('오전', '아침', '새벽')
PM_WORDS = ('오후', '낮', '저녁', '밤')


def build_dt(label: str):
    dm = KDATE_RE.search(label)
    if not dm:
        return None
    mo = int(dm.group(1)) if dm.group(1) else int(dm.group(3))
    day = int(dm.group(2)) if dm.group(1) else int(dm.group(4))
    if not (1 <= mo <= 12 and 1 <= day <= 31):
        return None

    hour, minute = 20, 0  # 시간 미표기 시 기본 저녁 8시
    hm = KHMM_RE.search(label)
    if hm:
        hour, minute = int(hm.group(1)), int(hm.group(2))
    else:
        hh = KHOUR_RE.search(label)
        if hh:
            hour = int(hh.group(1))
            is_pm = any(w in label for w in PM_WORDS)
            is_am = any(w in label for w in AM_WORDS)
            if is_pm and hour < 12:
                hour += 12
            elif is_am and hour == 12:
                hour = 0
            elif not is_pm and not is_am and 1 <= hour <= 9:
                hour += 12  # 표기 없고 1~9시면 소개팅 특성상 저녁으로 간주

    year = NOW.year + 1 if mo < NOW.month else NOW.year
    try:
        return datetime(year, mo, day, hour, minute, tzinfo=KST)
    except ValueError:
        return None


def region_of(text: str):
    for k in REGION_KEYS:
        if k in (text or ''):
            return k
    return None


def imweb_products(page, list_urls):
    """상품목록 페이지에서 (상품URL, 링크텍스트) 수집"""
    out = {}
    for url in list_urls:
        try:
            page.goto(url, timeout=25000)
            page.wait_for_load_state('domcontentloaded', timeout=10000)
            page.wait_for_timeout(2500)
            items = page.eval_on_selector_all(
                'a[href*="idx="]',
                'els => els.map(e => ({href: e.href, text: e.innerText.trim()}))')
            for it in items:
                m = re.search(r'idx=(\d+)', it['href'])
                if m:
                    out[it['href']] = it['text']
        except Exception as e:
            print(f"  목록 실패 {url}: {e}")
    return out


def imweb_dates(host, prod_url):
    """load_option.cm → 선택가능 날짜 라벨 → KST datetime"""
    m = re.search(r'idx=(\d+)', prod_url)
    if not m:
        return []
    idx = m.group(1)
    try:
        r = httpx.post(f'https://{host}/shop/load_option.cm',
                       headers={'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest',
                                'Referer': prod_url, 'Content-Type': 'application/x-www-form-urlencoded'},
                       content=f'type=prod&prod_idx={idx}&__=1', timeout=20, verify=False, follow_redirects=True)
        body = r.text
        try:
            body = json.loads(body).get('option_html', body)
        except Exception:
            pass
        body = unescape(body)
    except Exception:
        return []
    seen = set()
    res = []
    for label in LABEL_RE.findall(body):
        if not re.search(r'월|\d{1,2}/\d{1,2}', label):
            continue
        dt = build_dt(label)
        if not dt or not (NOW <= dt <= HORIZON):
            continue
        key = dt.isoformat()
        if key in seen:
            continue
        seen.add(key)
        res.append(dt)
    return res


_NAME_CACHE = {}


def company_id(slug):
    r = sb.table('companies').select('id,name').eq('slug', slug).single().execute()
    _NAME_CACHE[r.data['id']] = r.data['name']
    return r.data['id']


def refresh_company(cid, rows):
    """발견 날짜를 events 에 빈칸(정원·잔여·가격 null)으로 적재.
    - 출처 'crawl' 이벤트만 삭제 후 재적재 → 오너가 채운 'verified'/'manual'은 보존
    - source_url 유니크 위해 link 에 #evt=<일시> 앵커 부착 (같은 상품 여러 날짜 구분)
    - 앱은 이 events 를 그대로 노출(빈칸), 오너가 채우면 그 자리 반영
    """
    name = _NAME_CACHE.get(cid) or '모임'
    sb.table('events').delete().eq('company_id', cid).eq('source', 'crawl').execute()
    ev_rows = []
    seen = set()
    for r in rows:
        dt = r['event_datetime']
        anchor = datetime.fromisoformat(dt).strftime('%Y%m%d%H%M')
        su = f"{r['link']}#evt={anchor}"
        if su in seen:
            continue
        seen.add(su)
        ev_rows.append({
            'company_id': cid,
            'title': name,
            'event_date': dt,
            'location_region': r.get('location_region') or '미정',
            'source_url': su,
            'is_active': True,
            'is_closed': False,
            'source': 'crawl',
        })
    if ev_rows:
        # ignore_duplicates: 오너가 이미 채운(verified) 같은 source_url 은 덮어쓰지 않음
        sb.table('events').upsert(ev_rows, on_conflict='source_url', ignore_duplicates=True).execute()


def discover_imweb(slug, list_urls, page):
    cid = company_id(slug)
    host = list_urls[0].split('/')[2]
    products = imweb_products(page, list_urls)
    rows = []
    for prod_url, text in products.items():
        for dt in imweb_dates(host, prod_url):
            rows.append({
                'company_id': cid,
                'event_datetime': dt.isoformat(),
                'link': prod_url,
                'location_region': region_of(text),
                'source': 'crawl',
            })
    refresh_company(cid, rows)
    return len(rows)


def discover_wix(slug, cfg):
    cid = company_id(slug)
    api = (f"https://2yeonsi.com/?_simpleApps=etc/calendar_scheduler&mvwiz={cfg['idx']}/{cfg['col']}"
           f"&_get=%7B%22idx%22%3A%22{cfg['idx']}%22%7D&_post=%5B%5D&_ajaxpage=true")
    try:
        r = httpx.get(api, headers={'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest',
                                    'Referer': cfg['list']}, timeout=20, verify=False)
        starts = re.findall(r"start:\s*'([^']+)'", r.text)
    except Exception:
        starts = []
    rows = []
    seen = set()
    for s in starts:
        try:
            dt = datetime.fromisoformat(s).replace(tzinfo=KST)
        except Exception:
            continue
        if not (NOW <= dt <= HORIZON) or s in seen:
            continue
        seen.add(s)
        rows.append({'company_id': cid, 'event_datetime': dt.isoformat(),
                     'link': cfg['list'], 'source': 'crawl'})
    refresh_company(cid, rows)
    return len(rows)


# 플랫폼 업체: 자체 API 스크래퍼가 정확한 날짜+링크 제공 → 그대로 후보화 (좌석·가격은 버림)
def discover_platform(slug, ScraperClass):
    cid = company_id(slug)
    scraper = ScraperClass()
    events = scraper.scrape()
    rows = []
    seen = set()
    for ev in events:
        d = ev.model_dump()
        dt = d.get('event_date')
        if not isinstance(dt, datetime):
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=KST)
        dt = dt.astimezone(KST)
        if not (NOW <= dt <= HORIZON):
            continue
        link = d.get('source_url')
        key = (dt.isoformat(), link)
        if key in seen:
            continue
        seen.add(key)
        rows.append({'company_id': cid, 'event_datetime': dt.isoformat(),
                     'link': link, 'location_region': d.get('location_region'),
                     'source': 'crawl'})
    refresh_company(cid, rows)
    return len(rows)


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None

    # 기존 스크래퍼 경로 (자체 API 플랫폼 + 인라인/게시판형) — 날짜+링크만 취함
    from scrapers.frip import FripScraper
    from scrapers.munto import MuntoScraper
    from scrapers.modparty import ModpartyScraper
    from scrapers.yeonin import YeoninScraper
    from scrapers.lovecasting import LovecastingScraper
    from scrapers.yeongyul import YeongyulScraper
    from scrapers.talkblossom import TalkblossomScraper
    PLATFORM = {
        'frip': FripScraper, 'munto': MuntoScraper, 'modparty': ModpartyScraper,
        'yeonin': YeoninScraper, 'lovecasting': LovecastingScraper, 'yeongyul': YeongyulScraper,
        'talkblossom': TalkblossomScraper,
    }

    # 과거 'crawl' 이벤트 자동 삭제 (오너가 채운 verified/manual 은 보존)
    deleted = sb.table('events').delete().eq('source', 'crawl').lt('event_date', NOW.isoformat()).execute()
    print(f"과거 crawl 이벤트 삭제: {len(deleted.data) if deleted.data else 0}건")

    total = 0
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        page = b.new_context(ignore_https_errors=True, locale='ko-KR', user_agent=UA).new_page()
        for slug, urls in IMWEB.items():
            if only and only not in slug:
                continue
            try:
                n = discover_imweb(slug, urls, page)
                total += n
                print(f"[{slug}] {n}건")
            except Exception as e:
                print(f"[{slug}] 실패: {e}")
        b.close()

    for slug, cfg in WIX.items():
        if only and only not in slug:
            continue
        try:
            n = discover_wix(slug, cfg)
            total += n
            print(f"[{slug}] {n}건")
        except Exception as e:
            print(f"[{slug}] 실패: {e}")

    for slug, ScraperClass in PLATFORM.items():
        if only and only not in slug:
            continue
        try:
            n = discover_platform(slug, ScraperClass)
            total += n
            print(f"[{slug}] {n}건")
        except Exception as e:
            print(f"[{slug}] 실패: {e}")

    print(f"발견 완료: {total}건 (창: {NOW.date()} ~ {HORIZON.date()})")
    return 0


if __name__ == '__main__':
    sys.exit(main())
