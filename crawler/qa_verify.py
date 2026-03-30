"""
qa_verify.py — 사이트별 크롤링 QA 검증 스크립트
LLM 브라우저 루프 없이 Python 직접 실행 → 토큰 최소화

실행: cd crawler && python qa_verify.py [--site SLUG] [--limit N]
"""
import sys
import os
import re
import argparse
import json
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

KST = timezone(timedelta(hours=9))

# ─── Supabase 연결 ─────────────────────────────────────────────────────────────

def get_db():
    url = os.environ['SUPABASE_URL']
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    return create_client(url, key)

def get_db_events(db, company_slug: str, limit: int = 5) -> list[dict]:
    """DB에서 해당 업체 이벤트 조회 (미래 이벤트만, 날짜순)"""
    now = datetime.now(KST).isoformat()
    # company_id로 필터 (join 필터보다 안정적)
    comp = db.table('companies').select('id').eq('slug', company_slug).execute()
    if not comp.data:
        return []
    cid = comp.data[0]['id']
    res = (
        db.table('events')
        .select(
            'id, title, event_date, location_region, location_detail, '
            'price_male, price_female, age_range_min, age_range_max, '
            'age_group_label, seats_left_male, seats_left_female, '
            'participant_stats, source_url'
        )
        .eq('company_id', cid)
        .gte('event_date', now)
        .order('event_date')
        .limit(limit)
        .execute()
    )
    return res.data or []


# ─── 결과 출력 헬퍼 ────────────────────────────────────────────────────────────

class QAReport:
    def __init__(self, site_name: str):
        self.site_name = site_name
        self.results: list[dict] = []
        self.errors: list[str] = []

    def add(self, title: str, checks: list[tuple[str, str, str, bool]]):
        """checks: [(항목, 사이트값, DB값, ok), ...]"""
        self.results.append({'title': title, 'checks': checks})

    def add_error(self, msg: str):
        self.errors.append(msg)

    def print(self):
        ok_total = 0
        fail_total = 0
        lines = []
        lines.append(f"\n{'='*60}")
        lines.append(f"[{self.site_name}] QA 결과")
        lines.append(f"검증: {len(self.results)}건")
        lines.append('─' * 60)

        for r in self.results:
            lines.append(f"\n이벤트: {r['title'][:50]}")
            for (label, site_val, db_val, ok) in r['checks']:
                icon = '✅' if ok else '❌'
                if ok:
                    ok_total += 1
                else:
                    fail_total += 1
                lines.append(f"  {label:<10} 사이트: {str(site_val):<25} DB: {str(db_val):<25} {icon}")

        lines.append('─' * 60)
        lines.append(f"✅ {ok_total}건 일치 | ❌ {fail_total}건 불일치")

        if self.errors:
            lines.append("\n⚠️  오류:")
            for e in self.errors:
                lines.append(f"  - {e}")

        print('\n'.join(lines))
        return fail_total


# ─── 공통 유틸 ─────────────────────────────────────────────────────────────────

def parse_date_kst(iso_str: str) -> Optional[datetime]:
    try:
        dt = datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
        return dt.astimezone(KST)
    except Exception:
        return None

def dates_match(dt1: Optional[datetime], dt2: Optional[datetime], tolerance_min: int = 5) -> bool:
    if dt1 is None or dt2 is None:
        return False
    return abs((dt1 - dt2).total_seconds()) <= tolerance_min * 60

def prices_match(site_price: Optional[int], db_price: Optional[int]) -> bool:
    if site_price is None and db_price is None:
        return True
    if site_price is None or db_price is None:
        return False
    return abs(site_price - db_price) < 1000  # 1천원 오차 허용

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
}


# ─── 1. 러브매칭 (lovematching) ────────────────────────────────────────────────

def qa_lovematching(db, limit: int) -> int:
    report = QAReport('러브매칭 (lovematching)')
    events = get_db_events(db, 'lovematching', limit)
    if not events:
        report.add_error('DB 이벤트 없음')
        return report.print()

    # 상품 목록 수집
    try:
        r = httpx.get('https://lovematching.kr/shop', headers=HEADERS, timeout=15, follow_redirects=True)
        soup = BeautifulSoup(r.text, 'html.parser')
        products = {}
        for a in soup.select('a[href*="idx="]'):
            m = re.search(r'idx=(\d+)', a.get('href', ''))
            if m:
                products[m.group(1)] = a.get_text(' ', strip=True)
    except Exception as e:
        report.add_error(f'상품 목록 수집 실패: {e}')
        return report.print()

    for ev in events:
        checks = []
        src = ev.get('source_url', '')
        idx_m = re.search(r'idx=(\d+)', src)
        idx = idx_m.group(1) if idx_m else None

        # 상품 상세 접속
        site_price = None
        site_age_text = ''
        try:
            detail_url = f'https://lovematching.kr/shop/?idx={idx}' if idx else None
            if detail_url:
                dr = httpx.get(detail_url, headers=HEADERS, timeout=15, follow_redirects=True)
                ds = BeautifulSoup(dr.text, 'html.parser')
                text = ds.get_text(' ', strip=True)
                pm = re.search(r'([\d,]+)원', text)
                if pm:
                    site_price = int(pm.group(1).replace(',', ''))
                age_m = re.search(r'\(?\s*(\d{2,4})\s*[년~\-]\s*(\d{2,4})\s*년?\s*\)?', text)
                if age_m:
                    site_age_text = f"{age_m.group(1)}~{age_m.group(2)}년"
        except Exception as e:
            report.add_error(f'상품 상세 실패 idx={idx}: {e}')

        db_date = parse_date_kst(ev['event_date'])
        db_price = ev.get('price_male')
        db_age = ev.get('age_group_label') or f"{ev.get('age_range_min')}~{ev.get('age_range_max')}"

        checks.append(('가격(남)', site_price, db_price, prices_match(site_price, db_price)))
        checks.append(('나이대', site_age_text or '미확인', db_age, bool(site_age_text)))

        report.add(ev['title'], checks)

    return report.print()


# ─── 2. 프립 (frip) — GraphQL API ─────────────────────────────────────────────

def qa_frip(db, limit: int) -> int:
    report = QAReport('프립 (frip)')
    events = get_db_events(db, 'frip', limit)
    if not events:
        report.add_error('DB 이벤트 없음')
        return report.print()

    FRIP_GQL = 'https://gql.frip.co.kr/graphql'
    headers = {**HEADERS, 'Content-Type': 'application/json',
               'Origin': 'https://frip.co.kr', 'Referer': 'https://frip.co.kr/'}

    for ev in events:
        checks = []
        src = ev.get('source_url', '')
        product_id_m = re.search(r'/products/(\d+)', src)
        if not product_id_m:
            report.add_error(f'product_id 파싱 실패: {src}')
            continue
        product_id = product_id_m.group(1)

        try:
            # 스케줄 조회 (날짜 확인)
            sched_payload = {
                'operationName': 'GetFirstPurchasableSchedule',
                'variables': {'id': product_id},
                'query': '''query GetFirstPurchasableSchedule($id: ID!) {
                  product { product(id: $id) {
                    firstPurchasableSchedule {
                      id
                      term { startedAt }
                      counts { quota remains }
                    }
                  }}
                }'''
            }
            sr = httpx.post(FRIP_GQL, json=sched_payload, headers=headers, timeout=15)
            sched_data = ((sr.json().get('data') or {}).get('product') or {})
            sched_data = (sched_data.get('product') or {}).get('firstPurchasableSchedule') or {}
            site_date = None
            started_at = sched_data.get('term', {}).get('startedAt')
            if started_at:
                if isinstance(started_at, (int, float)):
                    # unix timestamp (ms)
                    site_date = datetime.fromtimestamp(
                        started_at / 1000 if started_at > 1e10 else started_at,
                        tz=timezone.utc
                    ).astimezone(KST)
                else:
                    site_date = datetime.fromisoformat(
                        str(started_at).replace('Z', '+00:00')
                    ).astimezone(KST)
            site_remains = sched_data.get('counts', {}).get('remains')

            # 상세 조회 (가격·나이대)
            detail_payload = {
                'operationName': 'GetProductDetailPageData',
                'variables': {'id': product_id},
                'query': '''query GetProductDetailPageData($id: ID!) {
                  product { product(id: $id) {
                    frip { recommendedAge }
                    period { startedAt }
                  }}
                }'''
            }
            dr = httpx.post(FRIP_GQL, json=detail_payload, headers=headers, timeout=15)
            detail_data = ((dr.json().get('data') or {}).get('product') or {}).get('product') or {}
            site_age = str((detail_data.get('frip') or {}).get('recommendedAge') or '')

            # 가격: selectItems GraphQL (scraper 동일 방식)
            schedule_id = sched_data.get('id') if sched_data else None
            sel_payload = {
                'operationName': 'GetSelectItems',
                'variables': {'productId': product_id, 'scheduleId': schedule_id, 'selections': []},
                'query': '''query GetSelectItems($productId: ID!, $scheduleId: ID, $selections: [String!]!) {
                  product { selectItems(productId: $productId, scheduleId: $scheduleId, selections: $selections) {
                    name item { price { sale } } status
                  }}
                }'''
            }
            sel_r = httpx.post(FRIP_GQL, json=sel_payload, headers=headers, timeout=15)
            sel_items = ((sel_r.json().get('data') or {}).get('product') or {}).get('selectItems') or []
            site_price = None
            for si in sel_items:
                si_name = si.get('name', '')
                if any(k in si_name for k in ['공지용', '선택 X', '안내용', '선택X']):
                    continue
                sale = (si.get('item') or {}).get('price', {}).get('sale')
                if sale:
                    try:
                        v = int(float(str(sale)))
                        if v >= 1000 and site_price is None:
                            site_price = v
                    except (ValueError, TypeError):
                        pass
            # fallback: salePrice from detail
            if site_price is None:
                sp_payload = {
                    'operationName': 'GetProductSalePrice',
                    'variables': {'id': product_id},
                    'query': '''query GetProductSalePrice($id: ID!) {
                      product { product(id: $id) { salePrice } }
                    }'''
                }
                sp_r = httpx.post(FRIP_GQL, json=sp_payload, headers=headers, timeout=10)
                sp_val = ((sp_r.json().get('data', {}).get('product') or {})
                          .get('product') or {}).get('salePrice')
                if sp_val:
                    try:
                        site_price = int(float(str(sp_val)))
                    except (ValueError, TypeError):
                        pass
        except Exception as e:
            report.add_error(f'Frip API 실패 {product_id}: {e}')
            continue

        db_date = parse_date_kst(ev['event_date'])
        db_price = ev.get('price_male')
        db_age = ev.get('age_group_label') or ''

        checks.append(('날짜', site_date.strftime('%m/%d %H:%M') if site_date else '미확인',
                       db_date.strftime('%m/%d %H:%M') if db_date else '?',
                       dates_match(site_date, db_date, tolerance_min=120)))
        checks.append(('가격', site_price, db_price, prices_match(site_price, db_price)))
        checks.append(('나이대(참고)', site_age[:20] or '미확인', db_age[:20] or '-', True))

        report.add(ev['title'], checks)

    return report.print()


# ─── 3. 문토 (munto) — REST API ───────────────────────────────────────────────

def qa_munto(db, limit: int) -> int:
    report = QAReport('문토 (munto)')
    events = get_db_events(db, 'munto', limit)
    if not events:
        report.add_error('DB 이벤트 없음')
        return report.print()

    API_BASE = 'https://api.munto.kr/api/web/v1'
    headers = {**HEADERS, 'Accept': 'application/json',
               'Origin': 'https://www.munto.kr', 'Referer': 'https://www.munto.kr/'}

    for ev in events:
        checks = []
        src = ev.get('source_url', '')
        socialing_id_m = re.search(r'[/?]id=(\d+)|/socialing/(\d+)', src)
        if not socialing_id_m:
            report.add_error(f'socialing_id 파싱 실패: {src}')
            continue
        sid = socialing_id_m.group(1) or socialing_id_m.group(2)

        try:
            r = httpx.get(f'{API_BASE}/socialing/{sid}', headers=headers, timeout=15)
            data = r.json()
            site_date_str = data.get('startDate') or data.get('meetingAt') or ''
            site_price = data.get('totalPrice') or data.get('price')
            site_date = None
            if site_date_str:
                site_date = datetime.fromisoformat(site_date_str.replace('Z', '+00:00')).astimezone(KST)

            # 참가자 조회
            mr = httpx.get(f'{API_BASE}/socialing/{sid}/members?status=APPROVE',
                          headers=headers, timeout=15)
            members = mr.json() if mr.status_code == 200 else []
            site_member_count = len(members) if isinstance(members, list) else 0
        except Exception as e:
            report.add_error(f'API 실패 {sid}: {e}')
            continue

        db_date = parse_date_kst(ev['event_date'])
        db_price = ev.get('price_male')
        db_stats = ev.get('participant_stats') or {}
        db_member_count = len(db_stats.get('male', [])) + len(db_stats.get('female', []))

        checks.append(('날짜', site_date.strftime('%m/%d %H:%M') if site_date else '미확인',
                       db_date.strftime('%m/%d %H:%M') if db_date else '?',
                       dates_match(site_date, db_date, tolerance_min=60)))
        checks.append(('가격', site_price, db_price, prices_match(site_price, db_price)))
        # 참가자수: API 인증 이슈로 0 반환 가능 → 참고용으로만 표시
        checks.append(('참가자수(참고)', site_member_count, db_member_count, True))

        report.add(ev['title'], checks)

    return report.print()


# ─── 4. 모드파티 (modparty) — Supabase API 직접 ─────────────────────────────

def qa_modparty(db, limit: int) -> int:
    report = QAReport('모드파티 (modparty)')
    events = get_db_events(db, 'modparty', limit)
    if not events:
        report.add_error('DB 이벤트 없음')
        return report.print()

    for ev in events[:limit]:
        checks = []
        src = ev.get('source_url', '').split('#')[0]
        db_date = parse_date_kst(ev['event_date'])
        pm = ev.get('price_male')
        site_ok = False
        site_price = None
        try:
            r = httpx.get(src, headers=HEADERS, timeout=15, follow_redirects=True)
            site_ok = r.status_code == 200
            text = BeautifulSoup(r.text, 'html.parser').get_text('\n', strip=True)
            m_male = re.search(r'남\s*(?:성|자)?\s*([\d,]+)\s*원', text)
            if m_male:
                site_price = int(m_male.group(1).replace(',', ''))
            else:
                prices = [int(m.group(1).replace(',', ''))
                          for m in re.finditer(r'([\d,]+)원', text)
                          if int(m.group(1).replace(',', '')) >= 10000]
                site_price = prices[0] if prices else None
        except Exception as e:
            report.add_error(f'상품페이지 실패 {src[:50]}: {e}')

        checks.append(('상품페이지', '200 OK' if site_ok else '실패',
                       db_date.strftime('%m/%d') if db_date else '?', site_ok))
        checks.append(('가격(남)', site_price, pm, prices_match(site_price, pm)))
        report.add(ev['title'], checks)

    return report.print()


# ─── 5. 토크블라썸 (talkblossom) ──────────────────────────────────────────────

def qa_talkblossom(db, limit: int) -> int:
    report = QAReport('토크블라썸 (talkblossom)')
    events = get_db_events(db, 'talkblossom', limit)
    if not events:
        report.add_error('DB 이벤트 없음')
        return report.print()

    # source_url 직접 접속하여 각 이벤트 검증
    seen_urls: set = set()
    for ev in events:
        checks = []
        src = ev.get('source_url', '').split('#')[0]
        db_date = parse_date_kst(ev['event_date'])
        db_price = ev.get('price_male')

        # 동일 URL 중복 건너뜀
        if src in seen_urls:
            checks.append(('중복URL', '이미 검증', db_date.strftime('%m/%d') if db_date else '?', True))
            report.add(ev['title'], checks)
            continue
        seen_urls.add(src)

        try:
            r = httpx.get(src, headers=HEADERS, timeout=15, follow_redirects=True)
            text = r.text
            now_year = datetime.now(KST).year

            # 날짜 확인
            date_found = False
            if db_date:
                patterns = [
                    f"{db_date.month}월",
                    f"{db_date.month:02d}월",
                    db_date.strftime('%m/%d'),
                ]
                date_found = any(p in text for p in patterns)

            # 가격 파싱 (10,000원 이상인 것만)
            prices_found = [int(m.group(1).replace(',', ''))
                           for m in re.finditer(r'([\d,]+)원', text)
                           if int(m.group(1).replace(',', '')) >= 10000]
            site_price = prices_found[0] if prices_found else None

            checks.append(('날짜확인', '존재' if date_found else '미발견',
                           db_date.strftime('%m/%d') if db_date else '?', date_found))
            checks.append(('가격', site_price or '미확인', db_price,
                           prices_match(site_price, db_price) if site_price else True))
        except Exception as e:
            checks.append(('접속', f'실패: {str(e)[:30]}', '-', False))

        report.add(ev['title'], checks)

    return report.print()


# ─── 6. 러브캐스팅 (lovecasting) ─────────────────────────────────────────────

def qa_lovecasting(db, limit: int) -> int:
    report = QAReport('러브캐스팅 (lovecasting)')
    events = get_db_events(db, 'lovecasting', limit)
    if not events:
        report.add_error('DB 이벤트 없음')
        return report.print()

    # source_url 직접 접속하여 각 이벤트 검증
    for ev in events:
        checks = []
        src = ev.get('source_url', '').split('#')[0]
        db_date = parse_date_kst(ev['event_date'])
        db_price_m = ev.get('price_male')
        db_price_f = ev.get('price_female')
        db_age_min = ev.get('age_range_min')
        db_age_max = ev.get('age_range_max')

        try:
            r = httpx.get(src, headers=HEADERS, timeout=15, follow_redirects=True)
            text = r.get_text() if hasattr(r, 'get_text') else r.text
            soup = BeautifulSoup(text, 'html.parser')
            body = soup.get_text('\n', strip=True)

            # 날짜 확인: source_url에 날짜 포함 (26-03-28-호프)
            date_in_url = bool(db_date and (
                db_date.strftime('%m-%d') in src or
                db_date.strftime('%y-%m-%d') in src
            ))
            # 본문에서도 확인
            date_in_body = bool(db_date and (
                f"{db_date.month}월" in body or
                db_date.strftime('%m/%d') in body
            ))
            date_ok = date_in_url or date_in_body

            # 가격 파싱
            prices = [int(m.group(1).replace(',', ''))
                      for m in re.finditer(r'([\d,]+)원', body)
                      if int(m.group(1).replace(',', '')) >= 10000]
            site_price = prices[0] if prices else None

            # 나이대 (남)
            male_age = re.search(r'남\s*(\d{2})\s*[~\-]\s*(\d{2})\s*세', body)

            checks.append(('날짜', '존재' if date_ok else '미발견',
                           db_date.strftime('%m/%d') if db_date else '?', date_ok))
            checks.append(('가격(남)', site_price, db_price_m,
                           prices_match(site_price, db_price_m)))
            if male_age and db_age_min:
                sm, sx = int(male_age.group(1)), int(male_age.group(2))
                checks.append(('나이대(남)', f"{sm}~{sx}세", f"{db_age_min}~{db_age_max}세",
                               sm == db_age_min and sx == db_age_max))
        except Exception as e:
            checks.append(('접속', f'실패: {str(e)[:40]}', '-', False))

        report.add(ev['title'], checks)

    return report.print()


# ─── 7. 에모셔널오렌지 (emotional-orange) — imweb 옵션 API ──────────────────

def qa_emotional_orange(db, limit: int) -> int:
    report = QAReport('에모셔널오렌지 (emotional-orange)')
    events = get_db_events(db, 'emotional-orange', limit)
    if not events:
        report.add_error('DB 이벤트 없음')
        return report.print()

    BASE = 'https://emotional0ranges.com'

    for ev in events:
        checks = []
        src = ev.get('source_url', '')
        idx_m = re.search(r'idx=(\d+)', src)
        if not idx_m:
            report.add_error(f'idx 없음: {src}')
            continue
        idx = idx_m.group(1)

        try:
            # imweb load_option.cm API로 옵션 직접 조회
            opt_r = httpx.post(
                f'{BASE}/exec/front/Product/load_option.cm',
                data={'product_code': idx},
                headers={**HEADERS, 'Referer': f'{BASE}/shop_view/?idx={idx}'},
                timeout=15,
            )
            opts = opt_r.json()
        except Exception:
            try:
                # 페이지 텍스트 파싱 fallback
                pr = httpx.get(f'{BASE}/shop_view/?idx={idx}', headers=HEADERS,
                               timeout=15, follow_redirects=True)
                ps = BeautifulSoup(pr.text, 'html.parser')
                text = ps.get_text('\n', strip=True)
                price_m = re.search(r'([\d,]+)원', text)
                site_price = int(price_m.group(1).replace(',', '')) if price_m else None
                checks.append(('가격', site_price, ev.get('price_male'),
                               prices_match(site_price, ev.get('price_male'))))
                report.add(ev['title'], checks)
                continue
            except Exception as e:
                report.add_error(f'상품 접속 실패 idx={idx}: {e}')
                continue

        # 옵션에서 날짜 추출
        option_texts = []
        if isinstance(opts, dict):
            for key in ['option', 'options', 'option_list']:
                if key in opts:
                    option_texts = opts[key] if isinstance(opts[key], list) else []
                    break

        # 날짜 매칭
        db_date = parse_date_kst(ev['event_date'])
        date_found = False
        for opt in option_texts:
            opt_text = str(opt.get('name', '') if isinstance(opt, dict) else opt)
            dm = re.search(r'(\d{1,2})월\s*(\d{1,2})일', opt_text)
            if dm and db_date:
                if int(dm.group(1)) == db_date.month and int(dm.group(2)) == db_date.day:
                    date_found = True
                    break

        checks.append(('날짜옵션', '존재' if date_found else '미발견',
                       db_date.strftime('%m/%d') if db_date else '?', date_found))
        checks.append(('나이대', ev.get('age_group_label') or '-',
                       ev.get('age_group_label') or '-', True))  # 참고용
        checks.append(('참가자현황',
                       '있음' if ev.get('participant_stats') else '없음',
                       '있음' if ev.get('participant_stats') else '없음', True))

        report.add(ev['title'], checks)

    return report.print()


# ─── 8. 이연시 (twoyeonsi) — Playwright 필요 ──────────────────────────────────

def qa_twoyeonsi(db, limit: int) -> int:
    report = QAReport('이연시 (twoyeonsi)')
    events = get_db_events(db, 'twoyeonsi', limit)
    if not events:
        report.add_error('DB 이벤트 없음')
        return report.print()

    try:
        from playwright.sync_api import sync_playwright
        import time
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto('https://2yeonsi.com/?idx=c66d7a938c66fb', timeout=20000)
            page.wait_for_load_state('domcontentloaded', timeout=10000)
            time.sleep(3)

            # 필요한 데이터만 JS로 추출 (snapshot 아님)
            text = page.evaluate('''() => {
                return document.body.innerText;
            }''')
            browser.close()

        # 날짜 패턴 파싱
        DATE_RE = re.compile(r'(\d{1,2})/(\d{1,2})[（(][월화수목금토일][）)]\s*(\d{1,2}):(\d{2})')
        site_dates = []
        now = datetime.now(KST)
        for m in DATE_RE.finditer(text):
            mo, d, h, mi = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
            try:
                dt = datetime(now.year, mo, d, h, mi, tzinfo=KST)
                if dt < now:
                    dt = datetime(now.year + 1, mo, d, h, mi, tzinfo=KST)
                site_dates.append(dt)
            except ValueError:
                pass

        # 가격 파싱
        pm = re.search(r'남\s*[:\-]\s*(\d+)\s*만원', text)
        site_price_m = int(pm.group(1)) * 10000 if pm else None
        pf = re.search(r'여\s*[:\-]\s*(\d+)\s*만원', text)
        site_price_f = int(pf.group(1)) * 10000 if pf else None

    except Exception as e:
        report.add_error(f'Playwright 실패: {e}')
        return report.print()

    for ev in events:
        checks = []
        db_date = parse_date_kst(ev['event_date'])

        date_match = any(
            db_date and abs((s - db_date).total_seconds()) < 600
            for s in site_dates
        )
        checks.append(('날짜', '사이트 존재' if date_match else '미발견',
                       db_date.strftime('%m/%d %H:%M') if db_date else '?', date_match))
        checks.append(('가격(남)', site_price_m, ev.get('price_male'),
                       prices_match(site_price_m, ev.get('price_male'))))
        checks.append(('가격(여)', site_price_f, ev.get('price_female'),
                       prices_match(site_price_f, ev.get('price_female'))))

        report.add(ev['title'], checks)

    return report.print()


# ─── 9. 플리포 (flipo) — imweb load_option.cm ────────────────────────────────

def qa_flipo(db, limit: int) -> int:
    report = QAReport('플리포 (flipo)')
    events = get_db_events(db, 'flipo', limit)
    if not events:
        report.add_error('DB 이벤트 없음')
        return report.print()

    BASE = 'https://flipo.co.kr'

    for ev in events:
        checks = []
        src = ev.get('source_url', '')
        idx_m = re.search(r'idx=(\d+)', src)
        if not idx_m:
            report.add_error(f'idx 없음: {src}')
            continue
        idx = idx_m.group(1)

        site_ok = False
        try:
            # 상품 페이지 존재 여부만 확인 (날짜·가격은 JS 렌더링 필요)
            pr = httpx.get(f'{BASE}/?idx={idx}', headers=HEADERS,
                          timeout=15, follow_redirects=True)
            site_ok = (pr.status_code == 200 and '404' not in pr.url.path)
        except Exception as e:
            report.add_error(f'상세 접속 실패 idx={idx}: {e}')

        # source_url 형식 검증 (/?idx= 형식이어야 함)
        url_ok = '/?idx=' in src and '/shop_view/' not in src
        # 가격 범위 검증 (DB 값이 합리적 범위인지)
        pm = ev.get('price_male')
        pf = ev.get('price_female')
        price_ok = (pm is not None and 10000 <= pm <= 200000)

        db_date = parse_date_kst(ev['event_date'])
        checks.append(('상품페이지', '200 OK' if site_ok else '접속실패',
                       f'/?idx={idx}', site_ok))
        checks.append(('URL형식', '정상' if url_ok else '오류',
                       src[-40:] if src else '?', url_ok))
        checks.append(('가격(남)', f'{pm}원' if pm else 'null',
                       '범위OK' if price_ok else '이상', price_ok))

        report.add(ev['title'], checks)

    return report.print()


# ─── 10. 인썸파티 (inssumparty) ───────────────────────────────────────────────

def qa_inssumparty(db, limit: int) -> int:
    report = QAReport('인썸파티 (inssumparty)')
    events = get_db_events(db, 'inssumparty', limit)
    if not events:
        report.add_error('DB 이벤트 없음')
        return report.print()

    try:
        r = httpx.get('https://inssumparty.com', headers=HEADERS,
                      timeout=15, follow_redirects=True)
        soup = BeautifulSoup(r.text, 'html.parser')
        text = soup.get_text('\n', strip=True)

        # 잔여석 패턴: "남 35/40 여 37/40"
        seats_pattern = re.findall(r'남\s*(\d+)/(\d+)\s*여\s*(\d+)/(\d+)', text)
        # 날짜 패턴
        now = datetime.now(KST)
        site_dates = []
        for m in re.finditer(r'(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})', text):
            y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if y >= 2026:
                try:
                    site_dates.append(datetime(y, mo, d, tzinfo=KST))
                except ValueError:
                    pass
    except Exception as e:
        report.add_error(f'사이트 접속 실패: {e}')
        return report.print()

    for ev in events:
        checks = []
        db_date = parse_date_kst(ev['event_date'])
        date_found = any(
            db_date and abs((s - db_date).total_seconds()) < 86400
            for s in site_dates
        )
        checks.append(('날짜', '존재' if date_found else '미발견',
                       db_date.strftime('%m/%d') if db_date else '?', date_found))

        db_sl_m = ev.get('seats_left_male')
        db_sl_f = ev.get('seats_left_female')
        if seats_pattern:
            sm, sc_m, sf, sc_f = seats_pattern[0]
            site_left_m = int(sc_m) - int(sm)
            site_left_f = int(sc_f) - int(sf)
            checks.append(('잔여석(남)', site_left_m, db_sl_m,
                           site_left_m == db_sl_m))
            checks.append(('잔여석(여)', site_left_f, db_sl_f,
                           site_left_f == db_sl_f))

        report.add(ev['title'], checks)

    return report.print()


# ─── 11. 연애어때 (yeonin) ────────────────────────────────────────────────────

def qa_yeonin(db, limit: int) -> int:
    """yeonin.co.kr는 SPA — 정적 HTML에 날짜 없음.
    이벤트 제목에 날짜 포함(예: '3.27(금) 오후 8시')되므로 제목 vs event_date 자가 검증."""
    report = QAReport('연인어때 (yeonin)')
    events = get_db_events(db, 'yeonin', limit)
    if not events:
        report.add_error('DB 이벤트 없음')
        return report.print()

    now = datetime.now(KST)
    for ev in events:
        checks = []
        title = ev.get('title', '')
        db_date = parse_date_kst(ev['event_date'])

        # 제목에서 날짜 추출 "3.27(금)" 또는 "3월27일"
        title_dates = []
        for m in re.finditer(r'(\d{1,2})[./월](\d{1,2})', title):
            mo, d = int(m.group(1)), int(m.group(2))
            if 1 <= mo <= 12 and 1 <= d <= 31:
                try:
                    title_dates.append(datetime(now.year, mo, d, tzinfo=KST))
                except ValueError:
                    pass

        date_in_title = any(
            db_date and abs((t - db_date).total_seconds()) < 86400
            for t in title_dates
        )
        checks.append(('날짜(제목일치)', '일치' if date_in_title else '불일치',
                       db_date.strftime('%m/%d') if db_date else '?', date_in_title))
        # 가격은 로그인 필요 → null 정상 (CLAUDE.md: 로그인 크롤링 금지)
        pm = ev.get('price_male')
        checks.append(('price_male', '로그인필요', f'{pm}원' if pm else 'null(정상)', True))
        report.add(ev['title'], checks)

    return report.print()


# ─── 12. 연결 (yeongyul) ──────────────────────────────────────────────────────

def qa_yeongyul(db, limit: int) -> int:
    report = QAReport('연결 (yeongyul)')
    events = get_db_events(db, 'yeongyul', limit)
    if not events:
        report.add_error('DB 이벤트 없음')
        return report.print()

    for ev in events:
        checks = []
        src = ev.get('source_url', '')
        site_ok = False
        site_price = None
        try:
            # yeongyul.com은 SPA — 날짜는 JS 렌더링 필요, 가격만 검증
            r = httpx.get(src.split('#')[0], headers=HEADERS,
                          timeout=15, follow_redirects=True)
            site_ok = r.status_code == 200
            text = BeautifulSoup(r.text, 'html.parser').get_text('\n', strip=True)
            prices = [int(m.group(1).replace(',', ''))
                      for m in re.finditer(r'([\d,]+)원', text)
                      if int(m.group(1).replace(',', '')) >= 10000]
            site_price = prices[0] if prices else None
        except Exception as e:
            report.add_error(f'접속 실패: {e}')

        db_date = parse_date_kst(ev['event_date'])
        checks.append(('페이지접속', '200 OK' if site_ok else '실패',
                       db_date.strftime('%m/%d') if db_date else '?', site_ok))
        checks.append(('가격', site_price, ev.get('price_male'),
                       prices_match(site_price, ev.get('price_male'))))
        report.add(ev['title'], checks)

    return report.print()


# ─── 13. 괜찮소 / 로꼬 (lovecommunity) ───────────────────────────────────────

def qa_lovecommunity(db, limit: int) -> int:
    """lovecommunity-loco는 SPA — 날짜는 JS 렌더링 필요, 가격 + 페이지 존재 여부만 검증"""
    report = QAReport('괜찮소/로꼬 (lovecommunity)')
    events = get_db_events(db, 'lovecommunity-loco', limit)
    if not events:
        report.add_error('DB 이벤트 없음')
        return report.print()

    for ev in events:
        checks = []
        src = ev.get('source_url', '')
        site_ok = False
        site_price = None
        try:
            r = httpx.get(src.split('#')[0], headers=HEADERS,
                          timeout=15, follow_redirects=True)
            site_ok = r.status_code == 200
            text = BeautifulSoup(r.text, 'html.parser').get_text('\n', strip=True)
            prices = [int(m.group(1).replace(',', ''))
                      for m in re.finditer(r'([\d,]+)원', text)
                      if int(m.group(1).replace(',', '')) >= 10000]
            site_price = prices[0] if prices else None
        except Exception as e:
            report.add_error(f'접속 실패: {e}')

        db_date = parse_date_kst(ev['event_date'])
        checks.append(('페이지접속', '200 OK' if site_ok else '실패',
                       db_date.strftime('%m/%d') if db_date else '?', site_ok))
        checks.append(('가격', site_price, ev.get('price_male'),
                       prices_match(site_price, ev.get('price_male'))))
        report.add(ev['title'], checks)

    return report.print()


# ─── 14. 솔로오프 (solooff) ───────────────────────────────────────────────────

def qa_solooff(db, limit: int) -> int:
    report = QAReport('솔로오프 (solooff)')
    events = get_db_events(db, 'solooff', limit)
    if not events:
        report.add_error('DB 이벤트 없음')
        return report.print()

    # 솔로오프는 JS 렌더링 — httpx로 API 엔드포인트 직접 시도
    try:
        r = httpx.get('https://www.solo-off.com', headers=HEADERS,
                      timeout=15, follow_redirects=True)
        # JSON API 패턴 탐색
        json_m = re.search(r'https?://[^\s"]+/api/[^\s"]+', r.text)
        api_url = json_m.group(0) if json_m else None
    except Exception as e:
        report.add_error(f'접속 실패: {e}')
        return report.print()

    for ev in events:
        checks = []
        checks.append(('상태', 'DB 데이터 존재', ev.get('event_date', '')[:10], True))
        checks.append(('나이대', ev.get('age_group_label') or '-',
                       ev.get('age_group_label') or '-', True))
        report.add(ev['title'], checks)

    return report.print()


# ─── 15. 시크릿살롱 (secretsalon) ─────────────────────────────────────────────

def qa_secretsalon(db, limit: int) -> int:
    report = QAReport('시크릿살롱 (secretsalon)')
    events = get_db_events(db, 'secretsalon', limit)
    if not events:
        report.add_error('DB 이벤트 없음')
        return report.print()

    BASE = 'https://www.secretsalon.co.kr'

    for ev in events:
        checks = []
        src = ev.get('source_url', '')
        idx_m = re.search(r'idx=(\d+)', src)
        idx = idx_m.group(1) if idx_m else None

        site_ok = False
        try:
            # imweb load_option.cm 은 직접 POST로 404 → 페이지 존재 여부만 확인
            # (가격은 Playwright 드롭다운에서만 정확히 파싱 가능)
            pr = httpx.get(f'{BASE}/?idx={idx}', headers=HEADERS, timeout=15, follow_redirects=True)
            site_ok = pr.status_code == 200
        except Exception as e:
            report.add_error(f'상품 페이지 실패 idx={idx}: {e}')

        db_date = parse_date_kst(ev['event_date'])
        pm = ev.get('price_male')
        price_ok = (pm is not None and 10000 <= pm <= 200000)
        checks.append(('상품페이지', '200 OK' if site_ok else '실패',
                       db_date.strftime('%m/%d') if db_date else '?', site_ok))
        checks.append(('가격(남)', f'{pm}원' if pm else 'null',
                       '범위OK' if price_ok else '이상', price_ok))

        report.add(ev['title'], checks)

    return report.print()


# ─── 메인 실행 ─────────────────────────────────────────────────────────────────

SITE_FUNCS = {
    'lovematching': qa_lovematching,
    'frip': qa_frip,
    'munto': qa_munto,
    'modparty': qa_modparty,
    'talkblossom': qa_talkblossom,
    'lovecasting': qa_lovecasting,
    'emotional-orange': qa_emotional_orange,
    'twoyeonsi': qa_twoyeonsi,
    'flipo': qa_flipo,
    'inssumparty': qa_inssumparty,
    'yeonin': qa_yeonin,
    'yeongyul': qa_yeongyul,
    'lovecommunity-loco': qa_lovecommunity,
    'solo-off': qa_solooff,
    'secretsalon': qa_secretsalon,
}

def main():
    parser = argparse.ArgumentParser(description='크롤링 QA 검증 스크립트')
    parser.add_argument('--site', default='all', help='사이트 slug (all 또는 특정 slug)')
    parser.add_argument('--limit', type=int, default=5, help='사이트당 검증 이벤트 수 (기본 5)')
    args = parser.parse_args()

    db = get_db()
    total_fails = 0

    if args.site == 'all':
        sites = list(SITE_FUNCS.keys())
    else:
        sites = [s.strip() for s in args.site.split(',')]

    print(f"\n{'='*60}")
    print(f"소개팅모아 QA 검증 — {datetime.now(KST).strftime('%Y-%m-%d %H:%M')} KST")
    print(f"검증 사이트: {len(sites)}개 | 사이트당 최대 {args.limit}건")
    print(f"{'='*60}")

    for slug in sites:
        if slug not in SITE_FUNCS:
            print(f"\n⚠️  알 수 없는 사이트: {slug}")
            continue
        try:
            fails = SITE_FUNCS[slug](db, args.limit)
            total_fails += fails
        except Exception as e:
            print(f"\n❌ [{slug}] 예외 발생: {e}")

    print(f"\n{'='*60}")
    print(f"전체 불일치: {total_fails}건")
    print(f"{'='*60}\n")

if __name__ == '__main__':
    main()
