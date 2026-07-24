"""imweb 예약위젯(load_option.cm) 공통 매진·가격 추출.

구매하기 전 옵션 선택(날짜→성별)에서 매진이 드러나는 imweb 업체 공통 로직.
매진 옵션은 클릭불가(onclick 없음)라 dropdown-item display 텍스트의 '(품절)'로 판별한다.

핵심 규칙(docs/soldout_detection_spec.md):
- 성별 옵션은 날짜별. 성별마다 티켓 여럿(일반·얼리버드 등).
- ⚠️ 얼리버드(품절) ≠ 그 성별 전체 마감. 성별의 '모든 티켓이 품절'일 때만 마감.
- 가격 = 품절 아닌 티켓 중 최저가(없으면=전부품절 → 마감, 표시가=전체 최저가).
"""
import json
import re
import time
from typing import Optional

_FETCH_JS = """async (body) => {
  const r = await fetch('/shop/load_option.cm', {method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8','X-Requested-With':'XMLHttpRequest'},
    body});
  return await r.text();
}"""

# changeCartSelectRequireOption(idx,'그룹','값','라벨',...) — 클릭가능(판매중) 옵션만 잡힘
_OC_RE = re.compile(r"changeCartSelectRequireOption\(\d+,'(O[0-9a-fA-F]+)','(O[0-9a-fA-F]+)',\s*'([^']+)'")
_PRICE_RE = re.compile(r'([1-9][\d,]{2,})\s*원')


def _load_option(page, idx: str, sels: list, body_prefix: str = '', retries: int = 2) -> str:
    """load_option.cm 호출. CI 환경에서 간헐적으로 fetch가 타임아웃·빈 응답을 주는 경우가
    있어(예외 없이 빈 문자열만 나옴 → 호출부가 '옵션 없음=품절'로 오인해 며칠씩 가격이
    안 갱신되는 문제 발생) 짧게 재시도한다."""
    body = f'{body_prefix}prod_idx={idx}'
    for i, (oc, vc, vn) in enumerate(sels):
        body += (f'&selected_require_options[{i}][value_type]=SELECT'
                 f'&selected_require_options[{i}][option_code]={oc}'
                 f'&selected_require_options[{i}][value_code]={vc}'
                 f'&selected_require_options[{i}][value_name]={vn}')
    for attempt in range(retries + 1):
        try:
            r = page.evaluate(_FETCH_JS, body)
        except Exception:
            r = ''
        try:
            html = json.loads(r).get('option_html', '') or ''
        except Exception:
            html = r or ''
        # 정상 응답은 보통 수백~수천자. 너무 짧으면 WAF/타임아웃성 빈 응답일 가능성 → 재시도.
        if len(html) > 80 or attempt == retries:
            return html
        time.sleep(0.8)
    return ''


def _price(text: str) -> Optional[int]:
    t = text.replace('\xa0', ' ')
    m = re.search(r'₩\s*([1-9][\d,]{2,})', t) or _PRICE_RE.search(t)
    return int(m.group(1).replace(',', '')) if m else None


# 한정 할인·부가 옵션(표시가에서 제외 — 일반가를 보여준다)
_PROMO = ('특가', '선착순', '할인', '동반', '얼리버드', '얼리 버드', '패키지', '온라인매칭')


def _is_base(label: str) -> bool:
    return not any(k in label for k in _PROMO)


def _tier_detail(tickets: list) -> Optional[dict]:
    """tickets=[(label, price, soldout)] → {'regular':P,'regular_soldout':B,
    'earlybird':P,'earlybird_soldout':B}(얼리버드 없으면 그 키 생략) 또는 None.
    앱 PriceTierValue가 price_male/female보다 이 값을 우선 표시하므로, 위젯을 다시
    불러올 때마다 이것도 같이 최신화해야 앱에 실제 가격이 반영된다."""
    tickets = [(l, p, s) for (l, p, s) in tickets if p is not None]
    if not tickets:
        return None
    base = [(l, p, s) for (l, p, s) in tickets if _is_base(l)]
    early = [(l, p, s) for (l, p, s) in tickets if '얼리버드' in l or '얼리 버드' in l]
    out: dict = {}
    if base:
        avail = [p for l, p, s in base if not s]
        if avail:
            out['regular'] = min(avail); out['regular_soldout'] = False
        else:
            out['regular'] = min(p for l, p, s in base); out['regular_soldout'] = True
    if early:
        avail = [p for l, p, s in early if not s]
        if avail:
            out['earlybird'] = min(avail); out['earlybird_soldout'] = False
        else:
            out['earlybird'] = min(p for l, p, s in early); out['earlybird_soldout'] = True
    return out or None


def _aggregate_base(tickets: list) -> Optional[tuple]:
    """tickets=[(label, price, soldout)] → (price, soldout) 또는 None(옵션없음).
    표시가 = **일반가**(특가/선착순/할인/동반/얼리버드/패키지 제외) 우선.
    판매중 여부: 예약 가능한(품절 아닌) 티켓이 하나라도 있으면 판매중, 전부 품절이면 마감.
    (오너 지시: 한정 선착순/특가가가 아니라 일반가를 표시. 마감은 그 성별 예약 자체가 불가할 때만.)"""
    tickets = [(l, p, s) for (l, p, s) in tickets if p is not None]
    if not tickets:
        return None
    avail = [(l, p) for (l, p, s) in tickets if not s]
    if avail:
        base = [p for (l, p) in avail if _is_base(l)]
        return (min(base) if base else min(p for _, p in avail), False)
    base_all = [p for (l, p, s) in tickets if _is_base(l)]
    return (min(base_all) if base_all else min(p for _, p, _ in tickets), True)


_YEONIN_DATE_RE = re.compile(r'(\d{1,2})/(\d{1,2})\([월화수목금토일]\)\s*(오전|오후|저녁|낮|밤)?\s*(\d{1,2})시(?:\s*(\d{1,2})분)?')


def gender_soldout_yeonin(page, idx: str, body_prefix: str = '') -> dict:
    """연인어때식(지역→성별→날짜) 캐스케이드. 날짜 옵션에 가격+품절이 붙는다.
    라벨 예: '7/11(토) 오후 5시 30분(남: 89-96 / 여: 제한 ❌) ₩19,000 (품절)'
    반환: { (mo,d,hour,minute): {'male':(price,soldout)|None, 'female':(price,soldout)|None} }
    """
    from bs4 import BeautifulSoup
    out: dict = {}
    try:
        h1 = _load_option(page, idx, [], body_prefix)
        regions = _OC_RE.findall(h1)
        if not regions:
            return out
        rg = regions[0][0]  # 지역 그룹코드
        for rgc, rvc, rlab in regions:  # 보통 지역 1개
            h2 = _load_option(page, idx, [(rgc, rvc, rlab)], body_prefix)
            genders = [x for x in _OC_RE.findall(h2)
                       if x[0] != rg and (x[2].startswith('남') or x[2].startswith('여'))]
            gg = genders[0][0] if genders else None
            for ggc, gvc, glab in genders:
                gk = 'male' if glab.startswith('남') else 'female'
                h3 = _load_option(page, idx, [(rgc, rvc, rlab), (ggc, gvc, glab)], body_prefix)
                for a in BeautifulSoup(h3, 'html.parser').select('.dropdown-item a, .dropdown-item span.blocked'):
                    t = re.sub(r'\s+', ' ', a.get_text(' ', strip=True))
                    dm = _YEONIN_DATE_RE.search(t)
                    if not dm or '원' not in t and '₩' not in t and '품절' not in t:
                        continue
                    mo, d = int(dm.group(1)), int(dm.group(2))
                    hh = int(dm.group(4)); mm = int(dm.group(5)) if dm.group(5) else 0
                    if dm.group(3) in ('오후', '저녁', '밤') and hh < 12:
                        hh += 12
                    elif dm.group(3) is None and 1 <= hh <= 11:
                        # 연인어때는 '4시30분'처럼 오전/오후 표기가 아예 없는 라벨이 있음.
                        # 실측상 연인어때 세션은 전부 오후~밤(오전 세션 없음) → 오후로 간주.
                        # (미변환 시 4시=새벽4시로 오인돼 refresh_soldout 매칭이 영구 실패)
                        hh += 12
                    key = (mo, d, hh, mm)
                    out.setdefault(key, {'male': None, 'female': None})
                    out[key][gk] = (_price(t), '품절' in t or '마감' in t)
        return out
    except Exception:
        return out


_MD_RE = re.compile(r'(\d{1,2})/(\d{1,2})')


def gender_soldout_loco(page, idx: str, body_prefix: str = '') -> dict:
    """로꼬식(날짜→성별(남자/여자)→티켓) 3단계. 날짜 라벨 '07/10(금)'엔 시간 없음 → (mo,d) 키.
    대표가 = 기본 참석권(특가/동반 제외) 우선, 없으면 판매중 최저가. 성별 전 티켓 품절이면 마감.
    반환: { (mo,d): {'male':(price,soldout)|None, 'female':...} }
    """
    from bs4 import BeautifulSoup
    out: dict = {}
    try:
        h1 = _load_option(page, idx, [], body_prefix)
        dates = _OC_RE.findall(h1)
        if not dates:
            return out
        dg = dates[0][0]
        for dgc, dvc, dlab in dates:
            dm = _MD_RE.search(dlab)
            if not dm:
                continue
            key = (int(dm.group(1)), int(dm.group(2)))
            entry = {'male': None, 'female': None}
            h2 = _load_option(page, idx, [(dgc, dvc, dlab)], body_prefix)
            genders = [x for x in _OC_RE.findall(h2)
                       if x[0] != dg and ('남' in x[2] or '여' in x[2])]
            for ggc, gvc, glab in genders:
                gk = 'male' if '남' in glab else 'female'
                h3 = _load_option(page, idx, [(dgc, dvc, dlab), (ggc, gvc, glab)], body_prefix)
                tickets = []  # (label, price, soldout)
                for a in BeautifulSoup(h3, 'html.parser').select('.dropdown-item a, .dropdown-item span.blocked'):
                    t = re.sub(r'\s+', ' ', a.get_text(' ', strip=True))
                    pr = _price(t)
                    if pr is not None:
                        tickets.append((t, pr, '품절' in t or '마감' in t))
                entry[gk] = _aggregate_base(tickets)
            out[key] = entry
        return out
    except Exception:
        return out


def gender_soldout_by_label(page, idx: str, body_prefix: str = '',
                            from_bs4=None) -> dict:
    """날짜별 성별 가격·매진 추출(2단계: 날짜→성별옵션에 가격 포함형).

    반환: { date_label(원문): {'male': (price, soldout)|None, 'female': (price, soldout)|None} }
    date_label 은 위젯 1단계 옵션 라벨 원문(업체가 같은 소스로 날짜 뽑으면 그대로 매칭).
    """
    from bs4 import BeautifulSoup
    out: dict = {}
    try:
        h1 = _load_option(page, idx, [], body_prefix)
        dates = _OC_RE.findall(h1)
        if not dates:
            return out
        grp1 = dates[0][0]
        for g1, v1, lab1 in dates:
            h2 = _load_option(page, idx, [(g1, v1, lab1)], body_prefix)
            soup = BeautifulSoup(h2, 'html.parser')
            male: list = []
            female: list = []
            for a in soup.select('.dropdown-item a, .dropdown-item span.blocked'):
                t = re.sub(r'\s+', ' ', a.get_text(' ', strip=True))
                pr = _price(t)
                if pr is None:
                    continue
                rec = (t, pr, '품절' in t or '마감' in t)
                if '남성' in t:
                    male.append(rec)
                elif '여성' in t:
                    female.append(rec)
            entry = {
                'male': _aggregate_base(male), 'female': _aggregate_base(female),
                'male_tiers': _tier_detail(male), 'female_tiers': _tier_detail(female),
            }
            if entry['male'] or entry['female']:
                out[lab1] = entry
        return out
    except Exception:
        return out
