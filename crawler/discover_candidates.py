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

# ── 에모셔널오렌지 전용: 가격/연령 티어 자동 채움 ──────────────────────────
# 1차 옵션(일시) 콜에서 (그룹hash, value hash, 라벨) 추출 — 라벨엔 "(나이C)" 등 포함
EO_OPT_RE = re.compile(r"selectRequireOption\('prod',\s*\d+,\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'")
# 2차 옵션(성별) 항목: "문정남성 55,000원 (품절)" 형태 → (라벨, 가격, 품절)
EO_ITEM_RE = re.compile(
    r'<span class="blocked margin-bottom-lg">([^<]+)</span>\s*'
    r'<span[^>]*><strong>\s*([\d,]+)\s*원\s*(\(품절\))?', re.S)
EO_AGE_CODE_RE = re.compile(r'\(나이([A-G])\)')
EO_TITLE_BRACKET_RE = re.compile(r'\[([^\]]+)\]')
# 티키타카 소개팅 나이코드 → (남성 만나이 min, max). /date는 전부 티키타카.
EO_AGE_CODE_MAP = {
    'A': (23, 28), 'B': (26, 31), 'C': (29, 34), 'D': (32, 37),
    'E': (35, 40), 'F': (38, 43), 'G': (41, 49),
}


def eo_load_option(host, idx, extra=''):
    """load_option.cm 호출 → option_html(unescape) 반환."""
    try:
        r = httpx.post(
            f'https://{host}/shop/load_option.cm',
            headers={'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest',
                     'Referer': f'https://{host}/shop_view/?idx={idx}',
                     'Content-Type': 'application/x-www-form-urlencoded'},
            content=f'type=prod&prod_idx={idx}{extra}&__=1',
            timeout=20, verify=False, follow_redirects=True)
        body = r.text
        try:
            body = json.loads(body).get('option_html', body)
        except Exception:
            pass
        return unescape(body)
    except Exception:
        return ''


def eo_parse_tiers(dep_html):
    """2차 옵션 응답 → {'male': {regular:{price,soldout}, earlybird:{...}}, 'female': {...}}"""
    tiers = {}
    for name, price, sold in EO_ITEM_RE.findall(dep_html):
        name = name.strip()
        g = 'male' if '남' in name else ('female' if '여' in name else None)
        if not g:
            continue
        kind = 'earlybird' if '얼리버드' in name else 'regular'
        tiers.setdefault(g, {})[kind] = {
            'price': int(price.replace(',', '')), 'soldout': bool(sold)}
    return tiers


def eo_build_price_detail(tiers):
    """price_detail JSON 구성. 정가/얼리버드/품절. 값 없으면 성별 키 자체 생략."""
    out = {}
    for g in ('male', 'female'):
        t = tiers.get(g, {})
        if 'regular' not in t and 'earlybird' not in t:
            continue
        d = {}
        if 'regular' in t:
            d['regular'] = t['regular']['price']
            if t['regular']['soldout']:
                d['regular_soldout'] = True
        if 'earlybird' in t:
            d['earlybird'] = t['earlybird']['price']
            d['earlybird_soldout'] = t['earlybird']['soldout']
        out[g] = d
    return out


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


def discover_emotional_orange(slug, list_urls, page):
    """에모셔널오렌지 전용 — 날짜+링크뿐 아니라 성별 가격 티어·남성 연령까지 자동 채움.

    - 1차 옵션(일시)에서 날짜/시간/나이코드, 2차 옵션(성별)에서 정가·얼리버드·품절 파싱.
    - 기존 이벤트(오너가 날짜만 넣어둔 manual 행)를 source_url 로 매칭해 UPDATE(가격/연령/티어).
      → 오너의 날짜·지역 데이터 보존, 빈 가격/연령만 채움. 없는 날짜는 crawl 로 신규 삽입.
    - source_url 형식은 manual 행과 동일하게 shop_view + #evt 앵커로 맞춤.
    """
    cid = company_id(slug)
    host = list_urls[0].split('/')[2]
    products = imweb_products(page, list_urls)

    # 기존 이벤트 source_url → id 매핑(업데이트 대상 판별)
    existing = {}
    er = sb.table('events').select('id,source_url').eq('company_id', cid).execute()
    for e in (er.data or []):
        existing[e['source_url']] = e['id']

    updated = 0
    inserts = []
    for prod_url, text in products.items():
        m = re.search(r'idx=(\d+)', prod_url)
        if not m:
            continue
        idx = m.group(1)
        region = None
        bm = EO_TITLE_BRACKET_RE.search(text)
        if bm:
            region = bm.group(1).strip()  # 예: "송파 문정" (manual 행과 동일 스타일)

        base = eo_load_option(host, idx)
        date_opts = [(gh, vh, lb) for gh, vh, lb in EO_OPT_RE.findall(base) if '월' in lb]
        for gh, vh, label in date_opts:
            dt = build_dt(label)
            if not dt or not (NOW <= dt <= HORIZON):
                continue
            # 2차 옵션(성별) 로드 → 티어
            extra = (
                '&selected_require_options%5B0%5D%5Bvalue_type%5D=SELECT'
                f'&selected_require_options%5B0%5D%5Boption_code%5D={gh}'
                f'&selected_require_options%5B0%5D%5Bvalue_code%5D={vh}')
            tiers = eo_parse_tiers(eo_load_option(host, idx, extra))
            price_detail = eo_build_price_detail(tiers)
            if not price_detail:
                continue
            price_male = price_detail.get('male', {}).get('regular')
            price_female = price_detail.get('female', {}).get('regular')

            # 남성 연령(나이코드), 여성은 무관
            age_male = None
            age_min = age_max = None
            ac = EO_AGE_CODE_RE.search(label)
            if ac and ac.group(1) in EO_AGE_CODE_MAP:
                age_min, age_max = EO_AGE_CODE_MAP[ac.group(1)]
                age_male = f'{age_min}~{age_max}'

            # 정가 남·여 모두 품절이면 마감
            m_sold = price_detail.get('male', {}).get('regular_soldout', False)
            f_sold = price_detail.get('female', {}).get('regular_soldout', False)

            anchor = dt.strftime('%Y%m%d%H%M')
            su = f'https://{host}/shop_view/?idx={idx}#evt={anchor}'

            fields = {
                'price_male': price_male,
                'price_female': price_female,
                'age_male': age_male,
                'age_range_min': age_min,
                'age_range_max': age_max,
                'price_detail': price_detail,
            }
            if m_sold and f_sold:
                fields['is_closed'] = True

            if su in existing:
                sb.table('events').update(fields).eq('id', existing[su]).execute()
                updated += 1
            else:
                inserts.append({
                    'company_id': cid,
                    'title': _NAME_CACHE.get(cid) or '모임',
                    'event_date': dt.isoformat(),
                    'location_region': region or '미정',
                    'source_url': su,
                    'is_active': True,
                    'is_closed': bool(m_sold and f_sold),
                    'source': 'crawl',
                    **fields,
                })

    if inserts:
        sb.table('events').upsert(
            inserts, on_conflict='source_url', ignore_duplicates=True).execute()
    return updated + len(inserts)


def discover_loco(slug, list_urls, page):
    """로꼬(lovecommunity-loco) 전용 — imweb 3단계 옵션(일시→성별→참가프로그램).
    참가프로그램의 **'와인파티 참석권' 기본가만** 사용(후기특가·동반할인 무시, 오너 지정).
    나이 정보 없음(가격만). source_url 시각이 DB(19:00)와 discover 기본(20:00) 불일치 →
    (idx, YYYYMMDD)로 매칭해 기존 이벤트 UPDATE(신규 발견은 안 함)."""
    cid = company_id(slug)
    host = list_urls[0].split('/')[2]
    products = imweb_products(page, list_urls)
    idxs = sorted({m.group(1) for u in products
                   for m in [re.search(r'idx=(\d+)', u)] if m})

    db = sb.table('events').select('id,source_url').eq('company_id', cid).execute().data or []
    dbmap = {}
    for e in db:
        mi = re.search(r'idx=(\d+)', e['source_url'])
        an = re.search(r'evt=(\d{8})', e['source_url'])
        if mi and an:
            dbmap[(mi.group(1), an.group(1))] = e['id']

    def sel_str(pairs):
        return ''.join(
            f'&selected_require_options%5B{i}%5D%5Bvalue_type%5D=SELECT'
            f'&selected_require_options%5B{i}%5D%5Boption_code%5D={gh}'
            f'&selected_require_options%5B{i}%5D%5Bvalue_code%5D={vh}'
            for i, (gh, vh) in enumerate(pairs))

    def wine_price(body):
        for m in EO_ITEM_RE.finditer(body):
            if '와인파티' in m.group(1):
                return int(m.group(2).replace(',', ''))
        return None

    # idx → 지역(상품 제목 대괄호). 예: idx=1 "[수원]" → 수원
    idx_region = {}
    for u, text in products.items():
        mi = re.search(r'idx=(\d+)', u)
        bm = re.search(r'\[([^\]]+)\]', text or '')
        if mi and bm and mi.group(1) not in idx_region:
            phrase = bm.group(1).strip()
            if not re.search(r'\d', phrase):  # "6/27 GRAND OPEN" 같은 날짜 대괄호 제외
                idx_region[mi.group(1)] = phrase

    updated = 0
    inserts = []
    for idx in idxs:
        region = idx_region.get(idx)
        dates = [o for o in EO_OPT_RE.findall(eo_load_option(host, idx)) if '/' in o[2]]
        for dgh, dvh, dlb in dates:
            dm = re.search(r'(\d{1,2})/(\d{1,2})', dlb)
            if not dm:
                continue
            mo, da = int(dm.group(1)), int(dm.group(2))
            yr = NOW.year + 1 if mo < NOW.month else NOW.year
            try:
                dt = datetime(yr, mo, da, 19, 0, tzinfo=KST)
            except ValueError:
                continue
            if not (NOW <= dt <= HORIZON):
                continue
            genders = [o for o in EO_OPT_RE.findall(
                eo_load_option(host, idx, sel_str([(dgh, dvh)])))
                if '남' in o[2] or '여' in o[2]]
            pm = pf = None
            for ggh, gvh, glb in genders:
                w = wine_price(eo_load_option(host, idx, sel_str([(dgh, dvh), (ggh, gvh)])))
                if '남' in glb:
                    pm = w
                elif '여' in glb:
                    pf = w
            if pm is None and pf is None:
                continue
            key = (idx, dt.strftime('%Y%m%d'))
            if key in dbmap:
                sb.table('events').update(
                    {'price_male': pm, 'price_female': pf}).eq('id', dbmap[key]).execute()
                updated += 1
            else:
                # DB에 없던 날짜 → 신규 생성(오너 확인: 사이트 12개 전부 나와야 함)
                su = f'https://{host}/party/?idx={idx}#evt={dt.strftime("%Y%m%d")}1900'
                inserts.append({
                    'company_id': cid,
                    'title': _NAME_CACHE.get(cid) or '모임',
                    'event_date': dt.isoformat(),
                    'location_region': region or '미정',
                    'source_url': su,
                    'is_active': True,
                    'is_closed': False,
                    'source': 'crawl',
                    'price_male': pm,
                    'price_female': pf,
                })
    if inserts:
        sb.table('events').upsert(
            inserts, on_conflict='source_url', ignore_duplicates=True).execute()
    return updated + len(inserts)


# 러브캐스팅 전용 정규식 (모듈 스코프 컴파일)
LC_POST_RE = re.compile(r'lovecasting\.co\.kr/\d')
LC_STATION_RE = re.compile(r'([가-힣]{2,4}역)')  # 리스팅의 역명(예: 삼성역) = 지역
LC_PM_RE = re.compile(r'([\d,]+)\s*원[^0-9]*남\s*\d{2,3}\s*세')
LC_PF_RE = re.compile(r'([\d,]+)\s*원[^0-9]*여\s*\d{2,3}\s*세')
LC_AM_RE = re.compile(r'남\s*(\d{2,3})\s*세?\s*[~\-～]\s*(\d{2,3})\s*세')
LC_AF_RE = re.compile(r'여\s*(\d{2,3})\s*세?\s*[~\-～]\s*(\d{2,3})\s*세')


def discover_lovecasting(slug='lovecasting'):
    """러브캐스팅 전용 — 성별 가격 + 성별 나이(남/여 다름)를 리스팅 카드에서 직접 파싱.
    Elementor DOM이 조각나 스크래퍼가 나이를 놓침 → 포스트링크의 상위 카드 컨테이너를 직접 읽음.
    source_url의 #evt 앵커를 뗀 경로로 기존 이벤트 매칭 UPDATE(신규 발견은 discover_platform 담당)."""
    from bs4 import BeautifulSoup
    cid = company_id(slug)
    CATS = ['https://lovecasting.co.kr/커피미팅/', 'https://lovecasting.co.kr/호프미팅/']

    def path_of(u):
        return u.split('#')[0].rstrip('/')

    def card_of(a):
        anc = a
        for _ in range(6):
            if not anc:
                return None
            t = anc.get_text(' ', strip=True)
            if LC_AM_RE.search(t) and LC_AF_RE.search(t) and LC_PM_RE.search(t):
                return anc
            anc = anc.parent
        return None

    db = sb.table('events').select('id,source_url').eq('company_id', cid).execute().data or []
    dbmap = {path_of(e['source_url']): e['id'] for e in db}

    parsed = {}
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_context(ignore_https_errors=True, user_agent=UA).new_page()
        for cat in CATS:
            try:
                pg.goto(cat, timeout=30000, wait_until='domcontentloaded')
                pg.wait_for_timeout(2500)
                soup = BeautifulSoup(pg.content(), 'html.parser')
            except Exception as e:
                print(f"  러브캐스팅 목록 실패 {cat}: {e}")
                continue
            for a in soup.find_all('a', href=LC_POST_RE):
                pth = path_of(a.get('href', ''))
                if pth in parsed:
                    continue
                c = card_of(a)
                if not c:
                    continue
                t = c.get_text(' ', strip=True)
                pm, pf = LC_PM_RE.search(t), LC_PF_RE.search(t)
                am, af = LC_AM_RE.search(t), LC_AF_RE.search(t)
                # 지역 = 리스팅의 역명(제목 '[' 앞쪽에 있음). 예: 삼성역
                st = LC_STATION_RE.search(t.split('[')[0])
                parsed[pth] = {
                    'price_male': int(pm.group(1).replace(',', '')) if pm else None,
                    'price_female': int(pf.group(1).replace(',', '')) if pf else None,
                    'age_male': f'{am.group(1)}~{am.group(2)}' if am else None,
                    'age_female': f'{af.group(1)}~{af.group(2)}' if af else None,
                    'region': st.group(1) if st else None,
                    'ages': [int(x) for x in (
                        (am.groups() if am else ()) + (af.groups() if af else ()))],
                }
        b.close()

    updated = 0
    for pth, r in parsed.items():
        if pth not in dbmap:
            continue  # 신규 발견은 discover_platform이 담당 — 여기선 기존 채움만
        fields = {
            'price_male': r['price_male'], 'price_female': r['price_female'],
            'age_male': r['age_male'], 'age_female': r['age_female'],
            'age_range_min': min(r['ages']) if r['ages'] else None,
            'age_range_max': max(r['ages']) if r['ages'] else None,
        }
        if r.get('region'):
            fields['location_region'] = r['region']  # 역명(삼성역 등)으로 지역 교체
        sb.table('events').update(fields).eq('id', dbmap[pth]).execute()
        updated += 1
    return updated


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


def discover_platform_enriched(slug, ScraperClass):
    """플랫폼 스크래퍼가 이미 뽑는 가격/연령까지 채우는 판(괜찮소 등 단순 남/여 단일가 업체).
    - 스크래퍼 EventModel의 price_male/female + age_range 를 그대로 사용.
    - 기존 이벤트를 source_url 로 매칭해 UPDATE(오너 날짜 보존), 없으면 crawl 삽입.
    - 얼리버드 티어 없는 업체 전용(price_detail 불필요). 나이는 남/여 공통 범위로 취급.
    """
    cid = company_id(slug)
    events = ScraperClass().scrape()

    existing = {}
    er = sb.table('events').select('id,source_url').eq('company_id', cid).execute()
    for e in (er.data or []):
        existing[e['source_url']] = e['id']

    updated = 0
    inserts = []
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
        su = d.get('source_url')
        if not su:
            continue

        amin, amax = d.get('age_range_min'), d.get('age_range_max')
        age_text = f'{amin}~{amax}' if (amin and amax) else None
        fields = {
            'price_male': d.get('price_male'),
            'price_female': d.get('price_female'),
            'age_range_min': amin,
            'age_range_max': amax,
            # 나이는 남/여 공통 범위(에모셔널오렌지와 달리 성별 구분 없음)
            'age_male': age_text,
            'age_female': age_text,
        }
        if su in existing:
            sb.table('events').update(fields).eq('id', existing[su]).execute()
            updated += 1
        else:
            inserts.append({
                'company_id': cid,
                'title': _NAME_CACHE.get(cid) or '모임',
                'event_date': dt.isoformat(),
                'location_region': d.get('location_region') or '미정',
                'location_detail': d.get('location_detail'),
                'source_url': su,
                'is_active': True,
                'is_closed': False,
                'source': 'crawl',
                **fields,
            })

    if inserts:
        sb.table('events').upsert(
            inserts, on_conflict='source_url', ignore_duplicates=True).execute()
    return updated + len(inserts)


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

    # 크롤링 금지(휴면·수동전용) 업체 slug — companies.crawl_enabled=false. 삭제 대신 스킵.
    try:
        dr = sb.table('companies').select('slug').eq('crawl_enabled', False).execute()
        DISABLED = {c['slug'] for c in (dr.data or [])}
    except Exception:
        DISABLED = set()
    if DISABLED:
        print(f"크롤링 금지 업체 스킵: {sorted(DISABLED)}")

    total = 0
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        page = b.new_context(ignore_https_errors=True, locale='ko-KR', user_agent=UA).new_page()
        for slug, urls in IMWEB.items():
            if (only and only not in slug) or slug in DISABLED:
                continue
            try:
                # 가격/연령까지 자동 채우는 imweb 업체(전용 경로)
                if slug == 'emotional-orange':
                    n = discover_emotional_orange(slug, urls, page)
                elif slug == 'lovecommunity-loco':
                    n = discover_loco(slug, urls, page)
                else:
                    n = discover_imweb(slug, urls, page)
                total += n
                print(f"[{slug}] {n}건")
            except Exception as e:
                print(f"[{slug}] 실패: {e}")
        b.close()

    for slug, cfg in WIX.items():
        if (only and only not in slug) or slug in DISABLED:
            continue
        try:
            n = discover_wix(slug, cfg)
            total += n
            print(f"[{slug}] {n}건")
        except Exception as e:
            print(f"[{slug}] 실패: {e}")

    # 가격/연령까지 자동 채우는 업체(스크래퍼가 이미 파싱, 단순 남/여 단일가). 검증된 것만 추가.
    PLATFORM_ENRICHED = {'yeongyul'}
    for slug, ScraperClass in PLATFORM.items():
        if (only and only not in slug) or slug in DISABLED:
            continue
        try:
            if slug == 'lovecasting':
                n = discover_lovecasting(slug)
            elif slug in PLATFORM_ENRICHED:
                n = discover_platform_enriched(slug, ScraperClass)
            else:
                n = discover_platform(slug, ScraperClass)
            total += n
            print(f"[{slug}] {n}건")
        except Exception as e:
            print(f"[{slug}] 실패: {e}")

    print(f"발견 완료: {total}건 (창: {NOW.date()} ~ {HORIZON.date()})")
    return 0


if __name__ == '__main__':
    sys.exit(main())
