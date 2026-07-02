"""해시태그 자동 생성 공통 유틸.

크롤러가 1차로 해시태그를 자동 생성하고, admin에서 검수·수정하는 하이브리드 방식.
스크래퍼별 분산 로직 대신 이 유틸 1개에서
`제목 + 본문(description) + 지역 + 나이대 + extra(공식 옵션값 등)` 텍스트를
정규화 사전에 매핑하여 이벤트당 최대 3~4개 태그를 만든다.

우선순위: 컨셉 > 형식 > 대상. (cap을 넘으면 낮은 우선순위 태그가 잘림)
"""
from __future__ import annotations

from typing import Optional

# ------------------------------------------------------------------ #
# 시작 사전 — canonical 태그 → 매칭 키워드 목록 (admin에서 계속 편집 가능)
# ------------------------------------------------------------------ #

# 컨셉 (최우선)
CONCEPT_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ('#와인', ('와인', 'wine', '와인바', '와인팟')),
    ('#요리', ('요리', '쿠킹', 'cooking', '쿠킹클래스', '쿠킹클라스',
               '원데이클래스', '베이킹', '만들기', '클래스')),
    ('#보드게임', ('보드게임', '보드 게임', 'boardgame', '방탈출', '마피아', '게임')),
    ('#등산·아웃도어', ('등산', '아웃도어', '등산·아웃도어', '클라이밍', '캠핑',
                    '러닝', '트레킹', '하이킹', '산책', '풋살', '스포츠')),
    ('#전시·문화', ('전시', '미술관', '갤러리', '공연', '뮤지컬', '전시회',
                 '팝업', '문화생활', '영화', '연극', '공방')),
    ('#가치관팅', ('가치관', '가치관팅')),
    ('#사주·타로', ('사주', '타로', '사주·타로', 'mbti', '엠비티아이', '점성')),
    ('#독서', ('독서', '북토크', '독서모임', '북클럽', '책모임', '독서회')),
]

# 형식 (중간)
FORMAT_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ('#1:1', ('1:1', '1대1', '일대일', '원온원', '1 대 1')),
    ('#소규모', ('소규모', '소수정예', '스몰', '소인원', '소수')),
    ('#로테이션', ('로테이션', 'rotation', '로테')),
    ('#커피미팅', ('커피미팅', '커피 미팅', '커피챗', '티타임', '카페모임', '커피타임')),
    ('#식사모임', ('식사모임', '디너', '만찬', '저녁식사', '점심모임', '식사',
                '다이닝', '맛집')),
    ('#사회자진행', ('사회자', '진행자', '호스트진행', '사회자진행', '진행자가')),
]

# 대상 (키워드 기반; 연령대는 별도 나이 범위로 산출)
TARGET_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ('#직장인', ('직장인', '회사원', '샐러리맨', '워커')),
    ('#전문직', ('전문직', '의사', '변호사', '약사', '회계사', '변리사',
               '판사', '검사', '교수', '세무사', '감정평가사', '전문직만')),
]


def _age_tags(age_min: Optional[int], age_max: Optional[int]) -> list[str]:
    """나이 범위가 겹치는 연령대 대상 태그를 반환한다."""
    if age_min is None and age_max is None:
        return []
    lo = age_min if age_min is not None else age_max
    hi = age_max if age_max is not None else age_min
    if lo is None or hi is None:
        return []
    if lo > hi:
        lo, hi = hi, lo
    tags: list[str] = []
    for decade, tag in ((20, '#20대'), (30, '#30대'), (40, '#40대')):
        # 이벤트 나이 범위가 해당 연령대(decade ~ decade+9)와 겹치면 태그 부여
        if lo <= decade + 9 and hi >= decade:
            tags.append(tag)
    return tags


def derive_hashtags(
    title: Optional[str],
    description: Optional[str] = None,
    region: Optional[str] = None,
    age_min: Optional[int] = None,
    age_max: Optional[int] = None,
    extra: Optional[str] = None,
    limit: int = 4,
) -> list[str]:
    """제목·본문·지역·나이대·extra에서 해시태그를 자동 생성한다.

    우선순위(컨셉>형식>대상)로 스캔하고 중복 제거 후 최대 `limit`개를 반환한다.
    매칭이 하나도 없으면 빈 리스트를 반환한다(호출부에서 빈 배열로 덮지 않도록 처리).
    """
    parts = [p for p in (title, description, region, extra) if p]
    text = ' '.join(parts).lower()

    result: list[str] = []

    def scan(mapping: list[tuple[str, tuple[str, ...]]]) -> None:
        for tag, keywords in mapping:
            if tag in result:
                continue
            for kw in keywords:
                if kw.lower() in text:
                    result.append(tag)
                    break

    # 우선순위 순서대로 스캔 (cap을 넘으면 뒤쪽이 잘림)
    scan(CONCEPT_KEYWORDS)
    scan(FORMAT_KEYWORDS)
    scan(TARGET_KEYWORDS)

    # 연령대 대상 태그 (나이 범위 기반)
    for tag in _age_tags(age_min, age_max):
        if tag not in result:
            result.append(tag)

    return result[:limit]
