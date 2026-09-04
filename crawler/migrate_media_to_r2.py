"""Supabase Storage 에 잘못 들어간 미디어(게시판 이미지·후기 썸네일)를 R2 로 이전 + DB URL 갱신.
  .venv/bin/python migrate_media_to_r2.py
- board_posts.image_urls / reviews.thumbnail_url 의 supabase.co URL 을 R2 로 옮기고 교체.
- R2 는 이그레스 무료(전 미디어 R2 통일 원칙).
"""
import os, re, json, urllib.request
import httpx
from dotenv import load_dotenv
load_dotenv()
from utils.r2_client import upload_bytes

PROJECT = 'kmakdtcavtheaqobktlj'
PAT = open(os.path.expanduser('~/.config/sodate/supabase-pat-moit')).read().strip()
SB = 'https://kmakdtcavtheaqobktlj.supabase.co/storage/v1/object/public/'
UA = 'Mozilla/5.0'


def sql(q):
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{PROJECT}/database/query',
        data=json.dumps({'query': q}).encode(), method='POST',
        headers={'Authorization': f'Bearer {PAT}', 'Content-Type': 'application/json', 'User-Agent': UA})
    return json.loads(urllib.request.urlopen(req, timeout=60).read())


CT = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp', 'gif': 'image/gif'}


def move(url, prefix):
    """supabase 공개 URL → R2 업로드 → 새 R2 URL. 이미 R2 면 그대로."""
    if 'supabase.co' not in url:
        return url
    m = re.search(r'/public/([^/]+)/(.+)$', url)
    if not m:
        return url
    bucket, key = m.group(1), m.group(2)
    raw = httpx.get(url, timeout=30, follow_redirects=True).content
    ext = key.rsplit('.', 1)[-1].lower()
    r2key = f'{prefix}/{key}'
    return upload_bytes(r2key, raw, CT.get(ext, 'image/jpeg'))


def main():
    # 1) 게시판 이미지
    posts = sql("select id, image_urls from board_posts where array_to_string(image_urls,',') like '%supabase.co%';")
    print(f'게시판 이미지 글 {len(posts)}건')
    for p in posts:
        new = [move(u, 'board') for u in (p['image_urls'] or [])]
        arr = 'ARRAY[' + ','.join("'" + u.replace("'", "''") + "'" for u in new) + "]::text[]"
        sql(f"update board_posts set image_urls={arr} where id='{p['id']}';")
    print('  게시판 이미지 이전 완료')

    # 2) 후기 썸네일
    revs = sql("select id, thumbnail_url from reviews where thumbnail_url like '%supabase.co%';")
    print(f'후기 썸네일 {len(revs)}건')
    for r in revs:
        nu = move(r['thumbnail_url'], 'review')
        sql(f"update reviews set thumbnail_url='{nu.replace(chr(39), chr(39)*2)}' where id='{r['id']}';")
    print('  후기 썸네일 이전 완료')

    # 검증
    left1 = sql("select count(*) c from board_posts where array_to_string(image_urls,',') like '%supabase.co%';")[0]['c']
    left2 = sql("select count(*) c from reviews where thumbnail_url like '%supabase.co%';")[0]['c']
    print(f'남은 supabase URL — 게시판 {left1} · 후기 {left2} (0 이어야 함)')


if __name__ == '__main__':
    main()
