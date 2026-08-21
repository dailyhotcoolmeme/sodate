"""utils/diff.py 테스트 — "바뀐 값만 write"의 핵심 비교 로직.

이 로직이 틀리면 두 가지 사고가 난다:
  · 너무 관대 → 실제 변경(마감·가격)을 놓쳐서 앱에 옛 정보가 뜬다
  · 너무 엄격 → 안 바뀐 것도 매번 써서 Disk IO 절감이 무의미해진다
그래서 경계 케이스를 못 박아 둔다. 배경: crawler/docs/disk-io-fix-design.md
"""
from utils.diff import differs, changed_fields


def test_none_pair_is_same():
    # 둘 다 정보 없음 → 안 씀
    assert differs(None, None) is False


def test_none_to_value_is_change():
    # 정보없음 → 값 (또는 반대)은 항상 변경. 특히 None→0(마감)은 의미가 다르므로 써야 한다.
    assert differs(None, 0) is True
    assert differs(0, None) is True
    assert differs(None, False) is True


def test_bool_compared_as_bool():
    # is_closed: None/False 는 같게 취급, True 는 다르게.
    assert differs(False, False) is False
    assert differs(True, True) is False
    assert differs(False, True) is True   # 모집중 → 마감 (반드시 씀)
    assert differs(True, False) is True   # 마감 → 모집중 (반드시 씀)


def test_bool_not_confused_with_int():
    # 파이썬에서 True==1 이지만, 여기서는 bool 로만 비교해 사고를 막는다.
    assert differs(True, 1) is False   # bool(True)==bool(1) → 같음(둘 다 참)
    assert differs(1, True) is False


def test_numeric_equal_across_types():
    # 5.0 vs 5 같은 표기차는 흡수하되 값은 정확히 비교(가격·잔여석).
    assert differs(5, 5) is False
    assert differs(5.0, 5) is False
    assert differs(5, 3) is True       # 잔여석 감소
    assert differs(44000, 45000) is True


def test_dict_and_list_compared_by_value():
    # price_detail(dict), thumbnail_urls(list) 는 값·순서까지 같아야 같다.
    a = {'male': [['정가', 44000, None]]}
    assert differs(a, dict(a)) is False
    assert differs(a, {'male': [['얼리버드', 39000, '~8/25']]}) is True
    # 배열 순서가 다르면 변경(사용자가 고른 사진 순서를 유지해야 하므로 순서도 의미가 있다).
    assert differs(['a', 'b'], ['b', 'a']) is True
    assert differs(['a', 'b'], ['a', 'b']) is False


def test_changed_fields_empty_when_all_same():
    # 모집중 이벤트가 여전히 모집중 → 아무것도 안 바뀜 → 빈 dict(=write 스킵).
    cur = {'is_closed': False, 'seats_left_male': 8, 'seats_left_female': 4, 'price_male': 44000}
    incoming = dict(cur)
    assert changed_fields(cur, incoming) == {}


def test_changed_fields_returns_only_changed():
    # 남성 마감(8→0)만 바뀜 → 그 필드만 돌려줘야 한다.
    cur = {'is_closed': False, 'seats_left_male': 8, 'seats_left_female': 4}
    incoming = {'is_closed': False, 'seats_left_male': 0, 'seats_left_female': 4}
    assert changed_fields(cur, incoming) == {'seats_left_male': 0}


def test_changed_fields_treats_missing_current_as_change():
    # current 에 없던 키(예: 새 컬럼)는 변경으로 본다 → 새 이벤트/신규 필드가 누락되지 않는다.
    assert changed_fields({}, {'is_closed': True}) == {'is_closed': True}
