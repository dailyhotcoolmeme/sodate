-- 소개팅 업체 테이블
create table public.companies (
  id            uuid default gen_random_uuid() primary key,
  slug          text unique not null,
  name          text not null,
  logo_url      text,
  base_url      text not null,
  crawl_url     text not null,
  crawl_type    text not null check (crawl_type in ('static', 'dynamic', 'api')),
  regions       text[] default '{}',
  description   text,
  instagram_url text,
  is_active     boolean default true not null,
  created_at    timestamptz default now() not null,
  updated_at    timestamptz default now() not null
);

create index companies_slug_idx on public.companies(slug);
create index companies_is_active_idx on public.companies(is_active);

-- 업데이트 시 updated_at 자동 갱신 트리거
create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger companies_updated_at
  before update on public.companies
  for each row execute function public.update_updated_at();

-- 초기 업체 데이터 삽입
insert into public.companies (slug, name, base_url, crawl_url, crawl_type, regions, description) values
('lovematching', '러브매칭', 'https://lovematching.kr', 'https://lovematching.kr/schedule', 'static', array['강남','역삼','홍대','신촌','을지로'], '2022년부터 운영, JTBC/CBS 출연 이력'),
('yeonin', '연인어때', 'https://yeonin.co.kr', 'https://yeonin.co.kr/schedule', 'static', array['강남','수원','대전','천안'], '서류/사진 검증 시스템 운영'),
('emotional-orange', '에모셔널오렌지', 'https://emotional0ranges.com', 'https://emotional0ranges.com/shop', 'static', array['강남','수원','한남'], '최대 12명 소개팅');
