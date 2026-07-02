"""공용 지역 해석기 — 사람들이 인식하는 지명을 '그대로' 지역으로 쓴다.

원칙:
- 축약/정규화 금지. "가산디지털단지"는 "가산"으로 줄이지 않고 그대로 쓴다.
- 스크래퍼가 뽑은 지역 문구(제목 대괄호, areaName 등)를 최우선으로 그대로 사용.
- 조합 지역(서울/경기, 동대문·성북, 대전.광주)도 그대로 유지.
- 본문에만 있으면(러브캐스팅 선릉역 등) "장소/위치:" 라인이나 인식 지명으로 잡는다.
- 서울/기타로 뭉개지 않는다. 지명을 못 잡은 경우만 default('기타')이고, 그건 추적 대상.

새 지명이 나오면 PLACE_KEYWORDS 목록에만 추가하면 전 스크래퍼에 반영됨.
"""
from __future__ import annotations

import re
from typing import Optional

# 본문/제목에서 지역을 잡기 위한 "인식 지명" 목록. 매칭되면 이 문구를 그대로 반환(축약 X).
# 더 구체적인 지명을 앞에 둔다(가산디지털단지가 가산보다 먼저).
PLACE_KEYWORDS: tuple[str, ...] = (
    # 서울 (역/상권/구)
    '가산디지털단지', '구로디지털단지',
    '선릉역', '삼성역', '강남역', '역삼', '선릉', '삼성동', '신논현', '논현', '양재', '서초', '교대', '강남',
    '잠실', '문정', '가락', '석촌', '송파', '여의도', '당산', '영등포',
    '한남', '이태원', '삼각지', '용산', '홍대입구', '홍대', '합정', '상수', '망원', '연남', '공덕', '마포',
    '성수', '뚝섬', '서울숲', '건대입구', '건대', '군자',
    '광화문', '을지로', '종각', '시청', '안국', '인사동', '혜화', '종로', '신촌', '이대',
    '동대문', '청량리', '성북', '천호', '고덕', '강동', '노원', '상계',
    '신도림', '구로', '가산', '마곡', '화곡', '강서', '목동',
    # 경기/인천
    '광교', '수원', '판교', '분당', '정자', '서현', '성남', '기흥', '수지', '죽전', '용인',
    '평촌', '범계', '안양', '중동', '부천', '일산', '화정', '고양', '미사', '하남', '동탄', '화성', '평택',
    '부평', '주안', '송도', '인천',
    # 충청
    '천안', '쌍용동', '불당', '아산', '청주', '오창',
    # 광역시/도
    '둔산', '유성', '대전', '동성로', '수성', '대구', '서면', '해운대', '전포', '부산',
    '상무지구', '충장로', '광주', '울산', '세종', '창원', '마산', '진해', '전주',
)

_MULTI = re.compile(r'[가-힣A-Za-z0-9]+(?:\s*[/·.,&～~]\s*[가-힣A-Za-z0-9]+)+')
_WS = re.compile(r'\s+')
# 본문의 "장소 : XXX", "위치 : XXX", "모임장소 XXX" 라인
_LOC_LINE = re.compile(r'(?:모임장소|만남장소|장소|위치|지역)\s*[:：]?\s*([^\n]{2,40})')
_HANGUL = re.compile(r'[가-힣]')


def _clean(text: str) -> str:
    return _WS.sub(' ', text).strip(' /·.,&~～\t')


def _usable(phrase: Optional[str]) -> bool:
    """지명 문구로 쓸 만한가 (한글 포함, 25자 이하)."""
    if not phrase:
        return False
    p = _clean(phrase)
    return bool(p) and bool(_HANGUL.search(p)) and len(p) <= 25


def _find_place(text: Optional[str]) -> Optional[str]:
    """인식 지명 목록에서 첫 매칭 지명을 '그대로' 반환."""
    if not text:
        return None
    for kw in PLACE_KEYWORDS:
        if kw in text:
            return kw
    return None


def resolve_region(
    title: Optional[str] = None,
    location_detail: Optional[str] = None,
    body: Optional[str] = None,
    region_phrase: Optional[str] = None,
    default: str = '기타',
) -> str:
    """지역을 결정한다. 인식 지명을 축약 없이 그대로 쓴다.

    region_phrase: 스크래퍼가 이미 뽑아둔 지역 문구(제목 대괄호, 프립 areaName 등) — 최우선, 그대로.
    """
    # 1) 스크래퍼가 뽑은 지역 문구 그대로 (가산디지털단지 / 강남 삼성 / 서울/경기 / 동대문·성북)
    if region_phrase and _usable(region_phrase):
        return _clean(region_phrase)

    # 2) 상세위치가 지명/조합이면 그대로
    if location_detail:
        d = _clean(location_detail)
        if d and (_MULTI.fullmatch(d) or _find_place(d) or (_usable(d) and len(d) <= 15)):
            return d

    # 3) 본문의 "장소/위치:" 라인에서 지명 추출 → 그대로
    if body:
        m = _LOC_LINE.search(body)
        if m:
            v = _clean(m.group(1))
            kw = _find_place(v)
            if kw:
                return kw
            if _usable(v):
                return v

    # 4) 제목·본문에서 인식 지명 스캔 (그 지명 그대로)
    for src in (title, location_detail, body):
        kw = _find_place(src)
        if kw:
            return kw

    return default
