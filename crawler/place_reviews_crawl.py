"""혼술바 후기 크롤(블로그·유튜브) → place_reviews. 소개팅 방식(링크카드, 원문 복사 X).

  .venv/bin/python place_reviews_crawl.py [limit]

- 대상: service=honsul (재개: 이미 후기 있는 place 는 건너뜀).
- 키워드=매장명. 결과 중 매장 핵심명이 실제로 언급된 것만 저장(일반명 오매칭 방지).
- 블로그(naver_blog)/유튜브(youtube) 각각 소스별. 인스타는 IP차단 이슈로 제외.
"""
import os, re, sys, json, time, urllib.request
from scrapers.review_naver import fetch_naver_blog_results
from scrapers.review_youtube import fetch_youtube_results

PROJECT = 'xgcldcnqfqcugkcifyae'
PAT = open(os.path.expanduser('~/.config/sodate/supabase-pat')).read().strip()
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'
GENERIC = re.compile(r'(서울|부산|대구|인천|광주|대전|울산|경기|제주|혼술바|혼술|바|BAR|bar|점|본점|직영점)')


def run_sql(sql):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{PROJECT}/database/query',
        data=json.dumps({'query': sql}).encode(), method='POST',
        headers={'Authorization': f'Bearer {PAT}', 'Content-Type': 'application/json', 'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def core_tokens(name):
    """매장 고유명 토큰(일반어·지역·지점 제거). 매칭에 하나라도 포함되면 관련."""
    n = re.sub(r'[^\w가-힣]', ' ', GENERIC.sub(' ', name))
    return [t for t in n.split() if len(t) >= 2]


def relates(text, tokens):
    t = (text or '')
    return any(tok in t for tok in tokens)


def clean_content(text):
    """블로그 제목 스크랩 노이즈 제거(새 창 열림·blog.naver.com›id 등)."""
    t = text or ''
    t = re.sub(r'새 창 열림', ' ', t)
    t = re.sub(r'blog\.naver\.com[›/][^\s.]+', ' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t


def q(v):
    if v is None:
        return 'null'
    return "'" + str(v).replace("'", "''") + "'"


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 10**9
    # 각 place 의 blog/youtube 보유 여부까지 함께(이미 있는 소스는 재수집 안 함 → 중복 방지)
    places = run_sql("select p.id, p.name, "
                     "exists(select 1 from place_reviews r where r.place_id=p.id and r.source='naver_blog') as has_blog, "
                     "exists(select 1 from place_reviews r where r.place_id=p.id and r.source='youtube') as has_yt "
                     "from places p where p.service='honsul' "
                     "and not (exists(select 1 from place_reviews r where r.place_id=p.id and r.source='naver_blog') "
                     "         and exists(select 1 from place_reviews r where r.place_id=p.id and r.source='youtube')) "
                     "order by p.naver_review_count desc nulls last limit %d;" % limit)
    print(f'대상 {len(places)}곳')
    total = 0
    for i, p in enumerate(places, 1):
        toks = core_tokens(p['name'])
        if not toks:
            toks = [p['name']]
        rows = []
        try:
            blog = [] if p.get('has_blog') else fetch_naver_blog_results(p['name'])
        except Exception:
            blog = []
        if p.get('has_yt'):
            yt = []
        else:
            try:
                yt = fetch_youtube_results(p['name'], toks, topics=[])  # 상호 토큰만으로 채택(혼술 도메인)
            except Exception:
                yt = []
        seen = set()
        for r in (blog + yt):
            u = r.get('source_url')
            if not u or u in seen:
                continue
            if not relates(r.get('content'), toks):   # 매장 언급 없으면 제외
                continue
            seen.add(u)
            rows.append(r)
        rows = rows[:8]
        if rows:
            vals = ','.join(
                "(%s,%s,%s,%s,%s,%s,true)" % (
                    q(p['id']), q(r['source']), q(clean_content(r.get('content'))), q(r.get('source_url')),
                    q(r.get('thumbnail_url')), q(r.get('published_at')))
                for r in rows)
            run_sql("insert into place_reviews (place_id, source, content, source_url, thumbnail_url, published_at, is_active) "
                    "values %s on conflict do nothing;" % vals)
            total += len(rows)
        if i % 10 == 0:
            print(f'  … {i}/{len(places)} · 누적 후기 {total}')
        time.sleep(1.2)
    print(f'완료 · {len(places)}곳 · 후기 {total}건')


if __name__ == '__main__':
    main()
