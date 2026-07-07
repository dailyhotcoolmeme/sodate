"""공용 지역 해석기 — 사람들이 인식하는 지명 '문구를 통째로' 그대로 쓴다.

절대 원칙:
- 축약 금지. "천안 쌍용동"을 "쌍용동"/"천안"으로, "가산디지털단지"를 "가산"으로 줄이지 않는다.
- 스크래퍼가 뽑은 지역 문구(제목 대괄호, areaName)는 최우선으로 그대로.
- 조합 지역(서울/경기, 동대문·성북, 대전.광주)도 그대로.
- 본문에만 있으면 "장소/위치:" 라인 또는 "<도시> <동/구/역>" 문구를 통째로 뽑는다.
- 서울/기타로 뭉개지 않는다.
"""
from __future__ import annotations

import re
from typing import Optional

# 도시명(문구 앞에 붙을 수 있는 시/군 단위) — 문구를 통째로 잡을 때 접두로 포함시킨다.
_CITY = (
    '서울|인천|수원|성남|분당|판교|용인|고양|일산|부천|안양|안산|광명|시흥|김포|파주|'
    '의정부|남양주|화성|동탄|평택|오산|군포|의왕|하남|구리|이천|여주|양평|'
    '천안|아산|청주|충주|제천|당진|서산|대전|세종|'
    '대구|경산|구미|포항|경주|안동|김해|양산|창원|마산|진해|울산|'
    '부산|광주|전주|익산|군산|목포|여수|순천|제주|강릉|춘천|원주|속초'
)
# "천안 쌍용동", "선릉역", "강남구", "홍대입구역" 같은 지명 문구 (도시 접두 선택)
_PLACE_RE = re.compile(rf'((?:{_CITY})\s+)?([가-힣]{{2,5}}(?:역|동|구|읍|면|지구))')
_CITY_RE = re.compile(rf'({_CITY})')
# "작성하면/신청하면/완료하면" 처럼 동사+'면'을 지명(읍/면)으로 오인하는 것 배제
_VERB_MYEON = re.compile(r'(하|으|라|다|되|지|가|오|이|았|었|겠|시|해|주|받|보|없|있)면$')
# 접미사 없이 통용되는 맨 지명(역/동 안 붙여도 사람들이 지역으로 인식) — 접미 지명이 없을 때 폴백
_KNOWN_AREAS = re.compile(
    r'(사당|강남|역삼|삼성|선릉|홍대|신촌|합정|상수|성수|건대|왕십리|종로|을지로|명동|충무로|'
    r'잠실|천호|노원|수유|이태원|한남|여의도|영등포|구로|신림|봉천|압구정|신사|논현|교대|서초|'
    r'양재|혜화|대학로|동대문|가산|구디|신도림|사가정|미아|불광|연신내|서면|해운대|동성로|상무|둔산)'
)
# "서울역과 충정로역 사이"처럼 두 역이 묶인 경우 → 둘 다 표시
_TWO_STATIONS = re.compile(r'([가-힣]{2,5}역)\s*(?:과|와|,|·|및|~|사이|부터)\s*([가-힣]{2,5}역)')
_MULTI = re.compile(r'[가-힣A-Za-z0-9]+(?:\s*[/·.,&～~]\s*[가-힣A-Za-z0-9]+)+')
_WS = re.compile(r'\s+')
_LOC_LINE = re.compile(r'(?:모임장소|만남장소|장소|위치|지역)\s*[:：]?\s*([^\n]{2,40})')
_HANGUL = re.compile(r'[가-힣]')


def _clean(text: str) -> str:
    return _WS.sub(' ', text).strip(' /·.,&~～\t[]')


def _usable(phrase: Optional[str]) -> bool:
    if not phrase:
        return False
    p = _clean(phrase)
    return bool(p) and bool(_HANGUL.search(p)) and len(p) <= 30


def _extract_phrase(text: Optional[str]) -> Optional[str]:
    """텍스트에서 지명 문구를 '통째로' 뽑는다 (도시+동/구/역 → 맨지명 → 도시명)."""
    if not text:
        return None
    # 1) 접미(역/동/구/읍/면/지구) 지명 — 단, '작성하면' 같은 동사+면은 건너뜀
    for m in _PLACE_RE.finditer(text):
        place = m.group(2)
        if _VERB_MYEON.search(place):
            continue
        city = (m.group(1) or '').strip()
        return _clean(f'{city} {place}') if city else _clean(place)
    # 2) 접미 없이 통용되는 맨 지명 (사당/강남/성수 …)
    am = _KNOWN_AREAS.search(text)
    if am:
        return am.group(1)
    # 3) 도시명
    cm = _CITY_RE.search(text)
    return cm.group(1) if cm else None


def resolve_region(
    title: Optional[str] = None,
    location_detail: Optional[str] = None,
    body: Optional[str] = None,
    region_phrase: Optional[str] = None,
    default: str = '기타',
) -> str:
    """지역을 결정한다. 인식 지명 문구를 축약 없이 그대로 쓴다."""
    # 1) 스크래퍼가 뽑은 지역 문구 그대로 (가산디지털단지 / 강남 삼성 / 천안 불당 / 서울/경기)
    if region_phrase and _usable(region_phrase):
        return _clean(region_phrase)

    # 2) 상세위치가 조합지역이면 그대로 / 지명 문구가 있으면 통째로
    if location_detail:
        d = _clean(location_detail)
        if d and _MULTI.fullmatch(d):
            return d
        ph = _extract_phrase(d)
        if ph:
            return ph
        if _usable(d) and len(d) <= 15:
            return d

    # 3) 본문 "장소/위치:" 라인에서 지명 문구 통째로
    if body:
        m = _LOC_LINE.search(body)
        if m:
            seg = m.group(1)
            tm = _TWO_STATIONS.search(seg)  # "서울역과 충정로역 사이" → 서울역·충정로역
            if tm:
                return f'{tm.group(1)}·{tm.group(2)}'
            ph = _extract_phrase(seg)
            if ph:
                return ph
            v = _clean(seg)
            if _usable(v) and len(v) <= 20:
                return v

    # 4) 제목 → 본문에서 지명 문구 통째로
    for src in (title, body):
        ph = _extract_phrase(src)
        if ph:
            return ph

    return default
