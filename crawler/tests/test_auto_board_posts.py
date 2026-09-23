import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from auto_board_posts import (
    AVATAR_IDS,
    AUTO_NICK_ADJ,
    AUTO_NICK_NOUN,
    CASUAL_NICKNAMES,
    Draft,
    _avatars,
    _generation_requests,
    _key,
    _kind_plan,
    _kind_targets,
    _nicknames,
    _plain,
    _valid,
)


def test_plain_removes_board_html():
    assert _plain('<p>첫줄</p><br><p>둘째줄</p>') == '첫줄\n\n둘째줄'


def test_title_key_ignores_spacing_and_symbols():
    assert _key('소개팅 먼저 2차 ㄱㅊ?') == _key('소개팅먼저2차ㄱㅊ')


def test_valid_rejects_foreign_artifacts_and_unknown_jamo():
    seen: set[str] = set()
    assert not _valid(Draft('제목', '이거どう 생각해?', '연애'), seen)
    assert not _valid(Draft('제목', '이거 ㅎㅍㄷㄷ 어떰', '연애'), seen)
    assert _valid(Draft('제목', '이거 ㄱㅊ? ㅋㅋ', '연애'), seen)


def test_valid_rejects_unapproved_emoticons_and_time_weather_context():
    seen: set[str] = set()
    assert not _valid(Draft('제목', '이거 괜찮음 :)', '연애'), seen)
    assert not _valid(Draft('제목', '이거 어떻게 하지 ㅠ', '연애'), seen)
    assert not _valid(Draft('밤공기 좋네', '산책하니까 날씨 좋음', '일상'), seen)
    assert not _valid(Draft('점심 추천', '오늘 뭐먹지?', '일상'), seen)
    assert not _valid(Draft('제목', '너무 웃김 ㅋㅋㅋㅋ', '일상'), seen)
    assert _valid(Draft('간식 추천', '간단하게 먹을만한거 추천좀 ㅋㅋ', '일상'), seen)


def test_valid_rejects_embedded_tag_and_fake_companion_details():
    seen: set[str] = set()
    assert not _valid(Draft('로소 후기', '[리얼후기] 어제 다녀왔음', '소개팅', 'review'), seen)
    assert not _valid(Draft('같이 갈 사람', '30대 남성인데 홍대 갈 사람', '일상', 'companion'), seen)
    assert _valid(Draft('로소 혼자 갔다온 후기', '로소 처음 가봤는데 생각보다 괜찮았음 ㅋㅋ 초반만 넘기니 대화도 재밌고 가길 잘한듯', '소개팅', 'review'), seen)
    assert not _valid(Draft('전시 혼자 갔다온 후기', '전시 처음 가봤는데 생각보다 괜찮았음 ㅋㅋ 작품도 재밌고 가길 잘한듯', '일상', 'review'), seen)
    assert not _valid(Draft('동행 구합니다', '같이 갈 사람 구해요', '일상', 'companion'), seen)
    assert not _valid(Draft('평일 데이트 힘든가요?', '다들 어떠?', '소개팅', 'question'), seen)
    assert not _valid(Draft('장거리 첫 만남', '만나러 가는데 실제로는 어떨지 모르겠음 연락은 재밌게 했는데 긴장된다', '썸연애', 'review'), seen)


def test_nicknames_do_not_repeat_consecutively_or_over_twice():
    names = _nicknames(60)
    assert all(a != b for a, b in zip(names, names[1:]))
    assert max(names.count(name) for name in set(names)) <= 2
    assert all(2 <= len(name) <= 12 for name in names)
    automatic = [name for name in names if any(name.startswith(adj) for adj in AUTO_NICK_ADJ)]
    casual = [name for name in names if name in CASUAL_NICKNAMES]
    assert len(automatic) == 30
    assert len(casual) == 30
    assert '펍귄' in AUTO_NICK_NOUN


def test_avatars_are_real_presets_and_not_consecutive():
    avatars = _avatars(60)
    assert len(avatars) == 60
    assert set(avatars) == set(AVATAR_IDS)
    assert all(a != b for a, b in zip(avatars, avatars[1:]))


def test_three_post_batch_always_contains_review_and_not_only_questions():
    for _ in range(30):
        kinds = _kind_plan(3)
        assert 'review' in kinds
        assert any(kind in {'casual', 'companion'} for kind in kinds)


def test_full_generation_keeps_one_review_per_three_posts():
    kinds = _kind_targets(60)
    assert len(kinds) == 60
    assert kinds.count('review') == 20
    assert kinds.count('advice') == 10
    assert kinds.count('question') == 10
    assert kinds.count('casual') == 16
    assert kinds.count('companion') == 4

    requests = _generation_requests(kinds)
    for kind in set(kinds):
        scenarios = [scenario for request_kind, scenario in requests if request_kind == kind]
        assert len(scenarios) == len(set(scenarios))
