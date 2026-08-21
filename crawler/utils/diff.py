"""DB 현재값과 크롤한 값을 비교해 **실제로 바뀐 필드만** 골라낸다.

## 왜 있나 (2026-08-21)
크롤러가 값이 바뀌든 안 바뀌든 매번 write 해서 Disk IO Budget 이 고갈됐다
(events 1,139행에 UPDATE 25만회, autovacuum 569회). refresh-soldout 은 10분마다
전체 이벤트를 다시 쓰는데 실제 변경분은 극소수. "바뀐 것만 쓰기"로 전환한다.
설계·근거: docs/disk-io-fix-design.md

## 안전 원칙
- **"안 쓴다 = DB 값이 이미 맞다".** 앱이 보는 값은 100% 동일, 정보 지연 0.
- 타입 오판이 가장 위험하다(매번 "달라졌다"로 오판하면 결국 다 써서 효과 0,
  반대로 관대하면 진짜 변경을 놓친다). 그래서 필드 성격별로 명시적으로 비교한다.
- ⚠️ None(정보 없음)과 0(마감/0원)은 **다르게** 취급한다 — 의미가 다르다.
"""
from typing import Any


def differs(old: Any, new: Any) -> bool:
    """DB 현재값 old 와 크롤한 새 값 new 가 '의미상' 다른가.

    같으면 False(=쓸 필요 없음), 다르면 True.
    """
    if old is None and new is None:
        return False
    # None ↔ 값 은 항상 변경으로 본다 (정보 없음 → 있음, 또는 반대).
    if (old is None) != (new is None):
        return True
    # bool 먼저 — 파이썬에서 bool 은 int 의 하위형이라 아래 숫자 분기에 먼저 걸리면
    # True==1 같은 사고가 난다. is_closed(true/false) 는 여기서 처리.
    if isinstance(old, bool) or isinstance(new, bool):
        return bool(old) != bool(new)
    # 숫자(가격·잔여석): 5.0 vs 5 같은 표기차를 흡수하되 값은 정확히 비교.
    if isinstance(old, (int, float)) and isinstance(new, (int, float)):
        return float(old) != float(new)
    # 그 외(문자열·배열 등): 그대로 비교. 배열은 순서까지 같아야 같다.
    return old != new


def changed_fields(current: dict, incoming: dict) -> dict:
    """incoming 중 current 와 실제로 다른 필드만 담은 dict 를 돌려준다.

    current 에 없는 키(새로 생기는 필드)는 변경으로 본다.
    빈 dict 를 돌려주면 = 바뀐 게 없다 = write 를 건너뛰어도 된다.
    """
    out = {}
    for k, v in incoming.items():
        if differs(current.get(k), v):
            out[k] = v
    return out
