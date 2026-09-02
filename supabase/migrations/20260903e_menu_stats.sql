-- admin 메뉴별 대시보드 집계 — 2026-09-03
--
-- 두 갈래로 나뉜다.
--   ① 콘텐츠 현황 — events·places·board_posts 등 서버에 이미 쌓인 것. 지금 바로 채워진다.
--   ② 사용자 행동 — analytics_events. **계측을 심은 2026-09-03 부터** 쌓인다. 그 전 기록은
--      메뉴 표시가 없어서(89%가 미상) 되살릴 수 없다.
--
-- ⚠️ 집계를 앱(브라우저)에서 하면 안 된다. PostgREST 가 기본 1,000행에서 끊어서 조용히
--    틀린 숫자가 나온다 — 실제로 대시보드 기기 수가 그렇게 틀려 있었다(20260903c 참고).

create or replace function public.admin_menu_stats(p_menu text, p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  -- p_days = 0 은 '오늘'이다. 지난 24시간이 아니라 **한국시간 자정부터** 지금까지 —
  -- 오너가 보는 '오늘 하루'는 달력 하루이지 24시간 창이 아니다(2026-09-03).
  v_since timestamptz := case
    when p_days <= 0 then date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
    else now() - make_interval(days => p_days)
  end;
  v_behavior jsonb;
  v_content  jsonb;
begin
  -- ── ① 사용자 행동(계측) ──────────────────────────────────────────────────
  select jsonb_build_object(
    'menu_view_devices', count(distinct device_id) filter (where event_type = 'menu_view'),
    'menu_views',        count(*)                  filter (where event_type = 'menu_view'),
    'item_views',        count(*)                  filter (where event_type = 'item_view'),
    'outlinks',          count(*)                  filter (where event_type = 'outlink_click'),
    'searches',          count(*)                  filter (where event_type = 'search'),
    'zero_searches',     count(*)                  filter (where event_type = 'search'
                                                        and (properties->>'result_count')::int = 0),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('date', d, 'devices', dev, 'views', v) order by d), '[]'::jsonb)
      from (
        select (created_at at time zone 'Asia/Seoul')::date d,
               count(distinct device_id) dev, count(*) v
        from analytics_events
        where menu = p_menu and event_type = 'menu_view' and created_at >= v_since
        group by 1
      ) t
    ),
    -- 상세 열람 상위. 이름 사본(properties.title)으로 묶어서 내용이 지워진 뒤에도 남는다.
    'top_items', (
      select coalesce(jsonb_agg(jsonb_build_object('title', ti, 'views', c) order by c desc), '[]'::jsonb)
      from (
        select coalesce(properties->>'title', '(제목 없음)') ti, count(*) c
        from analytics_events
        where menu = p_menu and event_type = 'item_view' and created_at >= v_since
        group by 1 order by 2 desc limit 10
      ) t
    ),
    'top_searches', (
      select coalesce(jsonb_agg(jsonb_build_object('term', tm, 'count', c, 'avg_results', ar) order by c desc), '[]'::jsonb)
      from (
        select properties->>'term' tm, count(*) c,
               round(avg((properties->>'result_count')::numeric), 1) ar
        from analytics_events
        where menu = p_menu and event_type = 'search' and created_at >= v_since
          and coalesce(properties->>'term','') <> ''
        group by 1 order by 2 desc limit 10
      ) t
    ),
    -- 찾았는데 아무것도 안 나온 검색어. 어느 업체를 더 긁어올지 정하는 근거가 된다.
    'zero_result_searches', (
      select coalesce(jsonb_agg(jsonb_build_object('term', tm, 'count', c) order by c desc), '[]'::jsonb)
      from (
        select properties->>'term' tm, count(*) c
        from analytics_events
        where menu = p_menu and event_type = 'search' and created_at >= v_since
          and (properties->>'result_count')::int = 0
          and coalesce(properties->>'term','') <> ''
        group by 1 order by 2 desc limit 10
      ) t
    ),
    'top_filters', (
      select coalesce(jsonb_agg(jsonb_build_object('kind', k, 'value', val, 'count', c) order by c desc), '[]'::jsonb)
      from (
        select properties->>'kind' k, properties->>'value' val, count(*) c
        from analytics_events
        where menu = p_menu and event_type = 'filter_apply' and created_at >= v_since
        group by 1,2 order by 3 desc limit 12
      ) t
    )
  )
  into v_behavior
  from analytics_events
  where menu = p_menu and created_at >= v_since;

  -- ── ② 콘텐츠 현황(서버 테이블) ───────────────────────────────────────────
  if p_menu in ('dating', 'socialing') then
    select jsonb_build_object(
      'items',      count(*) filter (where is_active),
      'items_new',  count(*) filter (where is_active and created_at >= v_since),
      'companies',  count(distinct company_id) filter (where is_active),
      'by_region', (
        select coalesce(jsonb_agg(jsonb_build_object('name', r, 'count', c) order by c desc), '[]'::jsonb)
        from (
          select coalesce(nullif(location_region, ''), '(미상)') r, count(*) c
          from events where is_active and event_type = p_menu group by 1 order by 2 desc limit 10
        ) t
      ),
      'by_company', (
        select coalesce(jsonb_agg(jsonb_build_object('name', n, 'count', c) order by c desc), '[]'::jsonb)
        from (
          select coalesce(co.name, '(미상)') n, count(*) c
          from events e left join companies co on co.id = e.company_id
          where e.is_active and e.event_type = p_menu group by 1 order by 2 desc limit 10
        ) t
      )
    ) into v_content
    from events where event_type = p_menu;

  elsif p_menu = 'honsul' then
    select jsonb_build_object(
      'items',     count(*) filter (where is_active),
      'items_new', count(*) filter (where is_active and created_at >= v_since),
      'partners',  count(*) filter (where is_active and plan = 'partner'),
      'by_region', (
        select coalesce(jsonb_agg(jsonb_build_object('name', r, 'count', c) order by c desc), '[]'::jsonb)
        from (
          select coalesce(nullif(region, ''), '(미상)') r, count(*) c
          from places where is_active group by 1 order by 2 desc limit 10
        ) t
      ),
      'reviews', (select count(*) from place_reviews where is_active and source = 'user')
    ) into v_content
    from places;

  elsif p_menu = 'board' then
    select jsonb_build_object(
      'items',     (select count(*) from board_posts where is_active),
      'items_new', (select count(*) from board_posts where is_active and created_at >= v_since),
      'comments',  (select count(*) from board_comments where is_active),
      'views',     (select coalesce(sum(view_count), 0) from board_posts where is_active),
      'by_tag', (
        select coalesce(jsonb_agg(jsonb_build_object('name', n, 'count', c) order by c desc), '[]'::jsonb)
        from (
          select coalesce(t.label, '(말머리 없음)') n, count(*) c
          from board_posts p left join board_tags t on t.id = p.tag_id
          where p.is_active group by 1 order by 2 desc limit 10
        ) x
      ),
      -- 조회수 많은 글. 커뮤니티가 조용한 이유를 볼 때 제일 먼저 보는 표다.
      'top_posts', (
        select coalesce(jsonb_agg(jsonb_build_object('title', title, 'views', view_count,
                                                     'comments', comment_count) order by view_count desc), '[]'::jsonb)
        from (select title, view_count, comment_count from board_posts
              where is_active order by view_count desc limit 10) y
      ),
      'daily_posts', (
        select coalesce(jsonb_agg(jsonb_build_object('date', d, 'posts', p, 'comments', c) order by d), '[]'::jsonb)
        from (
          select d, sum(p) p, sum(c) c from (
            select (created_at at time zone 'Asia/Seoul')::date d, count(*) p, 0 c
            from board_posts where is_active and created_at >= v_since group by 1
            union all
            select (created_at at time zone 'Asia/Seoul')::date d, 0 p, count(*) c
            from board_comments where is_active and created_at >= v_since group by 1
          ) u group by d
        ) z
      ),
      -- 글쓰기 시작 대비 완료 = 쓰다 그만둔 비율(계측 심은 뒤부터)
      'write_start',  (select count(*) from analytics_events where event_type = 'write_start'  and created_at >= v_since),
      'write_submit', (select count(*) from analytics_events where event_type = 'write_submit' and created_at >= v_since)
    ) into v_content;
  end if;

  return jsonb_build_object('behavior', coalesce(v_behavior, '{}'::jsonb),
                            'content',  coalesce(v_content,  '{}'::jsonb));
end;
$$;

comment on function public.admin_menu_stats is
  'admin 메뉴별 대시보드. content = 서버에 쌓인 콘텐츠 현황(지금 바로 나옴),
   behavior = 계측 기록(2026-09-03 심은 뒤부터 쌓임).';

revoke all on function public.admin_menu_stats(text, int) from public, anon, authenticated;
grant execute on function public.admin_menu_stats(text, int) to service_role;
