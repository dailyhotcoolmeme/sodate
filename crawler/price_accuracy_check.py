"""가격/완성도 정확도 점검 — 매일 2회(main.py 크롤 직후) 자동 실행.

2026-07-24~25 사고 재발 방지용. 오너 지적: "내가 얘기하기 전에 자동으로
잡혔어야지, 매번 내가 발견하고 요청해야 하면 출시를 못 한다." → 이 스크립트가
바로 그 자동 감시장치. 오너가 admin을 열어보기 전에 문제를 먼저 잡아낸다.

세 가지를 검사한다.

1. **완성도(신규, 이번 사고 핵심)** — 업체별로 미래 이벤트 중 가격+나이가 둘 다
   채워진 비율이 비정상적으로 낮은지(예: WRITES_PRICE 플래그 누락, age_male 필드
   미생성, 정규식이 사이트 표기와 안 맞음 등 — 이번에 발견된 6개 버그가 전부
   이 증상으로 나타남). 이벤트가 0건인 것도 잡는다(yeongyul이 이 증상이었음).
2. 필드 정합성(네트워크 없이 즉시) — price_detail이 price_male/price_female과
   실제로 일치하는지. 어긋나면 price_detail이 다시 유령필드가 됐다는 신호.
3. 라이브 재검증 샘플(업체별 소수) — DB가 실제 사이트와 맞는지 직접 대조.
   imweb 계열(EO/연인어때/로꼬)은 위젯 재조회, 비imweb은 각 스크래퍼 scrape() 재사용.

ERROR가 있으면 exit(1) → GitHub Actions에서 이 step이 실패로 표시됨
(crawl.yml에서 continue-on-error: true라 전체 워크플로우는 안 끊김, 가시성만 확보).
"""
import re
import sys
from datetime import datetime, timezone, timedelta

from playwright.sync_api import sync_playwright

from utils.supabase_client import get_supabase
from utils.imweb_options import gender_soldout_by_label, gender_soldout_yeonin, gender_soldout_loco
from refresh_soldout import _eo_norm, _yeonin_norm, VENDORS, _nonimweb_scrapers, _IDX_RE, _EVT_RE

SAMPLE_PER_VENDOR = 6  # 업체별 라이브 재검증 표본 수(런타임 제한)
MIN_COMPLETION_RATE = 0.6  # 이 미만이면 ERROR(표본 3건 이상일 때만 — 소수 노이즈 방지)
MIN_SAMPLE_FOR_RATE_CHECK = 3


def check_completeness(sb) -> list[dict]:
    """업체별 '가격+나이 둘 다 채워짐' 완성도 점검(admin 완료조건과 동일 기준).
    이번 사고(WRITES_PRICE 누락·age_male 미생성·정규식 불일치 6건)가 전부 이
    증상으로 나타났음 — 오너가 admin에서 직접 발견하기 전에 여기서 먼저 잡는다."""
    issues = []
    now = datetime.now(timezone.utc)

    def blank(v):
        return v is None or (isinstance(v, str) and v.strip() == '')

    companies = sb.table('companies').select('id,slug,crawl_enabled').execute().data
    for c in companies:
        if not c.get('crawl_enabled', True):
            continue
        slug = c['slug']
        ev = sb.table('events').select('price_male,price_female,age_male,age_female').eq('company_id', c['id'])\
            .eq('is_active', True).gte('event_date', now.isoformat()).execute().data
        total = len(ev)
        if total == 0:
            issues.append({'level': 'ERROR', 'company': slug,
                            'msg': '미래 이벤트 0건 — 크롤이 죽었거나 전부 필터링됨(사이트 자체 확인 필요)'})
            continue
        done = sum(
            1 for e in ev
            if not (blank(e['price_male']) and blank(e['price_female']))
            and not (blank(e['age_male']) and blank(e['age_female']))
        )
        rate = done / total
        if total >= MIN_SAMPLE_FOR_RATE_CHECK and rate < MIN_COMPLETION_RATE:
            issues.append({'level': 'ERROR', 'company': slug,
                            'msg': f'완성도(가격+나이) {done}/{total}건({rate:.0%}) — {MIN_COMPLETION_RATE:.0%} 미만. '
                                   f'WRITES_PRICE 플래그·age_male 필드·정규식 표기 확인 필요'})
    return issues


def check_field_consistency(sb) -> list[dict]:
    """price_detail이 price_male/price_female과 어긋나는지(네트워크 없이 즉시).
    이번 사고를 정확히 잡아내는 체크 — price_detail이 조용히 죽는 걸 막는다."""
    issues = []
    now = datetime.now(timezone.utc)
    ev = sb.table('events').select(
        'id,source_url,price_male,price_female,price_detail,companies(slug)'
    ).eq('is_active', True).gte('event_date', now.isoformat()).not_.is_('price_detail', 'null').execute().data
    for e in ev:
        d = e['price_detail'] or {}
        m = d.get('male', {}).get('regular')
        f = d.get('female', {}).get('regular')
        slug = (e.get('companies') or {}).get('slug', '?')
        if m is not None and e['price_male'] is not None and m != e['price_male']:
            issues.append({'level': 'ERROR', 'company': slug,
                            'msg': f"price_detail.male({m}) != price_male({e['price_male']}) | {e['source_url'][:70]}"})
        if f is not None and e['price_female'] is not None and f != e['price_female']:
            issues.append({'level': 'ERROR', 'company': slug,
                            'msg': f"price_detail.female({f}) != price_female({e['price_female']}) | {e['source_url'][:70]}"})
    return issues


def check_imweb_live(sb, pg) -> list[dict]:
    """EO/연인어때/로꼬: 위젯 재조회해 업체별 표본만큼 실사이트와 대조."""
    issues = []
    now = datetime.now(timezone.utc)
    for slug, cfg in VENDORS.items():
        cid_row = sb.table('companies').select('id').eq('slug', slug).execute().data
        if not cid_row:
            continue
        cid = cid_row[0]['id']
        ev = sb.table('events').select('id,source_url,event_date,price_male,price_female').eq('company_id', cid)\
            .eq('is_active', True).gte('event_date', (now + timedelta(minutes=20)).isoformat())\
            .order('event_date').limit(40).execute().data
        by_idx: dict[str, list] = {}
        for e in ev:
            m = _IDX_RE.search(e['source_url'] or '')
            if m:
                by_idx.setdefault(m.group(1), []).append(e)
        checked = 0
        for idx, rows in by_idx.items():
            if checked >= SAMPLE_PER_VENDOR:
                break
            try:
                pg.goto(cfg['url'].format(idx=idx), timeout=15000, wait_until='domcontentloaded')
                import time; time.sleep(0.8)
                norm = cfg['extract'](pg, idx)
            except Exception:
                continue
            if not norm:
                continue
            r = rows[0]
            d = datetime.fromisoformat(r['event_date'].replace('Z', '+00:00'))
            dk = d + timedelta(hours=9)
            gd = norm.get((dk.month, dk.day, dk.hour)) or norm.get((dk.month, dk.day))
            checked += 1
            if not gd:
                continue
            male, female = gd.get('male'), gd.get('female')
            if male and male[0] != r['price_male']:
                issues.append({'level': 'ERROR', 'company': slug,
                                'msg': f"라이브 남{male[0]} != DB {r['price_male']} | {r['source_url'][:70]}"})
            if female and female[0] != r['price_female']:
                issues.append({'level': 'ERROR', 'company': slug,
                                'msg': f"라이브 여{female[0]} != DB {r['price_female']} | {r['source_url'][:70]}"})
    return issues


def check_nonimweb_live(sb) -> list[dict]:
    """비imweb(프립·문토 등): 각 스크래퍼 scrape() 재사용해 업체별 표본만큼 대조."""
    issues = []
    now = datetime.now(timezone.utc)
    for slug, ScraperClass in _nonimweb_scrapers().items():
        cid_row = sb.table('companies').select('id').eq('slug', slug).execute().data
        if not cid_row:
            continue
        cid = cid_row[0]['id']
        dbevs = sb.table('events').select('id,source_url,price_male,price_female').eq('company_id', cid)\
            .eq('is_active', True).gte('event_date', (now + timedelta(minutes=20)).isoformat()).execute().data
        by_url = {e['source_url']: e for e in dbevs}
        try:
            evs = ScraperClass().scrape()
        except Exception as e:
            issues.append({'level': 'WARN', 'company': slug, 'msg': f'스크래퍼 실행 실패: {str(e)[:60]}'})
            continue
        checked = 0
        for ev in evs:
            if checked >= SAMPLE_PER_VENDOR:
                break
            d = ev.model_dump() if hasattr(ev, 'model_dump') else ev.__dict__
            row = by_url.get(d.get('source_url'))
            if not row:
                continue
            if d.get('price_male') is None and d.get('price_female') is None:
                continue
            checked += 1
            lm, lf = d.get('price_male'), d.get('price_female')
            if lm is not None and lm != row['price_male']:
                issues.append({'level': 'ERROR', 'company': slug,
                                'msg': f"라이브 남{lm} != DB {row['price_male']} | {row['source_url'][:70]}"})
            if lf is not None and lf != row['price_female']:
                issues.append({'level': 'ERROR', 'company': slug,
                                'msg': f"라이브 여{lf} != DB {row['price_female']} | {row['source_url'][:70]}"})
    return issues


def run() -> int:
    sb = get_supabase()
    issues: list[dict] = []

    print('[1/4] 완성도(가격+나이) 점검 — admin 완료조건 기준...')
    issues += check_completeness(sb)

    print('[2/4] price_detail ↔ price_male/female 정합성 검사...')
    issues += check_field_consistency(sb)

    print('[3/4] imweb 계열(에모셔널오렌지·연인어때·로꼬) 라이브 재검증...')
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent='Mozilla/5.0 AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36')
        pg = ctx.new_page()
        issues += check_imweb_live(sb, pg)
        browser.close()

    print('[4/4] 비imweb 업체 라이브 재검증...')
    issues += check_nonimweb_live(sb)

    errors = [i for i in issues if i['level'] == 'ERROR']
    warns = [i for i in issues if i['level'] == 'WARN']

    print(f'\n{"=" * 60}')
    print(f'가격/완성도 점검 결과: ERROR {len(errors)}건 / WARN {len(warns)}건')
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
        print('\n가격 전부 일치 ✓')

    return len(errors)


if __name__ == '__main__':
    error_count = run()
    sys.exit(1 if error_count > 0 else 0)
