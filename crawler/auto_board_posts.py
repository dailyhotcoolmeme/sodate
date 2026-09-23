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

NICKNAMES = [
    'ㅇㅇ', 'ㅋㅋ', '궁금', '오잉', '퇴근하고싶다', '주말뭐하지', '아무거나',
    '그냥궁금', '오늘도출근', '집가고싶음', '소심이', '연애어렵다', '밥뭐먹지',
    '익명', '흠', 'ㄹㅇ', '모르겠다', '고민중', '지나가던사람', '두근두근',
    '직장인1', '주말순삭', '커피수혈', '배고픔', '잠이안옴', '월요일싫다',
]

BANNED = (
    '씨발', '시발', '개새끼', '병신', '지랄', '좆', '보지', '자지', '창녀',
    '성매매', '조건만남', '카톡아이디', '오픈채팅', '주식추천', '코인추천',
)

TOPIC_MIX = """
- 소개팅·첫 만남·애프터 고민 35%
- 썸·연애·연락 문제 25%
- 로테이션 소개팅·소셜링 경험과 질문 20%
- 직장·주말·데이트·맛집 등 2030 일상 15%
- 가벼운 밸런스게임·유행 소재 5%
""".strip()

TOPICS = ['소개팅', '썸연애', '로테이션소개팅', '2030일상', '밸런스게임']

# 모델이 맥락 없는 상황을 억지로 만들지 않게, 실제 커뮤니티에서 답하기 쉬운 소재만 준다.
# 문장과 결론은 모델이 새로 만들고, 이 목록은 소재 방향만 잡는다.
SCENARIOS = [
    '첫 소개팅에서 2차를 누가 먼저 제안하는지',
    '소개팅 전 연락을 얼마나 자주 하는지',
    '첫 만남 옷을 너무 꾸미면 부담스러운지',
    '첫 만남 비용을 어떻게 나누는지',
    '대화는 잘 되는데 상대가 질문을 안 하는 상황',
    '소개팅 후 먼저 연락할지 기다릴지',
    '애프터 식당 메뉴로 무엇이 무난한지',
    '카톡 답장 속도 차이가 큰 썸',
    '주말 데이트 장소가 매번 똑같은 고민',
    '연애 초반 연락 빈도',
    '친구가 소개해준 사람과 잘 안 됐을 때',
    '로테이션 소개팅에 혼자 갈지 같이 갈지',
    '로테이션 소개팅 첫 참가 전 준비할 것',
    '로테이션 소개팅에서 기억에 남는 대화 주제',
    '매칭 후 첫 연락을 뭐라고 시작할지',
    '소개팅 상대와 취미가 하나도 안 겹치는 상황',
    '데이트 중 휴대폰을 자주 보는 상대',
    '사진과 실제 인상이 다를 때',
    '직장인 평일 저녁 데이트가 피곤한지',
    '비 오는 날 가기 좋은 데이트',
    '혼자 전시나 팝업을 보러 가는 것',
    '소개팅에서 술을 마시는 게 좋은지',
    '친구들과 연애 얘기를 어디까지 공유하는지',
    '썸 단계에서 생일 선물을 챙기는지',
    '데이트 장소를 한쪽만 계속 정하는 상황',
    '첫 만남에서 존댓말을 언제 놓는지',
    '장거리 썸을 시작해도 될지',
    '연락은 잘 되는데 약속을 안 잡는 상대',
    '주말 약속이 취소돼 갑자기 할 일이 없는 상황',
    '점심 메뉴를 못 고르는 직장인 가벼운 글',
]

SYSTEM_PROMPT = """당신은 한국의 20~30대 익명 커뮤니티에 올라갈 짧은 게시글 초안을 만든다.
광고문·블로그·상담 답변처럼 반듯하게 쓰지 말고 실제 익명 게시판 이용자처럼 쓴다.
출력은 반드시 요청한 JSON 스키마만 지킨다."""


@dataclass
class Draft:
    title: str
    content: str
    topic: str


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


def _prompt(samples: list[dict[str, str]], count: int) -> str:
    compact = '\n'.join(
        f"- 제목: {s['title']}\n  내용: {s['content']}"
        for s in samples[:24]
    )
    scenarios = random.sample(SCENARIOS, count)
    seeds = '\n'.join(f'- {x}' for x in scenarios)
    return f"""아래는 현재 모잇 익명 게시판의 실제 글이다. 문장을 복사하지 말고 말투와 길이만 참고해 새 글 {count}개를 만들어라.

[실제 게시글 말투 참고]
{compact}

[주제 비율]
{TOPIC_MIX}

[이번에 사용할 소재]
아래 소재를 하나씩만 사용한다. 여기에 없는 사건·장소·직업·성별·나이 설정을 임의로 붙이지 않는다.
{seeds}

[반드시 지킬 말투]
- 짧게 끊고 말하듯 쓴다. 2~6문장이 기본이며 한두 줄짜리 글도 섞는다.
- ㅇㅇ, ㅋㅋ, ㅠ, ??, ㄱㅊ?, 추천좀, 어떰? 같은 표현을 문맥에 맞을 때만 쓴다.
- 줄임말은 ㅇㅇ, ㅋㅋ, ㅠ, ㅜ, ㄱㅊ, ㄹㅇ, 추천좀, 어떰 정도만 쓴다. 알아볼 수 없는 초성이나 새 줄임말을 만들지 않는다.
- 존댓말로 정리된 상담글이나 블로그 문체는 금지한다.
- 맞춤법을 일부러 망가뜨리지는 말되 너무 반듯하게 다듬지 않는다.
- `혹시 ~인가요?`, `여러분들은 어떠세요?`, `~하면 좋을 것 같아요` 같은 설문·상담문 말투를 반복하지 않는다.
- 실제 사람이 폰으로 바로 쓴 것처럼 군더더기 없이 쓴다. 상황과 관계없는 설정을 억지로 붙이지 않는다.
- 제목과 본문 끝맺음·문장 구조를 글마다 다르게 한다.
- 실제 업체나 개인을 비방하거나 사실인 것처럼 지어내지 않는다.
- 연락처, 실명, 성적·불법 내용, 광고는 쓰지 않는다.
- 기존 샘플과 같은 사건·제목을 다시 쓰지 않는다.

[승인된 톤 예시]
제목: 소개팅 잘되면 여자쪽에서 먼저 2차 말해도 ㄱㅊ?
내용: 이번주에 소개팅 있는데 연락할때 느낌은 괜찮거든??\n\n카페에서 얘기 잘통하면 내가 먼저 밥먹자고 해볼까 하는데\n너무 맘에들어하는 티나는건가 ㅋㅋ\n\n남자들 입장에서 여자가 먼저 2차가자하면 어떰?\n걍 배 안고프냐고 물어보면 되나 ㅠ

서로 겹치지 않는 새 글을 JSON으로 반환해라."""


def _call_ai(token: str, samples: list[dict[str, str]], count: int) -> list[Draft]:
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
                    },
                    'required': ['title', 'content', 'topic'],
                },
            }
        },
        'required': ['posts'],
    }
    payload = {
        'messages': [
            {'role': 'system', 'content': SYSTEM_PROMPT},
            {'role': 'user', 'content': _prompt(samples, count)},
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
    return [Draft(str(x['title']).strip(), str(x['content']).strip(), str(x['topic']).strip())
            for x in (parsed or {}).get('posts', [])]


def _valid(draft: Draft, seen: set[str]) -> bool:
    title_key = _key(draft.title)
    merged = f'{draft.title} {draft.content}'.lower().replace(' ', '')
    if not title_key or title_key in seen:
        return False
    if not (1 <= len(draft.title) <= 60 and 1 <= len(draft.content) <= 10_000):
        return False
    if any(word in merged for word in BANNED):
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


def _nicknames(count: int) -> list[str]:
    pool = NICKNAMES[:]
    random.shuffle(pool)
    out: list[str] = []
    counts: Counter[str] = Counter()
    while len(out) < count:
        nick = random.choice(pool)
        if out and out[-1] == nick:
            continue
        if counts[nick] >= 2:
            continue
        counts[nick] += 1
        out.append(nick)
    return out


def generate(count: int, dry_run: bool = False) -> list[dict]:
    token = os.getenv('CF_WORKERS_AI_TOKEN')
    if not token:
        raise RuntimeError('CF_WORKERS_AI_TOKEN이 없습니다')
    sb = get_supabase()
    samples = _recent_samples(sb)
    if len(samples) < 10:
        raise RuntimeError(f'말투 참고용 기존 게시글이 부족합니다({len(samples)}건)')
    seen = {_key(s['title']) for s in samples} | _existing_auto_titles(sb)

    drafts: list[Draft] = []
    # 한 번에 너무 많이 시키면 말투가 반복되므로 세 건씩 나눠 만든다.
    attempts = 0
    max_attempts = max(5, count * 3)
    while len(drafts) < count and attempts < max_attempts:
        attempts += 1
        needed = min(3, count - len(drafts))
        generated = _call_ai(token, random.sample(samples, min(24, len(samples))), needed)
        for draft in generated:
            if _valid(draft, seen):
                drafts.append(draft)
                seen.add(_key(draft.title))
        if not generated:
            break

    if len(drafts) < count:
        raise RuntimeError(f'검증을 통과한 초안이 부족합니다({len(drafts)}/{count})')

    rows = []
    for nick, draft in zip(_nicknames(count), drafts[:count]):
        rows.append({
            'nickname': nick,
            'title': draft.title,
            'content': draft.content,
            'source_type': 'existing_posts',
            'status': 'draft',
            'generation_model': CF_MODEL,
            'generation_notes': f'기존 활성 게시글 {len(samples)}건의 말투 참고 · 주제 {draft.topic}',
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
