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
    """텍스트에서 지명 문구를 '통째로' 뽑는다 (도시+동/구/역, 없으면 도시명)."""
    if not text:
        return None
    m = _PLACE_RE.search(text)
    if m:
        city = (m.group(1) or '').strip()
        return _clean(f'{city} {m.group(2)}') if city else _clean(m.group(2))
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
            ph = _extract_phrase(m.group(1))
            if ph:
                return ph
            v = _clean(m.group(1))
            if _usable(v) and len(v) <= 20:
                return v

    # 4) 제목 → 본문에서 지명 문구 통째로
    for src in (title, body):
        ph = _extract_phrase(src)
        if ph:
            return ph

    return default
