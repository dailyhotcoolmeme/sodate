-- 혼술바 목록 페이로드 축소 — 2026-09-02
--
-- 혼술바 탭을 열면 500곳을 한 번에 받는데(지도 핀 계산 때문에 전수가 필요하다) 그 JSON 이
-- **1,015KB** 였다. 컬럼별로 재보니:
--
--     353KB (44%)  keyword_votes   ← 네이버 키워드 투표 원본(수십 개 항목의 표 수)
--      71KB         hours
--      55KB         instagram_media
--      ...
--
-- keyword_votes 는 상세 화면에서 쓰고, 목록 쪽에서는 **지도 미리보기 카드의 해시태그 1개**
-- 를 뽑는 데만 쓴다. 태그 하나 때문에 353KB 를 내려받고 있었다.
--
-- 그래서 그 태그를 **미리 계산해 둔다**. 규칙은 앱의 reviewHashtags() 와 같다:
--   · 혼술바라면 사실상 다 해당되는 항목(친절해요·술이 다양해요 …)은 제외 — 안 그러면
--     모든 가게가 똑같은 태그를 달아 변별력이 없다(2026-08-26 오너 지적).
--   · 표 많은 순 상위 3개, 공백 제거.
--
-- ⚠️ keyword_votes 를 갱신하는 크롤러는 현재 **없다**(naver_rating_crawl.mjs 는 평점·리뷰수만
--    쓴다). 그래서 이 값은 1회 계산으로 충분하다. 나중에 키워드를 다시 긁는 잡을 만들면
--    그쪽에서 review_tags 도 같이 갱신해야 한다.

alter table public.places add column if not exists review_tags text[] not null default '{}';

comment on column public.places.review_tags is
  '목록·지도 카드용으로 미리 뽑아둔 리뷰 해시태그(상위 3개). 원본은 keyword_votes 이며
   그건 상세 화면에서만 쓴다 — 목록에 실으면 500곳 기준 353KB 다.';

update public.places p
set review_tags = coalesce((
  select array_agg(replace(k, ' ', '') order by v desc)
  from (
    select key as k, (value)::numeric as v
    from jsonb_each_text(p.keyword_votes)
    where key not in (
      '친절해요', '매장이 청결해요', '화장실이 깨끗해요', '주차', '응대가 좋아요',
      '술이 다양해요', '혼술하기 좋아요', '대화하기 좋아요', '인테리어가 멋져요',
      '음악이 좋아요', '음식이 맛있어요'
    )
    order by (value)::numeric desc
    limit 3
  ) t
), '{}');
