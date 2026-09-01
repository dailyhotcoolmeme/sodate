"""혼술바 후기 크롤(블로그·유튜브) → place_reviews. 소개팅 방식(링크카드, 원문 복사 X).

  .venv/bin/python place_reviews_crawl.py [limit]

- 대상: service=honsul (재개: 이미 후기 있는 place 는 건너뜀).
- 키워드=매장명. 결과 중 매장 핵심명이 실제로 언급된 것만 저장(일반명 오매칭 방지).
- 블로그(naver_blog)/유튜브(youtube) 각각 소스별. 인스타는 IP차단 이슈로 제외.

⚠️ 예전엔 Supabase Management API(개인 PAT, ~/.config/sodate/supabase-pat)로 SQL 을
   직접 날렸다. 그 PAT 가 개발자 노트북에만 있어서 이 스크립트는 어떤 워크플로우에도
   등록할 수 없었고, 결국 수동 실행만 되다가 방치됐다(2026-09-01 점검에서 발견 —
   혼술바 데이터가 9일째 그대로였다). 지금은 크롤러 공용 자격증명
   (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)만으로 PostgREST 를 쓴다. GitHub Actions
   시크릿에 이미 있는 값이라 스케줄 등록에 새 비밀이 필요 없다.
"""
import os, re, sys, json, time, urllib.request, urllib.parse
from dotenv import load_dotenv
from scrapers.review_naver import fetch_naver_blog_results
from scrapers.review_youtube import fetch_youtube_results

load_dotenv()
SB_URL = (os.environ.get('SUPABASE_URL') or '').rstrip('/')
SB_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or ''
if not SB_URL or not SB_KEY:
    raise SystemExit('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다(.env 또는 환경변수).')
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36'
# 업종·일반어만 substring 제거(지역어는 여기서 빼지 않음 — 브랜드 조각남 방지, 지역은 is_area 로 처리)
GENERIC = re.compile(r'(혼술집|혼술바|혼술|이자카야|포차|BAR|bar|직영점|본점)')
# 유튜브는 흔한 상호가 음악·뉴스 영상에 걸리므로 술 관련어도 제목에 있어야 채택.
DRINK = ['혼술', '술집', '술', '바', '칵테일', '하이볼', '위스키', '이자카야', '포차', '펍', '와인', '사케', '안주', '한잔']
# 브랜드로 삼기엔 너무 흔한 단어 — 이게 유일한 고유토큰이면 후기 매칭 제외(오매칭 방지).
BRAND_STOP = {'혼밥', '이유', '대세', '낙원', '분위기', '감성', '오늘', '하루', '한잔', '우리', '그집',
              '내집', '술한잔', '단골', '주막', '아지트', '쉼표', '휴식', '동네', '골목', '만남'}


def _rest(path, method='GET', body=None, extra_headers=None):
    """PostgREST 호출(재시도 포함). path 는 '/rest/v1/...' 부터."""
    last = None
    headers = {'apikey': SB_KEY, 'Authorization': f'Bearer {SB_KEY}',
               'Content-Type': 'application/json', 'User-Agent': UA}
    headers.update(extra_headers or {})
    data = json.dumps(body).encode() if body is not None else None
    for attempt in range(4):
        req = urllib.request.Request(SB_URL + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read().decode()
                return json.loads(raw) if raw.strip() else []
        except urllib.error.HTTPError as e:
            if e.code in (500, 502, 503, 504, 544, 429):   # 일시 오류 → 재시도
                last = e; time.sleep(3 * (attempt + 1)); continue
            raise RuntimeError(f'{e.code} {e.read().decode()[:200]}') from e
        except Exception as e:
            last = e; time.sleep(3 * (attempt + 1)); continue
    raise last


def fetch_all(path_with_query, page=1000):
    """PostgREST 기본 상한(1000행)에 잘리지 않게 끝까지 가져온다."""
    out = []
    for start in range(0, 100000, page):
        rows = _rest(f'{path_with_query}&offset={start}&limit={page}')
        out += rows
        if len(rows) < page:
            break
    return out


def core_tokens(name):
    """매장명에서 일반어 뺀 토큰."""
    n = re.sub(r'[^\w가-힣]', ' ', GENERIC.sub(' ', name))
    return [t for t in n.split() if len(t) >= 2]


# 상호에 흔히 붙는 지역·역·상권명(브랜드 아님) — 매칭에서 제외해 오매칭 방지.
AREA_WORDS = {
    '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남',
    '전북', '전남', '경북', '경남', '제주', '수원', '성남', '용인', '고양', '일산', '분당', '판교',
    '청라', '송도', '부천', '안양', '평택', '천안', '청주', '전주', '창원', '김해', '포항', '구미',
    '강남', '홍대', '건대', '성수', '이태원', '을지로', '종로', '신촌', '잠실', '연남', '망원', '합정',
    '상수', '대학로', '혜화', '신당', '문래', '영등포', '구로', '가산', '수유', '노원', '왕십리',
    '선릉', '역삼', '삼성', '교대', '사당', '신림', '노량진', '여의도', '충무로', '동대문', '명동',
    '서면', '해운대', '광안리', '전포', '남포', '동성로', '유성', '둔산', '봉명', '두정', '불당',
    '용리단길', '경리단길', '샤로수길', '송리단길', '연트럴파크', '카페거리', '로데오', '지웰시티',
    '역', '점', '본점', '직영점', '해방촌', '연동', '노형', '중동', '상동',
}


def build_distinctive(names, regions):
    """상호에서 지역·상권명을 뺀 '브랜드 고유토큰'만. (히토리노미야·제주아홉·미열)"""
    regset = set(AREA_WORDS)
    for r in regions:
        if not r:
            continue
        regset.add(r)
        regset.add(re.sub(r'[동가리]\d*가?$', '', r))   # 청라동→청라, 성수동→성수
        regset.add(re.sub(r'\d*가$', '', r))            # 을지로3가→을지로

    # 브랜치 랜드마크 접미사(지역목록에 없어도 지점 표시) — 브랜드 아님
    LM = re.compile(r'(점|동|역|구청|시장|사거리|오거리|터미널|대학교|캠퍼스|타워|공원|스퀘어|플라자)$')

    def is_area(t):
        tc = LM.sub('', t)                    # 청라점→청라, 영등포구청점→영등포
        return t in regset or tc in regset    # 정확/접미제거 일치만(브랜드 substring 오제거 방지)

    def distinctive(name):
        # 브랜드 = 맨 앞의 '지역·지점·흔한단어 아닌' 토큰 하나만 요구(오매칭 방지 핵심).
        for t in core_tokens(name):
            if len(t) < 2 or is_area(t) or t in BRAND_STOP:
                continue
            return [t]
        return []
    return distinctive


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


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 10**9
    # PostgREST 에는 EXISTS 서브쿼리가 없다. 매장(500곳)과 후기의 (place_id, source)만
    # 통째로 받아 파이썬에서 맞춘다 — 둘 다 작아서 SQL 한 방보다 느릴 일이 없다.
    meta = fetch_all('/rest/v1/places?service=eq.honsul&select=id,name,region,naver_review_count&order=id')
    have = fetch_all('/rest/v1/place_reviews?select=place_id,source&order=place_id')
    blog_ids = {r['place_id'] for r in have if r['source'] == 'naver_blog'}
    yt_ids = {r['place_id'] for r in have if r['source'] == 'youtube'}

    places = [
        {'id': m['id'], 'name': m['name'],
         'has_blog': m['id'] in blog_ids, 'has_yt': m['id'] in yt_ids}
        for m in meta
        if not (m['id'] in blog_ids and m['id'] in yt_ids)   # 둘 다 있으면 건너뜀
    ]
    # 리뷰 많은 매장부터(= 이용자가 많이 보는 곳부터). None 은 뒤로.
    order = {m['id']: (m.get('naver_review_count') or -1) for m in meta}
    places.sort(key=lambda p: order.get(p['id'], -1), reverse=True)
    places = places[:limit]
    print(f'대상 {len(places)}곳')
    # 전 매장명+지역으로 브랜드 고유토큰 판별기 구성(지역명 오매칭 방지)
    distinctive = build_distinctive([m['name'] for m in meta], [m.get('region') for m in meta])
    total = 0
    for i, p in enumerate(places, 1):
        toks = distinctive(p['name'])
        if not toks:                # 고유 브랜드 토큰 없으면(순수 지역·일반명) 후기 매칭 불가 → 건너뜀
            continue
        rows = []
        try:
            blog = [] if p.get('has_blog') else fetch_naver_blog_results(p['name'])
        except Exception:
            blog = []
        if p.get('has_yt'):
            yt = []
        else:
            try:
                yt = fetch_youtube_results(p['name'], toks, topics=DRINK)  # 브랜드 + 술관련어 둘 다
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
            payload = [{
                'place_id': p['id'],
                'source': r['source'],
                'content': clean_content(r.get('content')),
                'source_url': r.get('source_url'),
                'thumbnail_url': r.get('thumbnail_url'),
                'published_at': r.get('published_at'),
                'is_active': True,
            } for r in rows]
            # 같은 원문 URL 이 두 번 들어가지 않게 — 옛 SQL 의 on conflict do nothing 자리.
            # ⚠️ PostgREST 는 on_conflict 를 URL 로 안 주면 Prefer 의 ignore-duplicates 를
            #    무시하고 409(중복키)를 던진다. place_reviews 는 source_url 이 유니크다.
            _rest('/rest/v1/place_reviews?on_conflict=source_url', 'POST', payload,
                  {'Prefer': 'resolution=ignore-duplicates,return=minimal'})
            total += len(rows)
        if i % 10 == 0:
            print(f'  … {i}/{len(places)} · 누적 후기 {total}')
        time.sleep(1.2)
    print(f'완료 · {len(places)}곳 · 후기 {total}건')


if __name__ == '__main__':
    main()
