"""SuperGrok 웹에서 생성한 JSON을 관리자 자동 게시 대기함에 넣는다.

이 스크립트는 AI를 호출하지 않는다. 금칙어·중복·형식 검사를 로컬에서 한 뒤
통과한 글만 auto_board_posts.ready 상태로 저장한다.

사용:
  python import_supergrok_posts.py drafts.json
  python import_supergrok_posts.py drafts.json --dry-run
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from auto_board_posts import (
    Draft,
    _active_tag_ids,
    _avatars,
    _content_key,
    _existing_auto_history,
    _key,
    _nicknames,
    _valid,
)
from utils.supabase_client import get_supabase


ALLOWED_KINDS = {'advice', 'question', 'casual'}
ALLOWED_TAGS = {None, '고민상담', '궁금해요'}


def _topic(kind: str, text: str) -> str:
    if any(word in text for word in ('로테이션', '로테 소개팅', '로소', '소셜링')):
        return '로테이션소개팅'
    if any(word in text for word in ('소개팅', '첫 만남', '애프터')):
        return '소개팅'
    if any(word in text for word in ('썸', '연락', '답장', '메시지', '데이트')):
        return '썸연애'
    return '2030일상'


def prepare_rows(payload: object, sb) -> tuple[list[dict], list[str]]:
    if not isinstance(payload, list):
        raise ValueError('최상위 JSON은 배열이어야 합니다')

    seen, seen_contents = _existing_auto_history(sb)
    tag_ids = _active_tag_ids(sb)
    accepted: list[tuple[Draft, str | None]] = []
    rejected: list[str] = []

    for index, item in enumerate(payload, 1):
        if not isinstance(item, dict):
            rejected.append(f'{index}번: 객체가 아님')
            continue
        title = str(item.get('title') or '').strip()
        content = str(item.get('content') or '').strip()
        kind = str(item.get('kind') or '').strip()
        tag = item.get('tag')
        is_long = item.get('long') is True
        if kind not in ALLOWED_KINDS or tag not in ALLOWED_TAGS:
            rejected.append(f'{index}번 {title!r}: 종류 또는 말머리 오류')
            continue
        if tag == '고민상담' and kind != 'advice':
            rejected.append(f'{index}번 {title!r}: 고민상담과 글 종류 불일치')
            continue
        if tag == '궁금해요' and kind != 'question':
            rejected.append(f'{index}번 {title!r}: 궁금해요와 글 종류 불일치')
            continue
        line_count = len([line for line in content.splitlines() if line.strip()])
        if line_count < 2 or (is_long and not 6 <= line_count <= 9):
            rejected.append(f'{index}번 {title!r}: 본문 줄 수 오류')
            continue
        draft = Draft(title, content, _topic(kind, f'{title} {content}'), kind, title, is_long)
        if not _valid(draft, seen, seen_contents):
            rejected.append(f'{index}번 {title!r}: 금칙어 또는 기존 글과 중복')
            continue
        accepted.append((draft, tag))
        seen.add(_key(title))
        seen_contents.append(_content_key(content))

    names = _nicknames(len(accepted))
    avatars = _avatars(len(accepted))
    rows: list[dict] = []
    for name, avatar, (draft, tag) in zip(names, avatars, accepted):
        rows.append({
            'nickname': name,
            'title': draft.title,
            'content': draft.content,
            'avatar_id': avatar,
            'tag_id': tag_ids.get(tag) if tag else None,
            'source_type': 'original',
            'status': 'ready',
            'generation_model': 'supergrok-web',
            'generation_notes': f'SuperGrok 유료 웹 생성 · 관리자 검수 대기 · {draft.kind} · {"긴 글" if draft.is_long else "일반 글"}',
        })
    return rows, rejected


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('json_file', help='JSON 파일 경로 또는 표준입력은 -')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    raw = sys.stdin.read() if args.json_file == '-' else Path(args.json_file).read_text(encoding='utf-8')
    payload = json.loads(raw)
    sb = get_supabase()
    rows, rejected = prepare_rows(payload, sb)
    for reason in rejected:
        print(f'제외: {reason}')
    if args.dry_run:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return
    if not rows:
        raise RuntimeError('검증을 통과한 글이 없습니다')
    saved = sb.table('auto_board_posts').insert(rows).execute().data or []
    if len(saved) != len(rows):
        raise RuntimeError(f'저장 건수 불일치({len(saved)}/{len(rows)})')
    print(f'저장 완료: {len(saved)}건, 제외: {len(rejected)}건')


if __name__ == '__main__':
    main()
