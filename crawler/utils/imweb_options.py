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


def _load_option(page, idx: str, sels: list, body_prefix: str = '') -> str:
    body = f'{body_prefix}prod_idx={idx}'
    for i, (oc, vc, vn) in enumerate(sels):
        body += (f'&selected_require_options[{i}][value_type]=SELECT'
                 f'&selected_require_options[{i}][option_code]={oc}'
                 f'&selected_require_options[{i}][value_code]={vc}'
                 f'&selected_require_options[{i}][value_name]={vn}')
    r = page.evaluate(_FETCH_JS, body)
    try:
        return json.loads(r).get('option_html', '') or ''
    except Exception:
        return r or ''


def _price(text: str) -> Optional[int]:
    m = _PRICE_RE.search(text.replace('\xa0', ' '))
    return int(m.group(1).replace(',', '')) if m else None


def _aggregate(tickets: list) -> Optional[tuple]:
    """tickets=[(price:int|None, soldout:bool)] → (price, soldout) 또는 None(옵션없음).
    품절 아닌 티켓 있으면 최저가+판매중, 전부 품절이면 최저가+마감."""
    tickets = [(p, s) for (p, s) in tickets if p is not None]
    if not tickets:
        return None
    avail = [p for (p, s) in tickets if not s]
    if avail:
        return (min(avail), False)
    return (min(p for (p, _) in tickets), True)


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
                if '원' not in t:
                    continue
                if '남성' in t:
                    male.append((_price(t), '품절' in t or '마감' in t))
                elif '여성' in t:
                    female.append((_price(t), '품절' in t or '마감' in t))
            entry = {'male': _aggregate(male), 'female': _aggregate(female)}
            if entry['male'] or entry['female']:
                out[lab1] = entry
        return out
    except Exception:
        return out
