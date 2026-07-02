"""공용 지역 해석기 — 모든 스크래퍼가 지역을 일관되게 결정하도록.

핵심:
- 제목/상세위치/본문 어디에 지역이 있든 잡아낸다(우선순위: 명시 문구 > 제목 > 상세 > 본문).
- 조합 지역(서울/경기, 동대문·성북, 대전.광주 등)은 나누지 않고 그대로 유지.
- 알려진 키워드(동/역/구/시)는 대표 지역으로 정규화, 못 찾으면 상세위치 원문을 살려 기타로 안 버림.

새 지역이 계속 나오면 REGION_KEYWORDS에 키워드만 추가하면 전 스크래퍼에 반영됨.
"""
from __future__ import annotations

import re
from typing import Optional

# canonical 지역 라벨 → 매칭 키워드. 위에서부터 먼저 매칭(구체 키워드를 앞쪽에).
REGION_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    # ── 서울 ──
    ('강남', ('역삼', '선릉', '삼성역', '삼성동', '신논현', '논현', '양재', '매봉', '도곡', '대치', '강남', '서초', '교대')),
    ('송파', ('잠실', '문정', '가락', '석촌', '방이', '오금', '송파')),
    ('영등포', ('여의도', '당산', '대림', '신길', '영등포')),
    ('용산', ('한남', '이태원', '삼각지', '숙대', '효창', '용산')),
    ('홍대', ('홍대', '합정', '상수', '망원', '연남', '공덕', '대흥', '마포')),
    ('성수', ('성수', '뚝섬', '서울숲')),
    ('건대', ('건대', '군자', '자양', '어린이대공원')),
    ('종로', ('광화문', '을지로', '종각', '시청', '안국', '인사동', '혜화', '대학로', '종로')),
    ('신촌', ('신촌', '이대', '이화여대', '아현')),
    ('동대문', ('동대문', '청량리', '회기', '제기동', '성북', '안암')),
    ('강동', ('천호', '길동', '명일', '고덕', '상일', '강동')),
    ('노원', ('노원', '상계', '중계', '공릉', '태릉')),
    ('구로', ('신도림', '구로디지털', '구로')),
    ('가산', ('가산', '독산')),
    ('강서', ('마곡', '발산', '까치산', '화곡', '강서')),
    ('목동', ('목동', '오목교', '양천')),
    ('노들', ('노량진', '대방')),
    # ── 경기/인천 ──
    ('수원', ('광교', '인계', '영통', '수원')),
    ('분당', ('분당', '판교', '정자', '서현', '수내', '야탑')),
    ('성남', ('모란', '태평', '성남')),
    ('용인', ('기흥', '수지', '죽전', '용인')),
    ('안양', ('평촌', '범계', '안양')),
    ('부천', ('중동', '상동', '부천')),
    ('일산', ('일산', '화정', '대화', '주엽', '고양')),
    ('하남', ('미사', '하남')),
    ('동탄', ('동탄', '화성')),
    ('평택', ('평택', '송탄')),
    ('인천', ('부평', '주안', '송도', '계양', '구월', '인천')),
    # ── 충청 ──
    ('천안', ('쌍용동', '불당', '천안')),
    ('아산', ('아산',)),
    ('청주', ('오창', '청주')),
    # ── 광역시/특별시 ──
    ('대전', ('둔산', '유성', '대전')),
    ('대구', ('동성로', '수성', '대구')),
    ('부산', ('서면', '해운대', '전포', '광안리', '부산')),
    ('광주', ('상무지구', '충장로', '광주')),
    ('울산', ('삼산', '울산')),
    ('세종', ('세종',)),
    # ── 기타 지역 ──
    ('창원', ('창원', '마산', '진해')),
    ('전주', ('전주',)),
]

# 조합 지역 구분자
_SEP = '/·.,&～~'
_MULTI_RE = re.compile(rf'[가-힣]+(?:\s*[{re.escape(_SEP)}]\s*[가-힣]+)+')
_WS = re.compile(r'\s+')


def _clean(text: str) -> str:
    return _WS.sub(' ', text).strip(' ' + _SEP)


def _match_keyword(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    for label, kws in REGION_KEYWORDS:
        for kw in kws:
            if kw in text:
                return label
    return None


def _looks_like_place(text: str) -> bool:
    """지명처럼 보이는 짧은 문구인지(설명 문장/주소 전체가 아닌)."""
    t = _clean(text)
    return 0 < len(t) <= 20 and bool(re.search(r'[가-힣]', t)) and '원' not in t[-1:]


def resolve_region(
    title: Optional[str] = None,
    location_detail: Optional[str] = None,
    body: Optional[str] = None,
    region_phrase: Optional[str] = None,
    default: str = '기타',
) -> str:
    """지역을 결정한다.

    Args:
        region_phrase: 스크래퍼가 이미 "지역 문구"를 뽑아둔 경우(괜찮소 제목 대괄호,
                       프립 areaName 등). 조합이면 그대로 유지되도록 최우선 사용.
        title/location_detail/body: 순서대로 키워드 스캔.
    """
    # 1) 명시 문구가 조합 지역이면 그대로 유지 (예: "서울/경기", "동대문·성북", "대전.광주")
    if region_phrase:
        p = _clean(region_phrase)
        if _MULTI_RE.fullmatch(p):
            return p
        # 단일 문구면 키워드 정규화 시도, 실패 시 문구 그대로
        return _match_keyword(p) or (p if _looks_like_place(p) else default)

    # 2) 상세위치가 조합 지역 문구면 그대로 유지 (프립 areaName "영등포·구로" 등)
    if location_detail:
        d = _clean(location_detail)
        if _MULTI_RE.fullmatch(d):
            return d

    # 3) 제목 → 상세위치 → 본문 순서로 알려진 키워드 스캔
    for src in (title, location_detail, body):
        m = _match_keyword(src)
        if m:
            return m

    # 4) 상세위치가 지명처럼 보이면 원문 유지(기타로 버리지 않음)
    if location_detail and _looks_like_place(location_detail):
        return _clean(location_detail)

    return default
