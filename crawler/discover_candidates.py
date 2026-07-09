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

from utils.hashtags import derive_hashtags

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
# 품절(비활성) 날짜 항목 라벨: opacity-40 항목의 span 텍스트 "7월 4일 ... (나이A) (품절)"
EO_SOLDOUT_RE = re.compile(r'opacity-40.*?<span[^>]*>([^<]+)</span>', re.S)
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
    existing_key = {}  # (idx, YYYYMMDD) → id (품절 매칭용, 시각 불일치 대비)
    er = sb.table('events').select('id,source_url').eq('company_id', cid).execute()
    for e in (er.data or []):
        existing[e['source_url']] = e['id']
        mi = re.search(r'idx=(\d+)', e['source_url'])
        an = re.search(r'evt=(\d{8})', e['source_url'])
        if mi and an:
            existing_key[(mi.group(1), an.group(1))] = e['id']

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
                'age_female': '나이 무관',  # 에모셔널오렌지 여성=연령 무관
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

        # 품절(비활성) 날짜: 선택 불가 → 가격 없음. 기존 이벤트에 마감(is_closed)+나이만 채움.
        for so_label in EO_SOLDOUT_RE.findall(base):
            if '품절' not in so_label or '월' not in so_label:
                continue
            dt = build_dt(so_label)
            if not dt or not (NOW <= dt <= HORIZON):
                continue
            key = (idx, dt.strftime('%Y%m%d'))
            if key not in existing_key:
                continue  # 오너가 등록한 기존 이벤트만 채움(신규 품절은 추가 안 함)
            age_male = age_min = age_max = None
            ac = EO_AGE_CODE_RE.search(so_label)
            if ac and ac.group(1) in EO_AGE_CODE_MAP:
                age_min, age_max = EO_AGE_CODE_MAP[ac.group(1)]
                age_male = f'{age_min}~{age_max}'
            sb.table('events').update({
                'is_closed': True,
                'age_male': age_male,
                'age_female': '나이 무관',
                'age_range_min': age_min,
                'age_range_max': age_max,
            }).eq('id', existing_key[key]).execute()
            updated += 1

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

    # idx → 지역(상품 제목 대괄호)·상품텍스트(해시태그 생성용)
    idx_region = {}
    idx_text = {}
    for u, text in products.items():
        mi = re.search(r'idx=(\d+)', u)
        if not mi:
            continue
        if mi.group(1) not in idx_text:
            idx_text[mi.group(1)] = text or ''
        bm = re.search(r'\[([^\]]+)\]', text or '')
        if bm and mi.group(1) not in idx_region:
            phrase = bm.group(1).strip()
            if not re.search(r'\d', phrase):  # "6/27 GRAND OPEN" 같은 날짜 대괄호 제외
                idx_region[mi.group(1)] = phrase

    # idx → 만나이 범위. 본문 "모집연령: 88년생 ~ 04년생" → 만나이(2026: 88년생=38, 04년생=22).
    # 상품당 고정(모든 날짜 공통). 성별 구분 없음(남=여 공통).
    LOCO_AGE_RE = re.compile(r'모집\s*연령\s*[:：]?\s*(\d{2})\s*년생\s*[~∼\-]\s*(\d{2})\s*년생')
    # 본문 시작시각(요일별 패턴: 금19:30/토18:30). "🍷 7 월 10일(금) 19:30~22:00 사당"
    # 본문엔 임박한 2개 날짜만 나와서 요일→시각으로 학습해 전체 날짜에 적용.
    LOCO_TIME_RE = re.compile(
        r'\d{1,2}\s*월\s*\d{1,2}\s*일\s*\(([월화수목금토일])\)\s*(\d{1,2}):(\d{2})')

    def _age(yy):
        yy = int(yy)
        return NOW.year - (2000 + yy if yy < 30 else 1900 + yy)

    idx_age = {}
    time_map = {}  # (지역, 월, 일) → (시, 분)
    for idx in idxs:
        try:
            page.goto(f'https://{host}/shop_view/?idx={idx}',
                      timeout=30000, wait_until='domcontentloaded')
            page.wait_for_timeout(2500)
            body = page.inner_text('body')
        except Exception:
            continue
        am = LOCO_AGE_RE.search(body)
        if am:
            a1, a2 = _age(am.group(1)), _age(am.group(2))
            idx_age[idx] = (min(a1, a2), max(a1, a2))
        for tm in LOCO_TIME_RE.finditer(body):
            time_map[tm.group(1)] = (int(tm.group(2)), int(tm.group(3)))  # 요일 → (시,분)

    updated = 0
    inserts = []
    for idx in idxs:
        region = idx_region.get(idx)
        age = idx_age.get(idx)
        age_fields = {}
        if age:
            age_fields = {'age_male': f'{age[0]}~{age[1]}',
                          'age_female': f'{age[0]}~{age[1]}',
                          'age_range_min': age[0], 'age_range_max': age[1]}
        # 해시태그(상품 텍스트 '와인파티 직장인' + 지역 + 나이 기반). 비면 미설정.
        _tags = derive_hashtags(title=idx_text.get(idx), region=region,
                                age_min=age[0] if age else None,
                                age_max=age[1] if age else None)
        if _tags:
            age_fields['hashtags'] = _tags
        dates = [o for o in EO_OPT_RE.findall(eo_load_option(host, idx)) if '/' in o[2]]
        for dgh, dvh, dlb in dates:
            dm = re.search(r'(\d{1,2})/(\d{1,2})', dlb)
            if not dm:
                continue
            mo, da = int(dm.group(1)), int(dm.group(2))
            yr = NOW.year + 1 if mo < NOW.month else NOW.year
            # 본문 시각(요일 패턴: 금19:30/토18:30). 해당 요일 없으면 19:00 폴백
            try:
                dow = '월화수목금토일'[datetime(yr, mo, da).weekday()]
            except ValueError:
                continue
            hh, mm = time_map.get(dow, (19, 0))
            dt = datetime(yr, mo, da, hh, mm, tzinfo=KST)
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
            title = idx_text.get(idx, '').split('\n')[0].strip() or region or '모임'
            key = (idx, dt.strftime('%Y%m%d'))
            if key in dbmap:
                sb.table('events').update(
                    {'price_male': pm, 'price_female': pf,
                     'event_date': dt.isoformat(), 'title': title, **age_fields}
                ).eq('id', dbmap[key]).execute()
                updated += 1
            else:
                # DB에 없던 날짜 → 신규 생성(오너 확인: 사이트 12개 전부 나와야 함)
                su = f'https://{host}/party/?idx={idx}#evt={dt.strftime("%Y%m%d%H%M")}'
                inserts.append({
                    'company_id': cid,
                    'title': (idx_text.get(idx, '').split('\n')[0].strip() or region or '모임'),
                    'event_date': dt.isoformat(),
                    'location_region': region or '미정',
                    'source_url': su,
                    'is_active': True,
                    'is_closed': False,
                    'source': 'crawl',
                    'price_male': pm,
                    'price_female': pf,
                    **age_fields,
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
LC_DATE_RE = re.compile(r'(\d{1,2})[./](\d{1,2})')            # 리스팅 날짜 07.11
LC_TIME_RE = re.compile(r'(오전|오후|AM|PM)\s*(\d{1,2}):(\d{2})')  # 시간 PM 5:00(커피)/PM 7:00(호프)


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
                head = t.split('[')[0]
                st = LC_STATION_RE.search(head)
                # 날짜+시간(리스팅 실제 시각: 커피 PM5:00=17시 / 호프 PM7:00=19시)
                dm, tm = LC_DATE_RE.search(head), LC_TIME_RE.search(head)
                event_date = None
                if dm and tm:
                    mo, da = int(dm.group(1)), int(dm.group(2))
                    period, hh, mm = tm.group(1), int(tm.group(2)), int(tm.group(3))
                    if period in ('오후', 'PM') and hh < 12:
                        hh += 12
                    elif period in ('오전', 'AM') and hh == 12:
                        hh = 0
                    yr = NOW.year + 1 if mo < NOW.month else NOW.year
                    try:
                        event_date = datetime(yr, mo, da, hh, mm, tzinfo=KST).isoformat()
                    except ValueError:
                        pass
                parsed[pth] = {
                    'price_male': int(pm.group(1).replace(',', '')) if pm else None,
                    'price_female': int(pf.group(1).replace(',', '')) if pf else None,
                    'age_male': f'{am.group(1)}~{am.group(2)}' if am else None,
                    'age_female': f'{af.group(1)}~{af.group(2)}' if af else None,
                    'region': st.group(1) if st else None,
                    'event_date': event_date,
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
        if r.get('event_date'):
            fields['event_date'] = r['event_date']    # 실제 시각으로 교체(커피17시/호프19시)
        sb.table('events').update(fields).eq('id', dbmap[pth]).execute()
        updated += 1
    return updated


# 연인어때 전용 정규식
YN_DATE_RE = re.compile(r'(\d{1,2})/(\d{1,2})')
YN_TIME_RE = re.compile(r'(오전|오후)?\s*(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?')
YN_AGE_RE = re.compile(r'남[:\s]*(\d{2})[-~](\d{2})')  # 남 출생연도 예: 92-99


def discover_yeonin(slug='yeonin'):
    """연인어때 전용 — imweb 3단계(지역→성별→일시). 일시 옵션 라벨+가격span에서
    슬롯별 날짜/시간/남성나이(출생연도→만나이)/성별가격/품절을 파싱.
    지역상품 9개(최신 서머리 연관상품)를 돌며 (지역×날짜×시간)슬롯당 1이벤트 생성.
    기존 이벤트(잘못된 형식)는 전부 삭제 후 교체(오너 승인). 품절=price_detail.regular_soldout(앱 취소선)."""
    cid = company_id(slug)
    HOST = 'yeonin.co.kr'

    def sel_str(pairs):
        return ''.join(
            f'&selected_require_options%5B{i}%5D%5Bvalue_type%5D=SELECT'
            f'&selected_require_options%5B{i}%5D%5Boption_code%5D={gh}'
            f'&selected_require_options%5B{i}%5D%5Bvalue_code%5D={vh}'
            for i, (gh, vh) in enumerate(pairs))

    def to_age(yy):
        yy = int(yy)
        return NOW.year - (2000 + yy if yy < 30 else 1900 + yy)

    def parse_slots(body):
        out = {}
        for it in re.findall(r'<div class="dropdown-item.*?</a>', body, re.S):
            lb = re.search(r'margin-bottom-lg">([^<]+)<', it)
            pr = re.search(r'<strong>\s*₩?\s*([\d,]+)', it)
            if not lb or not pr:
                continue
            L = lb.group(1)
            dm, tm = YN_DATE_RE.search(L), YN_TIME_RE.search(L)
            if not dm or not tm:
                continue
            mo, da = int(dm.group(1)), int(dm.group(2))
            per, h, mi = tm.group(1), int(tm.group(2)), int(tm.group(3) or 0)
            if per == '오후' and h < 12:
                h += 12
            elif not per and 1 <= h <= 9:
                h += 12
            yr = NOW.year + 1 if mo < NOW.month else NOW.year
            try:
                dt = datetime(yr, mo, da, h, mi, tzinfo=KST)
            except ValueError:
                continue
            if not (NOW <= dt <= HORIZON):
                continue
            am = YN_AGE_RE.search(L)
            age = (to_age(am.group(2)), to_age(am.group(1))) if am else None
            out[dt] = {'price': int(pr.group(1).replace(',', '')),
                       'soldout': '품절' in it, 'age': age}
        return out

    # 1) 지역상품 확보 (최신 월 서머리의 연관상품)
    products = {}
    names = {}  # idx → 상품명(이벤트 제목)
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_context(ignore_https_errors=True, locale='ko-KR', user_agent=UA).new_page()
        try:
            pg.goto('https://yeonin.co.kr/schedule', timeout=30000, wait_until='domcontentloaded')
            pg.wait_for_timeout(2500)
            links = pg.eval_on_selector_all(
                'a[href*="idx="]', 'els=>els.map(e=>({h:e.href,t:e.innerText.trim()}))')
            summ = next((x for x in links if '로테이션 소개팅 일정' in x['t']), None)
            if summ:
                url = summ['h'] if 'bmode' in summ['h'] else summ['h'] + '&bmode=view'
                pg.goto(url, timeout=30000, wait_until='domcontentloaded')
                pg.wait_for_timeout(3000)
                rel = pg.eval_on_selector_all(
                    'a[href*="shop_view"]', 'els=>els.map(e=>({h:e.href,t:e.innerText.trim()}))')
                for it in rel:
                    m = re.search(r'idx=(\d+)', it['h'])
                    reg = re.search(r'\[([^\]]+)\]', it['t'])
                    if m and reg and m.group(1) not in products:
                        products[m.group(1)] = reg.group(1).strip()
                        # 상품명(첫 줄) = 이벤트 제목
                        nm = (it['t'] or '').split('\n')[0].strip()
                        names[m.group(1)] = nm or reg.group(1).strip()
        except Exception as e:
            print(f"연인어때 상품 확보 실패: {e}")
        b.close()
    if not products:
        print("연인어때 상품 0개 — 중단(기존 삭제 안 함)")
        return 0

    # 2) 각 상품 파싱 → 슬롯 이벤트
    rows = []
    for idx, region in products.items():
        base = eo_load_option(HOST, idx)
        regs = EO_OPT_RE.findall(base)
        if not regs:
            continue
        r0 = regs[0]
        b2 = eo_load_option(HOST, idx, sel_str([(r0[0], r0[1])]))
        gmap = {o[2]: (o[0], o[1]) for o in EO_OPT_RE.findall(b2) if o[2] in ('남성', '여성')}
        M = parse_slots(eo_load_option(HOST, idx, sel_str([(r0[0], r0[1]), gmap['남성']]))) if '남성' in gmap else {}
        F = parse_slots(eo_load_option(HOST, idx, sel_str([(r0[0], r0[1]), gmap['여성']]))) if '여성' in gmap else {}
        for dt in sorted(set(M) | set(F)):
            m, f = M.get(dt), F.get(dt)
            age = (m or f).get('age')
            detail = {}
            if m:
                detail['male'] = {'regular': m['price'], **({'regular_soldout': True} if m['soldout'] else {})}
            if f:
                detail['female'] = {'regular': f['price'], **({'regular_soldout': True} if f['soldout'] else {})}
            age_male = f'{age[0]}~{age[1]}' if age else None
            su = f'https://{HOST}/shop_view?idx={idx}#evt={dt.strftime("%Y%m%d%H%M")}'
            tags = derive_hashtags(title='직장인 로테이션 소개팅', region=region,
                                   age_min=age[0] if age else None, age_max=age[1] if age else None)
            rows.append({
                'company_id': cid, 'title': names.get(idx) or region,
                'event_date': dt.isoformat(), 'location_region': region,
                'source_url': su, 'is_active': True,
                'is_closed': bool(m and m['soldout'] and f and f['soldout']),
                'source': 'crawl',
                'price_male': m['price'] if m else None,
                'price_female': f['price'] if f else None,
                'age_male': age_male,
                'age_female': '나이 무관',  # 연인어때 여성=제한 없음
                'age_range_min': age[0] if age else None,
                'age_range_max': age[1] if age else None,
                'price_detail': detail or None,
                'hashtags': tags or None,
            })

    if not rows:
        print("연인어때 슬롯 0개 — 중단(기존 삭제 안 함)")
        return 0

    # 3) 기존 전부 삭제 후 교체 (오너 승인 A)
    sb.table('events').delete().eq('company_id', cid).execute()
    for i in range(0, len(rows), 100):
        sb.table('events').upsert(rows[i:i+100], on_conflict='source_url',
                                  ignore_duplicates=True).execute()
    return len(rows)


# ── 토크블라썸 전용: Cafe24 연동옵션(성별→일시) 캐스케이드 ──────────────────
# 일시 옵션 라벨 = "7월 18일 토|13:30|99-86|결혼|리뷰필수 (-2,000원)"
#   = 날짜 | 시간 | 출생연도(만나이) | 테마(STAR/결혼/MVP) | (변형/예약대기석)
# 예약대기석=품절, 리뷰필수(-2,000)=조건부할인(무시·정가), MVP=가산옵션(2티어 범위).
TB_URL = 'https://talkblossom.co.kr/product/detail.html?product_no=17'
TB_REGION = '서울역·충정로역'  # 상설 장소(옵션 라벨에 지역 없음 — 기존 크롤값 유지)
TB_DATE_RE = re.compile(r'(\d{1,2})\s*월\s*(\d{1,2})\s*일')
TB_TIME_RE = re.compile(r'(\d{1,2}):(\d{2})')
TB_AGE_RE = re.compile(r'(\d{2})\s*-\s*(\d{2})')
TB_ADJ_RE = re.compile(r'\(\s*([+\-])\s*([\d,]+)\s*원\s*\)')
TB_THEME_MAP = [('MVP', 'MVP'), ('STAR', 'STAR'), ('결혼', '결혼희망')]


def discover_talkblossom(slug='talkblossom'):
    """토크블라썸 전용 — Cafe24 연동옵션(성별→일시)을 Playwright로 캐스케이드.
    슬롯당 (날짜·시간·테마) 1이벤트. 나이=출생연도→만나이, 품절=예약대기석(성별별),
    MVP는 2티어 가격범위(regular_max), 리뷰필수 할인은 무시(정가). 기존 전부 삭제 후 교체."""
    cid = company_id(slug)

    def to_age(yy):
        yy = int(yy)
        return NOW.year - (2000 + yy if yy < 30 else 1900 + yy)

    def parse_label(L, base):
        dm, tm = TB_DATE_RE.search(L), TB_TIME_RE.search(L)
        if not dm or not tm:
            return None
        mo, da = int(dm.group(1)), int(dm.group(2))
        h, mi = int(tm.group(1)), int(tm.group(2))
        yr = NOW.year + 1 if mo < NOW.month else NOW.year
        try:
            dt = datetime(yr, mo, da, h, mi, tzinfo=KST)
        except ValueError:
            return None
        if not (NOW <= dt <= HORIZON):
            return None
        theme = next((norm for key, norm in TB_THEME_MAP if key in L), '소개팅')
        am = TB_AGE_RE.search(L)
        age = (to_age(am.group(1)), to_age(am.group(2))) if am else None
        is_review = '리뷰필수' in L
        adj = TB_ADJ_RE.search(L)
        # 리뷰필수=조건부 할인 → 정가(base)로 취급. MVP 등 가산옵션만 반영.
        price = base if is_review else (
            base + int(adj.group(2).replace(',', '')) * (1 if adj.group(1) == '+' else -1)
            if adj else base)
        return {'dt': dt, 'theme': theme, 'price': price,
                'is_review': is_review, 'soldout': '예약대기' in L, 'age': age}

    def collect(pg, gender):
        sels = pg.query_selector_all('select')
        if len(sels) < 2:
            return []
        sid0, sid1 = sels[0].get_attribute('id'), sels[1].get_attribute('id')
        pg.select_option(f'#{sid0}', label=gender)
        pg.wait_for_timeout(1800)
        labels = pg.eval_on_selector_all(f'#{sid1} option', 'els=>els.map(e=>e.innerText.trim())')
        return [l for l in labels if '월' in l and ':' in l]

    def group(labels, base):
        g = {}
        for L in labels:
            p = parse_label(L, base)
            if not p:
                continue
            key = (p['dt'], p['theme'])
            entry = g.setdefault(key, {'variants': [], 'age': None})
            entry['variants'].append(p)
            if p['age'] and not entry['age']:
                entry['age'] = p['age']
        out = {}
        for key, entry in g.items():
            prices = [v['price'] for v in entry['variants']]
            out[key] = {'pmin': min(prices), 'pmax': max(prices),
                        'soldout': all(v['soldout'] for v in entry['variants']),
                        'age': entry['age']}
        return out

    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_context(ignore_https_errors=True, locale='ko-KR', user_agent=UA).new_page()
        try:
            pg.goto(TB_URL, timeout=40000, wait_until='domcontentloaded')
            pg.wait_for_timeout(3500)
            base_txt = pg.evaluate(
                "()=>{const e=document.querySelector('#span_product_price_text');return e?e.innerText:''}")
            base = int(re.sub(r'[^\d]', '', base_txt) or 0)
            M = group(collect(pg, '남자'), base)
            pg.goto(TB_URL, timeout=40000, wait_until='domcontentloaded')
            pg.wait_for_timeout(3000)
            F = group(collect(pg, '여자'), base)
        except Exception as e:
            print(f"토크블라썸 옵션 수집 실패: {e}")
            b.close()
            return 0
        b.close()

    if not base or not (M or F):
        print("토크블라썸 슬롯 0개 — 중단(기존 삭제 안 함)")
        return 0

    rows = []
    for dt, theme in sorted(set(M) | set(F)):
        m, f = M.get((dt, theme)), F.get((dt, theme))
        age = (m or f)['age']
        detail = {}
        for gk, gv in (('male', m), ('female', f)):
            if not gv:
                continue
            d = {'regular': gv['pmin']}
            if gv['pmax'] > gv['pmin']:
                d['regular_max'] = gv['pmax']
            if gv['soldout']:
                d['regular_soldout'] = True
            detail[gk] = d
        present = [gv for gv in (m, f) if gv]
        age_str = f'{age[0]}~{age[1]}' if age else None
        su = f'{TB_URL}#evt={dt.strftime("%Y%m%d%H%M")}'
        tags = derive_hashtags(title='로테이션 소개팅', region=TB_REGION,
                               age_min=age[0] if age else None, age_max=age[1] if age else None)
        rows.append({
            'company_id': cid, 'title': '토크블라썸 로테이션 소개팅',
            'event_date': dt.isoformat(), 'location_region': TB_REGION,
            'source_url': su, 'is_active': True,
            'is_closed': bool(present) and all(gv['soldout'] for gv in present),
            'source': 'crawl',
            'price_male': m['pmin'] if m else None,
            'price_female': f['pmin'] if f else None,
            'age_male': age_str, 'age_female': age_str,
            'age_range_min': age[0] if age else None,
            'age_range_max': age[1] if age else None,
            'price_detail': detail or None,
            'theme': [theme],
            'hashtags': tags or None,
        })

    # 기존 전부 삭제 후 교체 (오너 승인)
    sb.table('events').delete().eq('company_id', cid).execute()
    for i in range(0, len(rows), 100):
        sb.table('events').upsert(rows[i:i+100], on_conflict='source_url',
                                  ignore_duplicates=True).execute()
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


def discover_frip(slug, ScraperClass):
    """프립 전용 — schedulesByYearMonth로 상품당 '전체 일정'을 이벤트화(옛 1일정 한계 해결).
    - 일정별: 성별 가격/성별 잔여석/나이(예약옵션 이름 '28-37세'=업체 달력과 일치). 잔여 0→품절.
    - source_url=상품URL#evt=일시(일정별 유니크). 통합(다지점) 상품은 스크래퍼가 스킵.
    - 기존 crawl+manual(옛 스크래퍼 산출물) 전부 삭제 후 재적재. verified(오너 확정)는 보존."""
    cid = company_id(slug)
    events = ScraperClass().scrape()

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
        su = d.get('source_url')  # 스크래퍼가 #evt=일시 앵커 포함해 유니크하게 생성
        if not su or su in seen:
            continue
        seen.add(su)

        pm, pf = d.get('price_male'), d.get('price_female')
        sm, sf = d.get('seats_left_male'), d.get('seats_left_female')
        amin, amax = d.get('age_range_min'), d.get('age_range_max')
        has_age = bool(amin and amax)  # 옵션이름/년생/N세이하/2030 등에서 뽑은 만나이
        # 오너 방침: 나이 못 뽑는 이벤트는 넣지 않는다(업체가 연령 미표기 → 뽑을 값 없음
        # 확인 완료). 앱에 뜨는 프립은 100% 나이 있음.
        if not has_age:
            continue
        age_text = f'{amin}~{amax}'

        detail = {}
        if pm is not None:
            detail['male'] = {'regular': pm, **({'regular_soldout': True} if sm == 0 else {})}
        if pf is not None:
            detail['female'] = {'regular': pf, **({'regular_soldout': True} if sf == 0 else {})}
        is_closed = (sm == 0 and sf == 0) if (sm is not None and sf is not None) else False

        region = d.get('location_region') or '미정'
        tags = derive_hashtags(title=d.get('title') or '', region=region,
                               age_min=amin if has_age else None,
                               age_max=amax if has_age else None)
        rows.append({
            'company_id': cid,
            'title': d.get('title') or _NAME_CACHE.get(cid) or '모임',
            'description': d.get('description'),
            'event_date': dt.isoformat(),
            'location_region': region,
            'location_detail': d.get('location_detail'),
            'source_url': su, 'is_active': True, 'is_closed': is_closed,
            'source': 'crawl',
            'price_male': pm, 'price_female': pf,
            'age_male': age_text, 'age_female': age_text,
            'age_range_min': amin if has_age else None,
            'age_range_max': amax if has_age else None,
            'price_detail': detail or None,
            'seats_left_male': sm, 'seats_left_female': sf,
            'capacity_male': d.get('capacity_male'), 'capacity_female': d.get('capacity_female'),
            'thumbnail_urls': d.get('thumbnail_urls') or None,
            'theme': d.get('theme') or ['일반'],
            'hashtags': tags or [],
        })

    if not rows:
        print("프립 이벤트 0개 — 중단(기존 삭제 안 함)")
        return 0
    # 옛 스크래퍼 산출물(crawl/manual) 전부 삭제, verified(오너 확정)만 보존
    sb.table('events').delete().eq('company_id', cid).in_('source', ['crawl', 'manual']).execute()
    for i in range(0, len(rows), 100):
        sb.table('events').upsert(rows[i:i+100], on_conflict='source_url',
                                  ignore_duplicates=True).execute()
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
            elif slug == 'yeonin':
                n = discover_yeonin(slug)
            elif slug == 'talkblossom':
                n = discover_talkblossom(slug)
            elif slug == 'frip':
                n = discover_frip(slug, ScraperClass)
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
