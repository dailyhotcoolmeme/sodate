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
from utils.imweb_options import gender_soldout_by_label, gender_soldout_yeonin, gender_soldout_loco


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
    'lovecommunity-loco': {
        'url': 'https://lovecommunity.imweb.me/party/?idx={idx}',
        'extract': lambda pg, idx: gender_soldout_loco(pg, idx),  # (mo,d) 키
    },
}

_IDX_RE = re.compile(r'idx=(\d+)')


def _nonimweb_scrapers():
    """스크래퍼 재사용 업체(공용 imweb 헬퍼 안 쓰는 곳): 좌석/마감/가격 로직을 그대로 재사용.
    소규모·API라 빠름. #evt 또는 source_url로 기존 이벤트 매칭해 seats/price/is_closed 갱신."""
    from scrapers.frip import FripScraper
    from scrapers.talkblossom import TalkblossomScraper
    from scrapers.yeongyul import YeongyulScraper
    from scrapers.munto import MuntoScraper
    from scrapers.secretsalon import SecretSalonScraper
    from scrapers.modparty import ModpartyScraper
    return {'frip': FripScraper, 'talkblossom': TalkblossomScraper, 'yeongyul': YeongyulScraper,
            'munto': MuntoScraper, 'secretsalon': SecretSalonScraper, 'modparty': ModpartyScraper}


_EVT_RE = re.compile(r'#evt=(\d{12})')


def _refresh_via_scraper(sb, cid, ScraperClass) -> int:
    """스크래퍼 scrape() 결과로 기존 이벤트의 seats/is_closed만 갱신.
    매칭: #evt=YYYYMMDDHHMM(URL 형식 달라도 동일) 우선, 없으면 source_url 전체(괜찮소 등)."""
    # DB 이벤트 인덱스: 전체 URL(정확·우선) / #evt 시각(폴백, 상품ID 없어 여러 상품이
    # 같은 날짜시간에 세션을 두면 충돌 — 충돌나면 모호하므로 evt단독매칭에서 제외해
    # 엉뚱한 상품 행에 업데이트가 새는 것을 막는다(프립처럼 상품이 많으면 흔함).
    dbevs = sb.table('events').select('id,source_url').eq('company_id', cid).eq('is_active', True).execute().data
    by_evt, by_url = {}, {}
    for e in dbevs:
        m = _EVT_RE.search(e['source_url'] or '')
        if m:
            key = m.group(1)
            if key in by_evt and by_evt[key] != e['id']:
                by_evt[key] = None  # 충돌 → 무효화
            elif key not in by_evt:
                by_evt[key] = e['id']
        by_url[e['source_url']] = e['id']
    try:
        evs = ScraperClass().scrape()
    except Exception as e:
        print(f'  스크래퍼 실행 실패: {str(e)[:60]}')
        return 0
    updated = 0
    for ev in evs:
        eid = by_url.get(ev.source_url)
        if not eid:
            m = _EVT_RE.search(ev.source_url or '')
            eid = by_evt.get(m.group(1)) if m else None
        if not eid:
            continue
        d = ev.model_dump() if hasattr(ev, 'model_dump') else ev.__dict__
        sm, sf = d.get('seats_left_male'), d.get('seats_left_female')
        # ⚠️(2026-07-25) 원본 사이트가 정원 초과(오버부킹) 등으로 음수를 낼 때가 있어
        # DB check constraint(>=0)에 걸림 → 예외처리 없이 그대로 execute()해서 프립 이후
        # 남은 전체 업체가 통째로 못 돌던 사고 발생. 0으로 clamp해 마감으로 처리.
        if sm is not None and sm < 0:
            sm = 0
        if sf is not None and sf < 0:
            sf = 0
        ic = bool(d.get('is_closed')) or (sm is not None and sf is not None and sm <= 0 and sf <= 0)
        upd = {'seats_left_male': sm, 'seats_left_female': sf, 'is_closed': ic}
        # 가격은 값이 있을 때만 갱신(None으로 기존값 덮지 않음)
        if d.get('price_male') is not None:
            upd['price_male'] = d['price_male']
        if d.get('price_female') is not None:
            upd['price_female'] = d['price_female']
        try:
            sb.table('events').update(upd).eq('id', eid).execute()
            updated += 1
        except Exception as e:
            # 이 행 하나 실패로 나머지 업체 전체가 못 도는 것 방지 — 로그만 남기고 계속.
            print(f'  이벤트 갱신 실패(스킵): {eid} - {str(e)[:120]}')
    return updated


def _refresh_nonimweb(sb, comps, slugs=None) -> None:
    """비-imweb 업체(프립·토크블라썸·괜찮소) 좌석/마감 갱신 — 스크래퍼 로직 재사용.

    스크래퍼가 all-or-nothing이라 days 필터가 안 먹고 매번 전체를 돈다. 프립이 커지면서
    이 부분이 실행 시간을 지배하게 돼(2026-07-29) imweb 경량 갱신과 분리했다.
    """
    for slug, Sc in _nonimweb_scrapers().items():
        if slugs and slug not in slugs:
            continue
        cid = comps.get(slug)
        if not cid:
            continue
        n = _refresh_via_scraper(sb, cid, Sc)
        print(f'[{slug}] 갱신 {n}건 (스크래퍼 재사용)')


def refresh(slugs=None, days=None, part='all'):
    """days 지정 시 앞으로 N일 내 이벤트만 갱신(임박 우선·빠름). None이면 전체 미래.

    part: 'all' | 'imweb' | 'nonimweb'
      ⚠️ 예전엔 한 실행이 imweb 위젯 갱신과 비-imweb 전체 크롤(프립·토크블라썸·괜찮소)을
         모두 했다. 비-imweb은 days 필터가 안 먹어 매번 전체를 도는데, 프립이 418건까지
         커지면서(2026-07-29) 이 부분만으로도 실행이 길어졌고, 같은 큐를 쓰는 imweb
         경량 갱신까지 통째로 밀렸다. 그래서 둘을 분리해 각자 주기로 돌린다.
    """
    sb = get_supabase()
    now = datetime.now(timezone.utc)
    horizon = (now + timedelta(days=days)).isoformat() if days else None
    comps = {c['slug']: c['id'] for c in sb.table('companies').select('id,slug').execute().data}
    targets = slugs or list(VENDORS.keys())

    if part == 'nonimweb':
        _refresh_nonimweb(sb, comps, slugs)
        return

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent='Mozilla/5.0 AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36')
        pg = ctx.new_page()

        for slug in targets:
            cfg = VENDORS.get(slug)
            cid = comps.get(slug)
            if not cfg or not cid:
                continue
            q = sb.table('events').select(
                'id,source_url,event_date,price_male,price_female,seats_left_male,seats_left_female,is_closed'
            ).eq('company_id', cid).eq('is_active', True).gte('event_date', now.isoformat())
            if horizon:
                q = q.lte('event_date', horizon)
            ev = q.execute().data

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
                    # 옵션이 비어있는 두 경우: ①상품 자체가 완전 품절/비활성(정상) ②CI환경
                    # 일시적 fetch 실패(재시도로도 못 건짐). ①이면 방치하지 말고 마감 처리해
                    # 옛 가격이 며칠씩 그대로 남는 것 방지. ②면 로그만 남기고 다음 주기에 재시도.
                    try:
                        soldout_page = pg.evaluate(
                            "() => /품절된\\s*상품입니다/.test(document.body.innerText)"
                        )
                    except Exception:
                        soldout_page = False
                    if soldout_page:
                        for e in evs:
                            if not e.get('is_closed'):
                                try:
                                    sb.table('events').update({'is_closed': True}).eq('id', e['id']).execute()
                                    updated += 1
                                except Exception as ex:
                                    print(f'[{slug}] idx={idx} 마감처리 실패(스킵): {str(ex)[:100]}')
                    else:
                        print(f'[{slug}] idx={idx} 위젯 응답 비어있음(일시적 실패로 추정, 스킵)')
                    continue
                for e in evs:
                    d = datetime.fromisoformat(e['event_date'].replace('Z', '+00:00'))
                    dk = d + timedelta(hours=9)  # KST
                    # (월,일,시) 우선, 없으면 (월,일) — 로꼬 등 시간없는 위젯 대응
                    gd = norm.get((dk.month, dk.day, dk.hour)) or norm.get((dk.month, dk.day))
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
                    # ⚠️ 앱(PriceTierValue)은 price_detail(정가/얼리버드 티어)이 있으면
                    # price_male/female보다 그걸 우선 표시한다. price_detail은 원래
                    # discover_candidates.py 전체크롤 때만 채워져 이 15분 경량갱신과
                    # 따로 놀아 며칠씩 정가가 안 맞는 채로 화면에 나오던 근본원인이었음.
                    # 매 위젯 조회 때 티어를 다시 뽑아 price_detail도 항상 같이 최신화한다
                    # (더 이상 유효한 티어가 없으면 None으로 지워 price_male로 자연스럽게 폴백).
                    mt, ft = gd.get('male_tiers'), gd.get('female_tiers')
                    if mt or ft:
                        detail = {}
                        if mt:
                            detail['male'] = mt
                        if ft:
                            detail['female'] = ft
                        upd['price_detail'] = detail
                    elif 'male_tiers' in gd or 'female_tiers' in gd:
                        upd['price_detail'] = None
                    if upd:
                        try:
                            sb.table('events').update(upd).eq('id', e['id']).execute()
                            updated += 1
                        except Exception as ex:
                            # 이 이벤트 하나 실패로 나머지 idx·업체 전체가 못 도는 것 방지
                            # (2026-07-25 프립 음수좌석 크래시와 동일 패턴 — 여기가 더 앞단이라 더 치명적).
                            print(f'[{slug}] idx={idx} 갱신 실패(스킵): {str(ex)[:100]}')
            print(f'[{slug}] 갱신 {updated}건 (상품 {len(by_idx)}개)')
        browser.close()

    if part != 'imweb':
        _refresh_nonimweb(sb, comps, slugs)


if __name__ == '__main__':
    args = sys.argv[1:]
    days = None
    part = 'all'
    slugs = []
    i = 0
    while i < len(args):
        if args[i] == '--days' and i + 1 < len(args):
            days = int(args[i + 1]); i += 2
        elif args[i] == '--part' and i + 1 < len(args):
            part = args[i + 1]; i += 2
        else:
            slugs.append(args[i]); i += 1
    refresh(slugs=slugs or None, days=days, part=part)
