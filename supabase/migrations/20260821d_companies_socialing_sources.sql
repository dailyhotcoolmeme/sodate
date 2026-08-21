-- 소셜링 신규 소스 업체 등록 — 2026-08-21
-- 트레바리·동행클럽. 크롤러 base_scraper.get_company_id 가 slug 로 companies 를 조회하므로
-- 스크래퍼 실행 전에 이 row 들이 먼저 존재해야 한다(없으면 .single() 크래시).
-- crawl_type='api' (둘 다 무인증 REST JSON). regions 는 전국이라 비워 둔다.
-- app_visible/crawl_enabled 는 default true — 소셜링 이벤트는 event_type='socialing' 이라
-- 소개팅 피드(event_type='dating' 필터)에는 안 섞이고, 소셜링 탭이 열릴 때부터 보인다.

insert into public.companies (slug, name, base_url, crawl_url, crawl_type, description)
values
  ('trevari', '트레바리',
   'https://trevari.co.kr',
   'https://product-public-api.trevari.co.kr/api/v1/categories/outgoing/products',
   'api', '독서모임 기반 소셜 클럽 — 놀러가기(드롭인 1회 모임)'),
  ('donghaeng', '동행클럽',
   'https://donghaeng.club',
   'https://api.donghaeng.club/v2/nfyg/meetups',
   'api', '문화생활 살롱 소셜링(넷플연가 후신)')
on conflict (slug) do nothing;
