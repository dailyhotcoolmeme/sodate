"""모잇 커뮤니티 자동 글 초안 생성기.

기존 게시판의 실제 말투를 참고해 초안을 만들고 auto_board_posts에만 저장한다.
이 스크립트는 board_posts에 직접 쓰지 않는다. 공개는 admin에서 오너가 눌러야 한다.

실행:
  python auto_board_posts.py --count 12
  python auto_board_posts.py --count 3 --dry-run
"""
from __future__ import annotations

import argparse
import html
import json
import os
import random
import re
import time
from collections import Counter
from dataclasses import dataclass

import httpx

from utils.supabase_client import get_supabase


CF_ACCOUNT_ID = os.getenv('CF_ACCOUNT_ID', '4c0f5d706177b84ade4d424a08ec46e8')
CF_MODEL = os.getenv('AUTO_BOARD_AI_MODEL', '@cf/meta/llama-4-scout-17b-16e-instruct')
CF_AI_URL = f'https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/ai/run/{CF_MODEL}'

CASUAL_NICKNAMES = [
    'ㅇㅇ', 'ㅋㅋ', '궁금', '오잉', '퇴근하고싶다', '주말뭐하지', '아무거나',
    '그냥궁금', '오늘도출근', '집가고싶음', '소심이', '연애어렵다', '밥뭐먹지',
    '익명', '흠흠', 'ㄹㅇ', '모르겠다', '고민중', '지나가던사람', '두근두근',
    '직장인1', '주말순삭', '커피수혈', '배고픔', '잠이안옴', '월요일싫다',
]

# 앱 최초 진입 시 자동 배정되는 닉네임과 동일한 조합 풀
# (app/lib/reviewIdentity.ts). 일반 익명형과 절반씩 섞어 자동 글만 따로
# 보이지 않게 한다.
AUTO_NICK_ADJ = [
    '느긋한', '설레는', '포근한', '다정한', '씩씩한', '엉뚱한', '새침한', '발랄한', '든든한', '나른한',
    '상냥한', '명랑한', '수줍은', '활기찬', '차분한', '사랑스런', '귀여운', '온화한', '따뜻한', '재빠른',
    '폭신한', '몽글한', '초롱한', '야무진', '싱그런', '보드란', '깜찍한', '해맑은', '느릿한', '반짝이는',
]
AUTO_NICK_NOUN = [
    '너구리', '수달', '다람쥐', '고슴도치', '알파카', '펍귄', '여우', '토끼', '햄스터', '판다',
    '코알라', '물개', '오리', '참새', '고양이', '강아지', '병아리', '고래', '거북이', '사슴',
    '붕어빵', '마카롱', '복숭아', '딸기', '감자', '도넛', '푸딩', '참외', '귤', '만두', '곰젤리', '떡',
    '구름', '별', '방울', '풍선', '단추', '도토리', '조약돌', '램프', '솜사탕', '우산',
]

AVATAR_IDS = [f'thumbs_{i:02d}' for i in range(1, 25)]

BANNED = (
    '씨발', '시발', '개새끼', '병신', '지랄', '좆', '보지', '자지', '창녀',
    '성매매', '조건만남', '카톡아이디', '오픈채팅', '주식추천', '코인추천', '존나',
)

TOPIC_MIX = """
- 소개팅·첫 만남·애프터 고민 35%
- 썸·연애·연락 문제 25%
- 로테이션 소개팅·소셜링 경험과 질문 20%
- 직장·주말·데이트·맛집 등 2030 일상 15%
- 가벼운 밸런스게임·유행 소재 5%
""".strip()

TOPICS = ['소개팅', '썸연애', '로테이션소개팅', '2030일상', '밸런스게임']
POST_KINDS = ['review', 'advice', 'question', 'casual', 'companion']
KIND_LABELS = {
    'review': '리얼후기',
    'advice': '고민상담',
    'question': '궁금해요',
    'companion': '동행구함',
}

# 모델이 맥락 없는 상황을 억지로 만들지 않게, 실제 커뮤니티에서 답하기 쉬운 소재만 준다.
# 문장과 결론은 모델이 새로 만들고, 이 목록은 소재 방향만 잡는다.
SCENARIOS_BY_KIND = {
    'review': [
        '첫 로테이션 소개팅에 혼자 다녀온 느낌',
        '소개팅에서 카페 후 자연스럽게 2차까지 간 후기',
        '소셜링에서 처음 본 사람들과 대화해 본 후기',
        '매칭 후 첫 연락을 주고받은 후기',
        '애프터에서 식사하고 산책한 가벼운 후기',
        '약속 잡기 전에 연락을 적게 했는데 만나니 괜찮았던 후기',
        '취미가 안 겹쳐도 대화가 잘 됐던 소개팅 후기',
        '비 오는 날 실내 데이트를 해본 후기',
        '첫 만남에서 존댓말을 놓고 편해진 후기',
        '평일 퇴근 후 짧게 만난 데이트 후기',
        '첫 만남에 옷을 조금 과하게 입었지만 대화는 편했던 후기',
        '첫 만남 비용을 자연스럽게 나눠 낸 후기',
        '애프터 메뉴를 고민하다 가벼운 식사로 잘 끝낸 후기',
        '만나는 동안 서로 폰을 안 봐서 대화가 편했던 후기',
        '사진과 실제 인상은 달랐지만 만나니 더 괜찮았던 후기',
        '친구 소개로 만난 사람과 초반은 어색했지만 점점 편해진 후기',
        '썸 단계에서 작은 생일 선물을 주고 받은 후기',
        '혼자 전시를 보고 카페까지 다녀온 후기',
        '주말에 특별한 계획 없이 만났는데 오히려 편했던 데이트 후기',
        '장거리로 연락하던 사람과 첫 만남을 가진 후기',
    ],
    'advice': [
        '대화는 잘 되는데 상대가 질문을 안 하는 상황',
        '소개팅 후 먼저 연락할지 기다릴지',
        '카톡 답장 속도 차이가 큰 썸',
        '연애 초반 연락 빈도',
        '친구가 소개해준 사람과 잘 안 됐을 때',
        '데이트 중 휴대폰을 자주 보는 상대',
        '데이트 장소를 한쪽만 계속 정하는 상황',
        '장거리 썸을 시작해도 될지',
        '연락은 잘 되는데 약속을 안 잡는 상팀',
        '썸 단계에서 생일 선물을 챙기는지',
    ],
    'question': [
        '첫 소개팅에서 2차를 누가 먼저 제안하는지',
        '소개팅 전 연락을 얼마나 자주 하는지',
        '첫 만남 옷을 너무 꾸미면 부담스러운지',
        '첫 만남 비용을 어떻게 나누는지',
        '애프터 식당 메뉴로 무엇이 무난한지',
        '로테이션 소개팅 첫 참가 전 준비할 것',
        '매칭 후 첫 연락을 뭐라고 시작할지',
        '소개팅에서 술을 마시는 게 좋은지',
        '첫 만남에서 존댓말을 언제 놓는지',
        '직장인 평일 저녁 데이트가 피곤한지',
    ],
    'casual': [
        '주말 약속이 취소돼 갑자기 할 일이 없는 상황',
        '점심 메뉴를 못 고르는 직장인 가벼운 글',
        '비 오는 날 실내에서 할 것',
        '혼자 전시나 팝업을 보러 가는 것',
        '퇴근 후 밥 해먹기 귀찮은 날',
        '주말 오전을 잠으로 다 보낸 얘기',
        '친구들과 연애 얘기를 어디까지 공유하는지',
        '최근 자주 먹는 간단한 간식',
        '카페에서 하루 내내 노트북 하는 사람 얘기',
        '월요일 출근 전에 드는 가벼운 생각',
        '퇴근하고 집에 왔는데 아무것도 하기 싫은 날',
        '냉장고에 먹을 게 없어 배달을 고민하는 저녁',
        '주말에 알람 없이 늦잠 자고 기분 좋았던 얘기',
        '최근에 본 재미있는 영화나 드라마 얘기',
        '저녁에 산책 나갔다가 밤공기가 좋았던 얘기',
        '커피를 너무 마셔서 밤에 잠이 안 오는 얘기',
    ],
    'companion': [
        '주말에 혼자 전시를 보러 갈지 동행을 구할지',
        '로테이션 소개팅에 혼자 가기 어색해 동행을 구하는 글',
        '팝업스토어에 같이 갈 사람을 구하는 글',
        '주말 산책이나 카페에 같이 갈 사람을 구하는 글',
        '평일 저녁 저녁밥을 가볍게 같이 먹을 사람을 구하는 글',
        '처음 가는 소셜링에 같이 신청할 사람을 구하는 글',
        '주말에 가벼운 러닝을 같이 할 사람을 구하는 글',
        '새로 개봉한 영화를 같이 볼 사람을 구하는 글',
    ],
}

SYSTEM_PROMPT = """당신은 한국의 20~30대 익명 커뮤니티에 올라갈 짧은 게시글 초안을 만든다.
광고문·블로그·상담 답변처럼 반듯하게 쓰지 말고 실제 익명 게시판 이용자처럼 쓴다.
출력은 반드시 요청한 JSON 스키마만 지킨다."""


@dataclass
class Draft:
    title: str
    content: str
    topic: str
    kind: str = 'question'
    scenario: str = ''


def _plain(value: str) -> str:
    value = re.sub(r'<br\s*/?>', '\n', value or '', flags=re.I)
    value = re.sub(r'</(?:p|li|div|ol|ul)>', '\n', value, flags=re.I)
    value = re.sub(r'<[^>]+>', '', value)
    return html.unescape(value).strip()


def _key(value: str) -> str:
    return re.sub(r'[^0-9a-z가-힣]', '', value.lower())


def _recent_samples(sb) -> list[dict[str, str]]:
    rows = (
        sb.table('board_posts')
        .select('title,content')
        .eq('is_active', True)
        .eq('is_notice', False)
        .order('created_at', desc=True)
        .limit(80)
        .execute().data or []
    )
    samples: list[dict[str, str]] = []
    for row in rows:
        title = _plain(row.get('title') or '')
        content = _plain(row.get('content') or '')
        if not title or not content:
            continue
        samples.append({'title': title[:80], 'content': content[:500]})
    return samples


def _existing_auto_titles(sb) -> set[str]:
    try:
        rows = (
            sb.table('auto_board_posts')
            .select('title')
            .order('created_at', desc=True)
            .limit(500)
            .execute().data or []
        )
    except Exception:
        return set()
    return {_key(r.get('title') or '') for r in rows}


def _kind_plan(count: int) -> list[str]:
    """한 번에 3건을 만들 때 질문만 나열되지 않게 후기 1건을 보장한다."""
    if count == 3:
        kinds = ['review', random.choice(['advice', 'question']), random.choice(['casual', 'companion'])]
    elif count == 2:
        kinds = ['review', random.choice(['advice', 'question', 'casual', 'companion'])]
    else:
        kinds = [random.choices(POST_KINDS, weights=[30, 20, 20, 20, 10], k=1)[0]]
    random.shuffle(kinds)
    return kinds


def _kind_targets(count: int) -> list[str]:
    """전체 생성 건수를 3건씩 나눠 후기·질문·일상 비율을 끝까지 지킨다."""
    targets: list[str] = []
    full_batches, remainder = divmod(count, 3)
    for batch_index in range(full_batches):
        batch = [
            'review',
            'advice' if batch_index % 2 == 0 else 'question',
            'companion' if batch_index % 5 == 4 else 'casual',
        ]
        random.shuffle(batch)
        targets.extend(batch)
    if remainder:
        targets.extend(_kind_plan(remainder))
    return targets


def _generation_requests(kinds: list[str]) -> list[tuple[str, str]]:
    """같은 종류 안에서도 소재가 겹치지 않게 먼저 전체 계획을 짠다."""
    pools = {kind: random.sample(items, len(items)) for kind, items in SCENARIOS_BY_KIND.items()}
    positions: Counter[str] = Counter()
    requests: list[tuple[str, str]] = []
    for kind in kinds:
        position = positions[kind]
        if position and position % len(pools[kind]) == 0:
            random.shuffle(pools[kind])
        requests.append((kind, pools[kind][position % len(pools[kind])]))
        positions[kind] += 1
    return requests


def _prompt(samples: list[dict[str, str]], requests: list[tuple[str, str]]) -> str:
    count = len(requests)
    compact = '\n'.join(
        f"- 제목: {s['title']}\n  내용: {s['content']}"
        for s in samples[:24]
    )
    seeds = '\n'.join(f'- {i + 1}번·{kind}: {scenario}' for i, (kind, scenario) in enumerate(requests))
    return f"""아래는 현재 모잇 익명 게시판의 실제 글이다. 문장을 복사하지 말고 말투와 길이만 참고해 새 글 {count}개를 만들어라.

[실제 게시글 말투 참고]
{compact}

[주제 비율]
{TOPIC_MIX}

[이번에 사용할 소재]
아래 소재와 글 종류를 하나씩만 사용한다. 여기에 없는 사건·장소·직업·성별·나이 설정을 임의로 붙이지 않는다.
{seeds}
- 반드시 1번부터 순서대로 쓰고, 각 번호의 소재 핵심이 제목이나 본문에 드러나야 한다.
- 소재에 로테이션 소개팅이 없으면 `로소`나 `로테이션`으로 바꿔 쓰지 않는다.

[글 종류·말머리]
- review: 질문이 아니라 자신이 겪은 일을 자연스럽게 풀어쓴 후기. 시스템이 [리얼후기] 말머리를 별도로 붙인다. 끝을 굳이 질문으로 마치지 않는다.
- advice: 상황을 풀어놓고 조언을 구하는 글. 시스템이 [고민상담] 말머리를 별도로 붙인다.
- question: 가벼운 궁금증을 묻는 글. 시스템이 [궁금해요] 말머리를 별도로 붙인다.
- companion: 같이 갈 사람을 구하는 글. 시스템이 [동행구함] 말머리를 별도로 붙인다. 연락처는 적지 않는다.
- casual: 일상 잡담. 말머리를 붙이지 않는다.
- 제목과 본문에 [리얼후기], [고민상담] 같은 말머리 문자를 직접 적지 않는다.

[반드시 지킬 말투]
- 짧게 끊고 말하듯 쓴다. 2~6문장이 기본이며 한두 줄짜리 글도 섞는다.
- ㅇㅇ, ㅋㅋ, ㅠ, ??, ㄱㅊ?, 추천좀, 어떰? 같은 표현을 문맥에 맞을 때만 쓴다.
- 줄임말은 ㅇㅇ, ㅋㅋ, ㅠ, ㅜ, ㄱㅊ, ㄹㅇ, 추천좀, 어떰 정도만 쓴다. 알아볼 수 없는 초성이나 새 줄임말을 만들지 않는다.
- 존댓말로 정리된 상담글이나 블로그 문체는 금지한다.
- 맞춤법을 일부러 망가뜨리지는 말되 너무 반듯하게 다듬지 않는다.
- `혹시 ~인가요?`, `여러분들은 어떠세요?`, `~하면 좋을 것 같아요` 같은 설문·상담문 말투를 반복하지 않는다.
- 실제 사람이 폰으로 바로 쓴 것처럼 군더더기 없이 쓴다. 상황과 관계없는 설정을 억지로 붙이지 않는다.
- 모든 글을 질문으로 끝내지 않는다. 특히 review는 느낀 점이나 소감으로 자연스럽게 끝낸다.
- `~습니다`, `~해요`, `~인가요` 같은 존댓말 문체를 쓰지 않고 반말·혼잣말로 쓴다.
- companion에는 소재에 없는 나이·성별·지역·직업·브랜드명·행사명·매장명을 절대 만들어 넣지 않는다.
- 제목과 본문 끝맺음·문장 구조를 글마다 다르게 한다.
- 실제 업체나 개인을 비방하거나 사실인 것처럼 지어내지 않는다.
- 연락처, 실명, 성적·불법 내용, 광고는 쓰지 않는다.
- 기존 샘플과 같은 사건·제목을 다시 쓰지 않는다.

[승인된 톤 예시]
제목: 소개팅 잘되면 여자쪽에서 먼저 2차 말해도 ㄱㅊ?
내용: 이번주에 소개팅 있는데 연락할때 느낌은 괜찮거든??\n\n카페에서 얘기 잘통하면 내가 먼저 밥먹자고 해볼까 하는데\n너무 맘에들어하는 티나는건가 ㅋㅋ\n\n남자들 입장에서 여자가 먼저 2차가자하면 어떰?\n걍 배 안고프냐고 물어보면 되나 ㅠ

[후기 톤 예시]
제목: 로소 혼자 갔다온 후기
내용: 지난주에 처음 가봤는데 생각보다 안어색했음 ㅋㅋ\n\n초반엔 좀 뚝뚝했는데 몇 번 얘기하니 적응되더라\n혼자 갈까말까 고민했는데 가길 잘한듯

서로 겹치지 않는 새 글을 JSON으로 반환해라."""


def _call_ai(token: str, samples: list[dict[str, str]], requests: list[tuple[str, str]]) -> list[Draft]:
    count = len(requests)
    schema = {
        'type': 'object',
        'properties': {
            'posts': {
                'type': 'array',
                'minItems': count,
                'maxItems': count,
                'items': {
                    'type': 'object',
                    'properties': {
                        'title': {'type': 'string', 'minLength': 1, 'maxLength': 60},
                        'content': {'type': 'string', 'minLength': 1, 'maxLength': 1200},
                        'topic': {'type': 'string', 'enum': TOPICS},
                        'kind': {'type': 'string', 'enum': POST_KINDS},
                    },
                    'required': ['title', 'content', 'topic', 'kind'],
                },
            }
        },
        'required': ['posts'],
    }
    payload = {
        'messages': [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': _prompt(samples, requests)},
        ],
        'temperature': 0.75,
        'max_tokens': 5000,
        'response_format': {
            'type': 'json_schema',
            'json_schema': {'name': 'auto_board_posts', 'schema': schema, 'strict': True},
        },
    }
    response = None
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            response = httpx.post(
                CF_AI_URL,
                headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
                json=payload,
                timeout=90,
            )
            response.raise_for_status()
            break
        except (httpx.HTTPError, httpx.TimeoutException) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(1 + attempt * 2)
    if response is None or response.is_error:
        raise RuntimeError(f'Workers AI 호출 실패: {last_error}')
    body = response.json()
    if not body.get('success'):
        raise RuntimeError(f"Workers AI 실패: {body.get('errors')}")
    result = body.get('result') or {}
    raw = result.get('response') if isinstance(result, dict) else result
    # GPT-OSS 등 최신 모델은 Chat Completions 형태로 응답한다.
    if isinstance(result, dict) and result.get('choices'):
        raw = ((result['choices'][0].get('message') or {}).get('content'))
    parsed = json.loads(raw) if isinstance(raw, str) else raw
    return [Draft(str(x['title']).strip(), str(x['content']).strip(), str(x['topic']).strip(), str(x['kind']).strip())
            for x in (parsed or {}).get('posts', [])]


def _valid(draft: Draft, seen: set[str]) -> bool:
    title_key = _key(draft.title)
    merged = f'{draft.title} {draft.content}'.lower().replace(' ', '')
    if not title_key or title_key in seen:
        return False
    if draft.kind not in POST_KINDS:
        return False
    if not (1 <= len(draft.title) <= 60 and 1 <= len(draft.content) <= 10_000):
        return False
    if any(word in merged for word in BANNED):
        return False
    if any(label in merged for label in KIND_LABELS.values()):
        return False
    if re.search(
        r'(습니다|합니다|구합니다|했어요|해요|있어요|없어요|같아요|더라구요|라고요|인가요|있나요|없나요|가나요|되나요|될까요|할까요|어떠세요|줄래요|구해요)',
        f'{draft.title}\n{draft.content}',
    ):
        return False
    if re.search(r'요[?!.~]*(?:\s*[ㅋㅎㅠㅜ]+)?(?:\s|$)', f'{draft.title}\n{draft.content}'):
        return False
    if re.search(r'(?<!\d)1[4-9]\d(?!\d)', merged):
        return False
    if draft.kind == 'review':
        if len(draft.content) < 35:
            return False
        if '?' in draft.content:
            return False
        if re.search(r'(만나러|갈예정|가는데|어떨지|모르겠|고민중)', merged):
            return False
        if not re.search(
            r'(다녀왔|가봤|갔다|갔어|갔음|만나봤|만났다|만났어|만났음|해봤|했더니|했는데|했어|했음|봤더니|봤는데|봤어|봤음|였는데|였어|였음|었는데|았는데|더라|좋았|괜찮았|편했|재밌었|나눠냈|챙겼)',
            draft.content.replace(' ', ''),
        ):
            return False
    if draft.kind == 'companion':
        # 소재에 없는 나이·성별·구체 지역을 만들어 넣은 결과는 버린다.
        if re.search(r'(\d{2}대|\d{2}살|남성|여성|남자|여자|강남|홍대|신촌|성수|건대|잠실)', merged):
            return False
    # 모델이 가끔 한글 대신 일본어·중국어 또는 의미 없는 초성을 섞는다.
    if re.search(r'[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]', merged):
        return False
    for run in re.findall(r'[ㄱ-ㅎㅏ-ㅣ]{3,}', merged):
        if run not in {'ㅋㅋㅋ', 'ㅎㅎㅎ', 'ㅠㅠㅠ', 'ㅜㅜㅜ'}:
            return False
    # 전화번호·이메일·카카오 오픈채팅 주소는 초안 단계에서 바로 버린다.
    if re.search(r'01[016789][-. ]?\d{3,4}[-. ]?\d{4}', merged):
        return False
    if re.search(r'[\w.+-]+@[\w.-]+\.[a-z]{2,}', merged, re.I):
        return False
    if 'open.kakao.com' in merged:
        return False
    return True


def _automatic_nickname() -> str:
    return f'{random.choice(AUTO_NICK_ADJ)}{random.choice(AUTO_NICK_NOUN)}{random.randint(10, 99)}'


def _nicknames(count: int) -> list[str]:
    """앱 자동 배정형과 짧은 익명형을 가까이 1:1로 섞는다."""
    automatic_count = count // 2
    casual_count = count - automatic_count

    automatic: list[str] = []
    while len(automatic) < automatic_count:
        nickname = _automatic_nickname()
        if nickname not in automatic:
            automatic.append(nickname)

    casual: list[str] = []
    pool = CASUAL_NICKNAMES[:]
    while len(casual) < casual_count:
        random.shuffle(pool)
        for nickname in pool:
            if casual.count(nickname) < 2:
                casual.append(nickname)
                if len(casual) == casual_count:
                    break

    out = automatic + casual
    random.shuffle(out)
    for i in range(1, len(out)):
        if out[i] != out[i - 1]:
            continue
        swap = next((j for j in range(i + 1, len(out)) if out[j] != out[i]), None)
        if swap is not None:
            out[i], out[swap] = out[swap], out[i]
    return out


def _avatars(count: int) -> list[str]:
    """24종을 고르게 섞고 같은 이미지가 연속해 나오지 않게 한다."""
    out: list[str] = []
    while len(out) < count:
        pool = AVATAR_IDS[:]
        random.shuffle(pool)
        if out and pool[0] == out[-1]:
            pool[0], pool[1] = pool[1], pool[0]
        out.extend(pool[:count - len(out)])
    return out


def _active_tag_ids(sb) -> dict[str, str]:
    rows = (
        sb.table('board_tags')
        .select('id,label')
        .eq('is_active', True)
        .execute().data or []
    )
    return {str(row.get('label') or '').strip('[] '): str(row['id']) for row in rows}


def generate(count: int, dry_run: bool = False) -> list[dict]:
    token = os.getenv('CF_WORKERS_AI_TOKEN')
    if not token:
        raise RuntimeError('CF_WORKERS_AI_TOKEN이 없습니다')
    sb = get_supabase()
    samples = _recent_samples(sb)
    if len(samples) < 10:
        raise RuntimeError(f'말투 참고용 기존 게시글이 부족합니다({len(samples)}건)')
    seen = {_key(s['title']) for s in samples} | _existing_auto_titles(sb)
    tag_ids = _active_tag_ids(sb)

    drafts: list[Draft] = []
    pending_requests = _generation_requests(_kind_targets(count))
    # 한 번에 너무 많이 시키면 말투가 반복되므로 세 건씩 나눠 만든다.
    attempts = 0
    max_attempts = max(5, count * 3)
    while pending_requests and attempts < max_attempts:
        attempts += 1
        requests = pending_requests[:3]
        generated = _call_ai(token, random.sample(samples, min(24, len(samples))), requests)
        retry_requests: list[tuple[str, str]] = []
        for index, (kind, scenario) in enumerate(requests):
            draft = generated[index] if index < len(generated) else None
            if draft is not None and draft.kind == kind and _valid(draft, seen):
                draft.scenario = scenario
                drafts.append(draft)
                seen.add(_key(draft.title))
            else:
                retry_requests.append((kind, scenario))
        pending_requests = retry_requests + pending_requests[len(requests):]
        if not generated:
            break

    if not drafts:
        raise RuntimeError(f'검증을 통과한 초안이 없습니다(0/{count})')
    if len(drafts) < count:
        # 좋지 않은 글을 얇은 기준으로 억지 통과시키지 않는다. 이번에 통과한
        # 글만 저장하면 다음 실행이 남은 부족분을 다시 채운다.
        print(f'주의: 품질 검증 통과 {len(drafts)}/{count}건 — 통과한 초안만 저장합니다')

    rows = []
    saved_count = len(drafts)
    for nick, avatar_id, draft in zip(_nicknames(saved_count), _avatars(saved_count), drafts):
        rows.append({
            'nickname': nick,
            'title': draft.title,
            'content': draft.content,
            'avatar_id': avatar_id,
            'tag_id': tag_ids.get(KIND_LABELS.get(draft.kind, '')),
            'source_type': 'existing_posts',
            'status': 'draft',
            'generation_model': CF_MODEL,
            'generation_notes': f'기존 활성 게시글 {len(samples)}건의 말투 참고 · {draft.kind} · 주제 {draft.topic} · 소재 {draft.scenario}',
        })

    if dry_run:
        return rows
    result = sb.table('auto_board_posts').insert(rows).execute()
    saved = result.data or []
    if len(saved) != len(rows):
        raise RuntimeError(f'초안 저장 건수 불일치({len(saved)}/{len(rows)})')
    return saved


def open_queue_count() -> int:
    sb = get_supabase()
    rows = (
        sb.table('auto_board_posts')
        .select('id')
        .in_('status', ['draft', 'ready', 'scheduled'])
        .limit(100)
        .execute().data or []
    )
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--count', type=int, default=12)
    parser.add_argument('--fill-to', type=int, default=0,
                        help='미게시 대기 글이 이 개수가 되도록 부족분만 생성')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    if args.fill_to:
        if not 1 <= args.fill_to <= 100:
            raise SystemExit('--fill-to는 1~100이어야 합니다')
        current = open_queue_count()
        args.count = max(0, args.fill_to - current)
        if args.count == 0:
            print(f'미게시 대기 글 {current}건 — 추가 생성 없음')
            return
    if not 1 <= args.count <= 100:
        raise SystemExit('--count는 1~100이어야 합니다')
    rows = generate(args.count, args.dry_run)
    print(f"{'생성 확인' if args.dry_run else '초안 저장'}: {len(rows)}건")
    for row in rows:
        print(f"- [{row['nickname']}] {row['title']}")


if __name__ == '__main__':
    main()
