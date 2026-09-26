import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from auto_board_posts import (
    AVATAR_IDS,
    AUTO_NICK_ADJ,
    AUTO_NICK_NOUN,
    CASUAL_NICKNAMES,
    Draft,
    _avatars,
    _content_key,
    _generation_requests,
    _key,
    _kind_plan,
    _kind_targets,
    _is_similar_content,
    _local_drafts,
    _nicknames,
    _plain,
    _parse_ai_json,
    _prompt,
    _tag_ids_for_drafts,
    _valid,
    _valid_generated_quality,
)


def test_plain_removes_board_html():
    assert _plain('<p>첫줄</p><br><p>둘째줄</p>') == '첫줄\n\n둘째줄'


def test_ai_json_parser_accepts_code_fence_and_reasoning_prefix():
    raw = '먼저 조건을 확인했습니다\n```json\n{"posts":[{"title":"제목"}]}\n```'
    assert _parse_ai_json(raw)['posts'][0]['title'] == '제목'


def test_title_key_ignores_spacing_and_symbols():
    assert _key('소개팅 먼저 2차 ㄱㅊ?') == _key('소개팅먼저2차ㄱㅊ')


def test_content_duplicate_and_near_duplicate_are_rejected():
    original = '친구가 소개해준 사람이랑 한 번 만났는데 대화는 괜찮았지만 다시 만날 느낌은 없었음'
    same_with_spacing = '친구가 소개해준 사람이랑 한 번 만났는데\n대화는 괜찮았지만 다시 만날 느낌은 없었음'
    lightly_changed = '친구가 소개해준 사람이랑 한 번 만났는데 대화는 편했지만 다시 만날 느낌은 없었음'
    history = [_content_key(original)]

    assert _is_similar_content(same_with_spacing, history)
    assert _is_similar_content(lightly_changed, history)
    assert not _valid(Draft('다른 제목', same_with_spacing, '소개팅', 'advice'), set(), history)


def test_overused_phrase_is_rejected():
    assert not _valid(Draft('이거 은근 궁금함', '다들 어떻게 생각함?', '일상'), set())


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
    assert not _valid(Draft('지난주 소개팅', '그때 대화는 괜찮았음', '소개팅'), seen)
    assert not _valid(Draft('다음 달 소셜링', '한번 가볼까 고민중', '소개팅'), seen)
    assert not _valid(Draft('제목', '너무 웃김 ㅋㅋㅋㅋ', '일상'), seen)
    assert not _valid(Draft('장거리 썸 고민입니다', '거리 멀어도 시작해도 될까?', '연애'), seen)
    assert _valid(Draft('간식 추천', '간단하게 먹을만한거 추천좀 ㅋㅋ', '일상'), seen)


def test_valid_rejects_invisible_filler_characters():
    assert not _valid(Draft('제목', '첫 문장ㅤ둘째 문장', '일상'), set())


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
        scenarios = [scenario for request_kind, scenario, _ in requests if request_kind == kind]
        assert len(scenarios) == len(set(scenarios))
    assert sum(is_long for _, _, is_long in requests) == 12


def test_cloudflare_quality_requires_length_and_matching_scenario():
    short = Draft('혼술바 후기', '괜찮았음', '로테이션소개팅', 'review', '혼술바 후기')
    wrong = Draft(
        '소개팅 사진보다 실물이 나았음',
        '사진이랑 실제 인상이 달랐는데 만나서 얘기해보니 반응도 좋고 대화도 잘 이어져서 편했어 다음에도 한 번 더 보고 싶다는 생각이 들었음',
        '소개팅',
        'review',
        '혼술바에서 대화한 후기',
    )
    long_enough = Draft(
        '혼술바 혼자 가본 후기',
        '혼술바 혼자 가봤는데 처음 들어갈 때만 어색했어 한 잔 시키고 앉아 있으니 옆자리랑 자연스럽게 얘기가 이어졌고 계속 말하지 않아도 돼서 편했음',
        '로테이션소개팅',
        'review',
        '혼술바에서 대화한 후기',
    )

    assert not _valid_generated_quality(short)
    assert not _valid_generated_quality(wrong)
    assert _valid_generated_quality(long_enough)


def test_cloudflare_quality_rejects_invented_gender_and_unbroken_long_post():
    invented_gender = Draft(
        '친구 소개 받은 사람 애매함',
        '친구가 연결해준 남자랑 만나봤는데 대화는 무난했고 불편하진 않았음 근데 다시 약속 잡을 정도로 끌리진 않아서 친구한테 뭐라고 말해야 할지 고민됨',
        '소개팅',
        'advice',
        '친구가 소개해준 사람과 한 번 만난 뒤 애매한 상황',
    )
    unbroken_long = Draft(
        '혼술바 혼자 가본 후기',
        '혼술바에 혼자 가봤는데 들어갈 때는 꽤 어색했음 한 잔 시키고 자리에 앉아 있으니 생각보다 혼자 온 사람도 보였고 굳이 계속 말을 하지 않아도 돼서 편했어 옆자리랑 가볍게 얘기가 시작됐는데 부담스럽지 않았고 대화가 끊겨도 각자 마시면 되니까 좋더라 처음부터 새로운 사람을 만나야겠다는 생각으로 가면 힘들 것 같고 그냥 한잔하면서 분위기 구경한다는 느낌이면 괜찮은 듯 혼자 갈까 고민했는데 한 번쯤은 가볼 만했음',
        '로테이션소개팅',
        'review',
        '혼술바에 혼자 가서 옆자리 사람과 가볍게 대화한 후기',
        True,
    )

    assert not _valid_generated_quality(invented_gender)
    assert not _valid_generated_quality(unbroken_long)


def test_cloudflare_retry_request_keeps_length_flag_in_prompt():
    prompt = _prompt(
        [{'title': '샘플', 'content': '샘플 내용'}],
        [('review', '혼술바에 혼자 다녀온 후기', True)],
    )
    assert 'review·긴 글' in prompt


def test_local_generator_makes_token_free_batch_with_unique_valid_posts():
    random.seed(20260923)
    kinds = _kind_targets(30)
    contents: list[str] = []
    drafts = _local_drafts(kinds, set(), contents)

    assert len(drafts) == 30
    assert len({_key(draft.title) for draft in drafts}) == 30
    assert len(set(contents)) == 30
    assert all(_valid(draft, set()) for draft in drafts)
    assert sum(draft.kind == 'review' for draft in drafts) == 10
    long_drafts = [draft for draft in drafts if draft.is_long]
    assert len(long_drafts) == 6
    assert all(len(draft.content) >= 160 for draft in long_drafts)
    assert all(not (a.is_long and b.is_long) for a, b in zip(drafts, drafts[1:]))
    assert all('후기 후기' not in draft.title for draft in drafts)
    assert all(':)' not in f'{draft.title}{draft.content}' for draft in drafts)
    assert all('ㅠ' not in f'{draft.title}{draft.content}' for draft in drafts)
    assert all('은근 궁금함' not in f'{draft.title}{draft.content}' for draft in drafts)


def test_most_generated_posts_have_no_tag_even_when_kind_has_one():
    random.seed(20260924)
    drafts = _local_drafts(_kind_targets(90), set())
    tag_ids = {
        '리얼후기': 'review-id',
        '고민상담': 'advice-id',
        '궁금해요': 'question-id',
        '동행구함': 'companion-id',
    }
    assigned = _tag_ids_for_drafts(drafts, tag_ids)

    assert sum(tag_id is not None for tag_id in assigned) <= 23
    assert sum(tag_id is None for tag_id in assigned) >= 67
    assert all(tag_id is None for draft, tag_id in zip(drafts, assigned) if draft.kind == 'casual')
