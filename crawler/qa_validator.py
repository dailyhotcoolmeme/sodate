"""
크롤링 결과 QA 검증기
크롤링 완료 후 실행하여 비정상 데이터를 탐지하고 리포트를 출력합니다.

검증 항목:
  1. 비정상 시간대 (KST 10시 이전)
  2. 제목 내 날짜 vs event_date 불일치
  3. source_url 접근 불가 (HTTP 4xx/5xx)
  4. 업체별 이벤트 수 급감 (직전 크롤링 대비 -50% 이하)
  5. 필수 필드 누락 (title, event_date, source_url)
  6. 과거 이벤트 / 너무 먼 미래 이벤트 (90일 초과)
"""

import os
import re
import sys
import httpx
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ['SUPABASE_URL']
SERVICE_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
KST = timezone(timedelta(hours=9))
HEADERS = {'apikey': SERVICE_KEY, 'Authorization': f'Bearer {SERVICE_KEY}'}

# 검증 기준
MIN_HOUR_KST = 10       # KST 오전 10시 이전은 비정상
MAX_HOUR_KST = 23       # KST 자정 이후는 비정상
MAX_DAYS_AHEAD = 90     # 90일 이상 미래 이벤트는 의심
URL_TIMEOUT = 8         # source_url 응답 대기 시간(초)
DROP_RATIO = 0.5        # 업체별 이전 대비 이벤트 수가 이 비율 이하면 경고


def parse_dt(raw: str) -> datetime:
    raw = raw.replace('Z', '+00:00')
    raw = re.sub(r'\.(\d+)([+-])', lambda m: '.' + m.group(1)[:6].ljust(6, '0') + m.group(2), raw)
    return datetime.fromisoformat(raw)


def fetch_active_events() -> list[dict]:
    r = httpx.get(
        f'{SUPABASE_URL}/rest/v1/events',
        params={'select': 'id,title,event_date,source_url,company_id,is_active', 'is_active': 'eq.true'},
        headers=HEADERS, timeout=15
    )
    return r.json() if r.status_code == 200 else []


def fetch_companies() -> dict[str, str]:
    """company_id → name 매핑"""
    r = httpx.get(
        f'{SUPABASE_URL}/rest/v1/companies',
        params={'select': 'id,name'},
        headers=HEADERS, timeout=10
    )
    return {c['id']: c['name'] for c in r.json()} if r.status_code == 200 else {}


def fetch_crawl_logs() -> dict[str, int]:
    """업체별 직전 크롤링 이벤트 수 조회 (crawl_logs 최근 1건씩)"""
    r = httpx.get(
        f'{SUPABASE_URL}/rest/v1/crawl_logs',
        params={
            'select': 'company_id,events_found',
            'status': 'eq.success',
            'order': 'created_at.desc',
            'limit': '200',
        },
        headers=HEADERS, timeout=10
    )
    if r.status_code != 200:
        return {}
    seen = {}
    for row in r.json():
        cid = row['company_id']
        if cid not in seen:
            seen[cid] = row['events_found']
    return seen


def check_title_date_match(title: str, dt_kst: datetime) -> bool:
    """제목에 날짜 패턴이 있으면 event_date와 일치하는지 확인"""
    # 패턴: "3.29", "3월29일", "03/29" 등
    patterns = [
        r'(\d{1,2})[./월](\d{1,2})',   # 3.29, 3/29, 3월29
    ]
    for pat in patterns:
        m = re.search(pat, title)
        if m:
            try:
                mo, day = int(m.group(1)), int(m.group(2))
                if mo == dt_kst.month and day == dt_kst.day:
                    return True
                # 연도 넘어가는 경우 무시 (month > 12이면 패턴 오탐)
                if mo > 12:
                    return True
                return False
            except Exception:
                pass
    return True  # 날짜 패턴 없으면 검증 생략


def check_url_accessible(url: str) -> tuple[bool, int]:
    """source_url이 실제 접근 가능한지 확인. (ok, status_code)"""
    # 앵커(#evt=...) 제거 후 요청
    clean_url = url.split('#')[0]
    try:
        r = httpx.head(clean_url, follow_redirects=True, timeout=URL_TIMEOUT,
                       headers={'User-Agent': 'Mozilla/5.0'})
        if r.status_code == 405:
            # HEAD 미지원 시 GET 시도
            r = httpx.get(clean_url, follow_redirects=True, timeout=URL_TIMEOUT,
                          headers={'User-Agent': 'Mozilla/5.0'})
        return r.status_code < 400, r.status_code
    except Exception:
        return False, 0


def run_qa() -> int:
    """QA 실행. 오류 건수 반환 (0이면 정상)."""
    print('=' * 60)
    print('소개팅모아 크롤링 QA 검증 시작')
    print(f'기준 시각: {datetime.now(KST).strftime("%Y-%m-%d %H:%M KST")}')
    print('=' * 60)

    events = fetch_active_events()
    companies = fetch_companies()
    prev_counts = fetch_crawl_logs()
    now_kst = datetime.now(KST)

    issues: list[dict] = []

    # ── 1. 이벤트별 검증 ──────────────────────────────────
    company_counts: dict[str, int] = defaultdict(int)

    for e in events:
        eid = e['id']
        title = e.get('title') or ''
        src = e.get('source_url') or ''
        raw_date = e.get('event_date')
        cid = e.get('company_id', '')
        cname = companies.get(cid, cid[:8])

        company_counts[cid] += 1

        # 필수 필드 누락
        if not title:
            issues.append({'level': 'ERROR', 'company': cname, 'msg': f'title 없음 | {src}'})
        if not raw_date:
            issues.append({'level': 'ERROR', 'company': cname, 'msg': f'event_date 없음 | {src}'})
            continue
        if not src:
            issues.append({'level': 'ERROR', 'company': cname, 'msg': f'source_url 없음 | {title[:40]}'})

        # 날짜 파싱
        try:
            dt_kst = parse_dt(raw_date).astimezone(KST)
        except Exception:
            issues.append({'level': 'ERROR', 'company': cname, 'msg': f'event_date 파싱 실패: {raw_date}'})
            continue

        # 비정상 시간대
        if not (MIN_HOUR_KST <= dt_kst.hour <= MAX_HOUR_KST):
            issues.append({
                'level': 'ERROR', 'company': cname,
                'msg': f'비정상 시간 {dt_kst.strftime("%m/%d %H:%M")} KST | {title[:40]}'
            })

        # 과거 이벤트
        if dt_kst < now_kst:
            issues.append({
                'level': 'WARN', 'company': cname,
                'msg': f'과거 이벤트 {dt_kst.strftime("%m/%d %H:%M")} | {title[:40]}'
            })

        # 너무 먼 미래
        if (dt_kst - now_kst).days > MAX_DAYS_AHEAD:
            issues.append({
                'level': 'WARN', 'company': cname,
                'msg': f'{MAX_DAYS_AHEAD}일 초과 미래 이벤트 {dt_kst.strftime("%m/%d")} | {title[:40]}'
            })

        # 제목 날짜 교차검증
        if src and not check_title_date_match(title, dt_kst):
            issues.append({
                'level': 'WARN', 'company': cname,
                'msg': f'제목 날짜 불일치 (title: {title[:30]} / event_date: {dt_kst.strftime("%m/%d")})'
            })

    # ── 2. source_url 접근성 검증 (ERROR 건만) ────────────
    print(f'\n[URL 접근성 검증] 총 {len(events)}개 이벤트 확인 중...')
    checked_urls: set[str] = set()
    for e in events:
        src = e.get('source_url') or ''
        clean = src.split('#')[0]
        if not src or clean in checked_urls:
            continue
        checked_urls.add(clean)

        ok, status = check_url_accessible(src)
        if not ok:
            cname = companies.get(e.get('company_id', ''), '?')
            issues.append({
                'level': 'ERROR', 'company': cname,
                'msg': f'URL 접근 불가 (HTTP {status}) | {src[:70]}'
            })
        else:
            print(f'  ✓ {status} {clean[:60]}')

    # ── 3. 업체별 이벤트 수 급감 감지 ─────────────────────
    print('\n[업체별 이벤트 수 변동]')
    for cid, current_count in company_counts.items():
        cname = companies.get(cid, cid[:8])
        prev = prev_counts.get(cid)
        if prev and prev > 0:
            ratio = current_count / prev
            status_icon = '✓' if ratio >= DROP_RATIO else '⚠'
            print(f'  {status_icon} {cname}: 이전 {prev}개 → 현재 {current_count}개 ({ratio:.0%})')
            if ratio < DROP_RATIO:
                issues.append({
                    'level': 'WARN', 'company': cname,
                    'msg': f'이벤트 수 급감: 이전 {prev}개 → 현재 {current_count}개 ({ratio:.0%})'
                })
        else:
            print(f'  - {cname}: {current_count}개 (이전 기록 없음)')

    # ── 결과 출력 ──────────────────────────────────────────
    errors = [i for i in issues if i['level'] == 'ERROR']
    warns = [i for i in issues if i['level'] == 'WARN']

    print(f'\n{"=" * 60}')
    print(f'QA 결과: ERROR {len(errors)}건 / WARN {len(warns)}건')
    print('=' * 60)

    if errors:
        print('\n[ERROR]')
        for i in errors:
            print(f'  ✗ [{i["company"]}] {i["msg"]}')

    if warns:
        print('\n[WARN]')
        for i in warns:
            print(f'  △ [{i["company"]}] {i["msg"]}')

    if not issues:
        print('\n모든 항목 정상 ✓')

    return len(errors)


if __name__ == '__main__':
    error_count = run_qa()
    # ERROR가 있으면 exit code 1 (GitHub Actions에서 step 실패로 표시)
    sys.exit(1 if error_count > 0 else 0)
