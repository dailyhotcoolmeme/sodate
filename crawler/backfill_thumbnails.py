"""기존 events 의 썸네일을 작게 다시 구워 R2 로 옮긴다(1회성 백필 + 재실행 안전).

새 크롤부터는 base_scraper 가 알아서 최적화하지만, 이미 DB 에 들어있는 일정들은
원본 CDN URL 을 그대로 갖고 있어 피드가 계속 무겁다. 이 스크립트로 한 번 훑는다.

재실행해도 안전하다 — 이미 최적화된 URL(우리 R2·변환된 cloudinary)은 건너뛰고,
R2 에 이미 구워둔 게 있으면 내려받지 않는다.

    python backfill_thumbnails.py            # 앞으로 한 달치 활성 일정(피드에 보이는 것)
    python backfill_thumbnails.py --all      # 전부
    python backfill_thumbnails.py --dry-run  # 바꿀 것만 세어보고 끝
"""
import argparse
import sys
from datetime import datetime, timedelta, timezone

from utils.logger import get_logger
from utils.supabase_client import get_supabase
from utils.thumbnail import optimize_thumbnails

logger = get_logger('backfill-thumbs')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--all', action='store_true', help='지난 일정까지 전부')
    ap.add_argument('--dry-run', action='store_true', help='바꾸지 않고 세어보기만')
    args = ap.parse_args()

    sb = get_supabase()
    q = sb.table('events').select('id,thumbnail_urls,event_date').eq('is_active', True)
    if not args.all:
        now = datetime.now(timezone.utc)
        q = q.gte('event_date', now.isoformat()).lte('event_date', (now + timedelta(days=32)).isoformat())

    rows, page, PAGE = [], 0, 1000
    while True:
        # PostgREST 는 한 번에 1000행이 상한이라 페이지로 나눠 받는다.
        chunk = q.range(page * PAGE, page * PAGE + PAGE - 1).execute().data or []
        rows += chunk
        if len(chunk) < PAGE:
            break
        page += 1

    targets = [r for r in rows if r.get('thumbnail_urls')]
    logger.info(f'대상 {len(targets)}건 (전체 {len(rows)}건 중 썸네일 있는 것)')

    changed = failed = 0
    for i, r in enumerate(targets, 1):
        before = r['thumbnail_urls']
        try:
            after = optimize_thumbnails(before)
        except Exception as e:
            logger.warning(f"{r['id']} 최적화 중 예외(건너뜀): {e}")
            failed += 1
            continue
        if after == before:
            continue
        changed += 1
        if args.dry_run:
            continue
        try:
            sb.table('events').update({'thumbnail_urls': after}).eq('id', r['id']).execute()
        except Exception as e:
            logger.warning(f"{r['id']} 저장 실패: {e}")
            failed += 1
        if i % 50 == 0:
            logger.info(f'  진행 {i}/{len(targets)} · 교체 {changed} · 실패 {failed}')

    logger.info(f"{'[dry-run] ' if args.dry_run else ''}완료 — 교체 {changed}건 · 실패 {failed}건 · 대상 {len(targets)}건")
    return 0


if __name__ == '__main__':
    sys.exit(main())
