-- 러브커뮤니티/Loco (lovecommunity.imweb.me) 업체 추가
insert into public.companies (slug, name, base_url, crawl_url, crawl_type, regions, description)
values
  (
    'lovecommunity-loco',
    '로꼬(Loco)',
    'https://lovecommunity.imweb.me',
    'https://lovecommunity.imweb.me/party',
    'dynamic',
    array['서울','수원'],
    '사당역·수원시청역 와인파티 — imweb 기반, 90~02년생 직장인 대상'
  )
on conflict (slug) do nothing;
