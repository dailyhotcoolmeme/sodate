"""소셜링 해시태그 백필(2026-08-21 1회성). 이미 투입된 소셜링 이벤트에 hashtags 채운다.
   신규 크롤은 base_scraper 가 자동으로 붙이므로 이 스크립트는 최초 1회만 쓴다."""
import os
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

from utils.supabase_client import get_supabase
from utils.hashtags import derive_socialing_hashtags

c = get_supabase()
rows = c.table('events').select('id,title,socialing_category').eq('event_type', 'socialing').execute().data
print(f"소셜링 이벤트 {len(rows)}건 백필 시작")
updated = 0
empty = 0
for r in rows:
    tags = derive_socialing_hashtags(r['title'], r.get('socialing_category'))
    if not tags:
        empty += 1
        continue
    c.table('events').update({'hashtags': tags, 'hashtags_search': ' '.join(tags)}).eq('id', r['id']).execute()
    updated += 1
print(f"완료 — 태그 부여 {updated}건, 태그 없음 {empty}건")
