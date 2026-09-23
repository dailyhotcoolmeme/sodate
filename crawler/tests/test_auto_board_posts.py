import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from auto_board_posts import Draft, _key, _nicknames, _plain, _valid


def test_plain_removes_board_html():
    assert _plain('<p>첫줄</p><br><p>둘째줄</p>') == '첫줄\n\n둘째줄'


def test_title_key_ignores_spacing_and_symbols():
    assert _key('소개팅 먼저 2차 ㄱㅊ?') == _key('소개팅먼저2차ㄱㅊ')


def test_valid_rejects_foreign_artifacts_and_unknown_jamo():
    seen: set[str] = set()
    assert not _valid(Draft('제목', '이거どう 생각해?', '연애'), seen)
    assert not _valid(Draft('제목', '이거 ㅎㅍㄷㄷ 어떰', '연애'), seen)
    assert _valid(Draft('제목', '이거 ㄱㅊ? ㅋㅋ', '연애'), seen)


def test_nicknames_do_not_repeat_consecutively_or_over_twice():
    names = _nicknames(40)
    assert all(a != b for a, b in zip(names, names[1:]))
    assert max(names.count(name) for name in set(names)) <= 2
