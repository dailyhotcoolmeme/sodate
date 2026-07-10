"""경량 매진·가격 갱신 크롤.

전체 크롤(발굴·블로그·나이)을 하지 않고, 이미 DB에 있는 이벤트의
성별 가격·매진(seats)·전체마감(is_closed)만 예약위젯으로 빠르게 재확인한다.
자주 실행해 매진을 실시간에 가깝게 유지. 임박한 이벤트일수록 우선.

이벤트 source_url 의 idx로 상품 위젯을 열고, (월,일,시)로 이벤트와 매칭해 갱신.
전체 스크래퍼는 이 업체들의 seats/price 를 쓰지 않으므로(WRITES 미설정) 여기 값이 유지된다.
"""
import re
import sys
import time
from datetime import datetime, timezone, timedelta

from playwright.sync_api import sync_playwright

from utils.supabase_client import get_supabase
from utils.imweb_options import gender_soldout_by_label, gender_soldout_yeonin


def _eo_norm(res: dict) -> dict:
    """감정오렌지 라벨('7월 10일 … 저녁 8시') → {(mo,d,hour): gd}"""
    out = {}
    for lab, gd in res.items():
        dm = re.search(r'(\d+)월\s*(\d+)일', lab)
        if not dm:
            continue
        tm = re.search(r'(오전|오후|저녁|낮|새벽)\s*(\d+)시', lab)
        h = 19
        if tm:
            hh = int(tm.group(2))
            h = hh + 12 if tm.group(1) in ('오후', '저녁') and hh < 12 else hh
        out[(int(dm.group(1)), int(dm.group(2)), h)] = gd
    return out


def _yeonin_norm(res: dict) -> dict:
    """yeonin (mo,d,hh,mm) → {(mo,d,hh): gd}"""
    return {(mo, d, hh): gd for (mo, d, hh, mm), gd in res.items()}


# 업체별: 상품 URL 템플릿 + (mo,d,hour)→성별매진 추출
VENDORS = {
    'emotional-orange': {
        'url': 'https://emotional0ranges.com/shop_view/?idx={idx}',
        'extract': lambda pg, idx: _eo_norm(gender_soldout_by_label(pg, idx)),
    },
    'yeonin': {
        'url': 'https://yeonin.co.kr/shop_view?idx={idx}',
        'extract': lambda pg, idx: _yeonin_norm(gender_soldout_yeonin(pg, idx)),
    },
}

_IDX_RE = re.compile(r'idx=(\d+)')


def refresh(slugs=None):
    sb = get_supabase()
    now = datetime.now(timezone.utc)
    comps = {c['slug']: c['id'] for c in sb.table('companies').select('id,slug').execute().data}
    targets = slugs or list(VENDORS.keys())

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent='Mozilla/5.0 AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36')
        pg = ctx.new_page()

        for slug in targets:
            cfg = VENDORS.get(slug)
            cid = comps.get(slug)
            if not cfg or not cid:
                continue
            ev = sb.table('events').select(
                'id,source_url,event_date,price_male,price_female,seats_left_male,seats_left_female,is_closed'
            ).eq('company_id', cid).eq('is_active', True).gte('event_date', now.isoformat()).execute().data

            # idx별로 이벤트 그룹 (임박순: 가까운 날짜 idx 먼저)
            by_idx: dict[str, list] = {}
            for e in ev:
                m = _IDX_RE.search(e['source_url'] or '')
                if m:
                    by_idx.setdefault(m.group(1), []).append(e)

            updated = 0
            for idx, evs in by_idx.items():
                try:
                    pg.goto(cfg['url'].format(idx=idx), timeout=20000, wait_until='domcontentloaded')
                    time.sleep(1.2)
                    norm = cfg['extract'](pg, idx)
                except Exception as e:
                    print(f'[{slug}] idx={idx} 위젯 실패: {str(e)[:60]}')
                    continue
                if not norm:
                    continue
                for e in evs:
                    d = datetime.fromisoformat(e['event_date'].replace('Z', '+00:00'))
                    dk = d + timedelta(hours=9)  # KST
                    gd = norm.get((dk.month, dk.day, dk.hour))
                    if not gd:
                        continue
                    upd = {}
                    male, female = gd.get('male'), gd.get('female')
                    if male:
                        upd['price_male'] = male[0]
                        upd['seats_left_male'] = 0 if male[1] else None
                    if female:
                        upd['price_female'] = female[0]
                        upd['seats_left_female'] = 0 if female[1] else None
                    sm = upd.get('seats_left_male', e['seats_left_male'])
                    sf = upd.get('seats_left_female', e['seats_left_female'])
                    upd['is_closed'] = bool(e['is_closed']) or (sm == 0 and sf == 0)
                    if upd:
                        sb.table('events').update(upd).eq('id', e['id']).execute()
                        updated += 1
            print(f'[{slug}] 갱신 {updated}건 (상품 {len(by_idx)}개)')
        browser.close()


if __name__ == '__main__':
    args = sys.argv[1:]
    refresh(slugs=args or None)
