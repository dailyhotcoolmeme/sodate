"""해시태그 자동 생성 공통 유틸.

해시태그는 앱에서 **누르면 그 태그로 필터가 걸려 목록으로 이동**한다(HashtagChips).
따라서 같은 뜻은 반드시 같은 태그로 모여야 하고, 틀린 태그가 붙으면 사용자가
누른 결과가 엉뚱해진다.

⚠️ 근거는 **모임 제목만** 쓴다 (2026-07-28 전수조사 후 오너 확정).
   상세설명(description)을 같이 스캔하던 방식은 82%의 이벤트에 근거 없는 태그를
   달고 있었다. 본문은 홍보문구·후기·참가자 명단이 섞인 글이라 다음처럼 샜다:
     - "남자4: 91년생/공무원"(참가자 명단)  → #공무원 #대기업 #전문직
     - "억지게임 NO"(게임 안 한다는 뜻)     → #보드게임
     - "분위기를 만들기 위해"                → #요리
     - "2시간의 러닝타임"                    → #등산·아웃도어
     - "MBTI 'I'라도 걱정 NO"               → #사주·타로
   본문에서 살릴 방법이 없어 스캔 자체를 제거했다.

제외 결정(오너):
  - #로테이션 : 절반 이상에 해당하는 보편어. 형식 구분은 #파티/#1:1/#12:12로 한다.
  - #티키타카 : 특정 업체 모임명이라 해시태그가 될 수 없다.

우선순위: 컨셉 > 형식 > 대상 > 나이. (limit을 넘으면 뒤쪽이 잘림)
"""
from __future__ import annotations

import re
from typing import Optional

# ------------------------------------------------------------------ #
# 태그 사전 — canonical 태그 → 제목에서 찾을 키워드
# (매칭 시 제목의 공백을 제거하므로 키워드도 공백 없이 적는다)
# ------------------------------------------------------------------ #

# 컨셉 (최우선)
CONCEPT_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ('#와인', ('와인',)),
    ('#커피미팅', ('커피', '카페')),
    ('#파티', ('파티',)),
    ('#하이볼·위스키', ('하이볼', '위스키')),
    ('#야장·루프탑', ('야장', '루프탑', '테라스')),
    ('#가치관팅', ('가치관',)),
    ('#사주·타로', ('사주', '타로')),
]

# 형식 (중간) — N:N은 시각("오후 10:10")과 헷갈리지 않도록 별도 정규식으로 본다
FORMAT_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ('#소규모', ('소규모', '소수정예', '프라이빗')),
]

# N:N 형식 — 앞뒤에 숫자가 붙지 않는 경우만 인정
NN_FORMATS: list[tuple[str, str]] = [
    ('#1:1', '1'), ('#2:2', '2'), ('#4:4', '4'), ('#6:6', '6'),
    ('#7:7', '7'), ('#10:10', '10'), ('#12:12', '12'), ('#15:15', '15'),
]

# 대상 (나이대는 아래 _age_tags에서 별도 산출)
TARGET_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ('#직장인', ('직장인', '회사원')),
    ('#돌싱', ('돌싱', '재혼', '싱글맘', '싱글대디')),
    ('#결정사급', ('결정사급', '결혼정보')),
    ('#키175이상', ('175이상', '키175')),
    ('#프리미엄', ('프리미엄', '고소득', '하이엔드', '능력특집', '승인제')),
    ('#전문직', ('전문직', '의사', '변호사', '약사', '승무원')),
    ('#대기업', ('대기업',)),
    ('#공무원', ('공무원', '공기업')),
    ('#교사', ('교사', '교직')),
    ('#무자녀', ('무자녀',)),
    ('#비흡연', ('비흡연', '금연')),
    ('#크리스천', ('크리스천', '기독')),
]


def _nn_regex(n: str) -> re.Pattern:
    """'12:12' / '12대12' — 양옆에 다른 숫자가 붙지 않은 경우만."""
    return re.compile(rf'(?<!\d){n}(?::|대){n}(?!\d)')


_NN_COMPILED = [(tag, _nn_regex(n)) for tag, n in NN_FORMATS]


def _age_tags(age_min: Optional[int], age_max: Optional[int]) -> list[str]:
    """나이 범위가 겹치는 연령대 태그를 반환한다."""
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
        if lo <= decade + 9 and hi >= decade:
            tags.append(tag)
    return tags


def derive_hashtags(
    title: Optional[str],
    description: Optional[str] = None,   # ⚠️ 받기만 하고 쓰지 않는다(호출부 호환용)
    region: Optional[str] = None,        # ⚠️ 동일
    age_min: Optional[int] = None,
    age_max: Optional[int] = None,
    extra: Optional[str] = None,         # ⚠️ 동일
    limit: int = 4,
) -> list[str]:
    """모임 제목 + 나이 범위에서 해시태그를 생성한다.

    description/region/extra 인자는 예전 호출부 호환을 위해 남겨두었을 뿐
    태그 산출에는 쓰지 않는다(위 모듈 주석의 오탐 사례 참조).
    매칭이 하나도 없으면 빈 리스트를 반환한다(호출부에서 빈 배열로 덮지 않도록 처리).
    """
    text = (title or '').lower().replace(' ', '')

    result: list[str] = []

    def scan(mapping: list[tuple[str, tuple[str, ...]]]) -> None:
        for tag, keywords in mapping:
            if tag in result:
                continue
            for kw in keywords:
                if kw.lower().replace(' ', '') in text:
                    result.append(tag)
                    break

    scan(CONCEPT_KEYWORDS)
    for tag, pat in _NN_COMPILED:
        if tag not in result and pat.search(text):
            result.append(tag)
    scan(FORMAT_KEYWORDS)
    scan(TARGET_KEYWORDS)

    for tag in _age_tags(age_min, age_max):
        if tag not in result:
            result.append(tag)

    return result[:limit]
