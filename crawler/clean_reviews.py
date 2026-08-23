"""기존 place_reviews(블로그·유튜브) 중 브랜드 고유토큰이 제목에 없는 오매칭을 삭제.
지역명(청라·선릉)만으로 걸린 다른 가게 후기를 걷어낸다.
  .venv/bin/python clean_reviews.py
"""
from place_reviews_crawl import build_distinctive, run_sql, DRINK

meta = run_sql("select id, name, region from places where service='honsul';")
byid = {m['id']: m for m in meta}
distinctive = build_distinctive([m['name'] for m in meta], [m['region'] for m in meta])

reviews = run_sql("select id, place_id, source, content from place_reviews where source in ('naver_blog','youtube');")
bad = []
for r in reviews:
    p = byid.get(r['place_id'])
    if not p:
        continue
    toks = distinctive(p['name'])
    content = r['content'] or ''
    brand_ok = toks and any(t in content for t in toks)
    # 유튜브는 브랜드 + 술 관련어 둘 다 있어야 유지(음악·뉴스 오매칭 제거)
    ok = brand_ok and (r['source'] != 'youtube' or any(d in content for d in DRINK))
    if not ok:
        bad.append(r['id'])

print(f'전체 후기 {len(reviews)} · 오매칭 삭제대상 {len(bad)}')
B = 200
for i in range(0, len(bad), B):
    ids = ",".join("'%s'" % x for x in bad[i:i + B])
    run_sql(f"delete from place_reviews where id in ({ids});")
    print(f'  삭제 {min(i+B, len(bad))}/{len(bad)}')

left = run_sql("select source, count(*) c, count(distinct place_id) pl from place_reviews group by source;")
print('남은 후기:', left)
