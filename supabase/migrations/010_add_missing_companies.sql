-- 누락된 업체 추가 (이미 있으면 무시)
insert into public.companies (slug, name, base_url, crawl_url, crawl_type, regions, description)
values
  (
    'frip',
    '프립',
    'https://frip.co.kr',
    'https://gql.frip.co.kr/graphql',
    'api',
    array['강남','홍대','신촌','잠실','건대','성수','이태원','합정'],
    '액티비티 플랫폼 — 소개팅/미팅 모임 카테고리'
  ),
  (
    'munto',
    '문토',
    'https://munto.kr',
    'https://munto.kr/search?keyword=%EC%86%8C%EA%B0%9C%ED%8C%85',
    'dynamic',
    array['강남','홍대','신촌','잠실','건대','성수','수원'],
    '소셜 모임 플랫폼 — 소개팅/로테이션 미팅 카테고리'
  ),
  (
    'modparty',
    '모드파티',
    'https://www.modparty.co.kr',
    'https://www.modparty.co.kr/?shop1=list',
    'dynamic',
    array['강남','서울','홍대','신촌','수원','판교','일산','인천','대전','대구','부산'],
    'imweb 기반 소개팅 파티 — 로그인 필요'
  ),
  (
    'solo-off',
    '솔로오프',
    'https://www.solo-off.com',
    'https://www.solo-off.com/26/',
    'dynamic',
    array['강남','홍대','수원','대전','대구','부산','인천','신촌','잠실','건대'],
    '솔로오프 로테이션 소개팅'
  ),
  (
    'talkblossom',
    '토크블라썸',
    'https://talkblossom.co.kr',
    'https://talkblossom.co.kr/category/%EB%A1%9C%ED%85%8C%EC%9D%B4%EC%85%98-%EC%86%8C%EA%B0%9C%ED%8C%85/42/',
    'static',
    array['강남','홍대','수원','대전','대구','부산','인천','신촌','잠실','건대','성수'],
    'Cafe24 기반 로테이션 소개팅'
  ),
  (
    'lovecasting',
    '러브캐스팅',
    'https://lovecasting.co.kr',
    'https://lovecasting.co.kr/%EC%BB%A4%ED%94%BC%EB%AF%B8%ED%8C%85/',
    'static',
    array['강남','홍대','수원','대전','대구','부산','인천','신촌','잠실','건대','성수'],
    'WordPress 기반 커피미팅/호프미팅'
  ),
  (
    'yeongyul',
    '괜찮소',
    'http://yeongyul.com',
    'http://yeongyul.com/ab-1131',
    'dynamic',
    array['서울','강남','홍대','수원','인천','부산','대구','대전'],
    '오마이사이트 기반 소개팅'
  ),
  (
    'inssumparty',
    '인썸파티',
    'https://www.inssumparty.co.kr',
    'https://www.inssumparty.co.kr/party',
    'dynamic',
    array['대전','서울','강남','홍대','수원','부산'],
    'imweb 기반 대전 중심 소개팅 파티'
  ),
  (
    'twoyeonsi',
    '이연시',
    'https://2yeonsi.com',
    'https://2yeonsi.com/?idx=c66d7a938c66fb',
    'dynamic',
    array['기타'],
    '광주 7:7 소개팅'
  ),
  (
    'seolrem',
    '설렘한편',
    'https://seolrem1.com',
    'https://seolrem1.com/currentopening',
    'dynamic',
    array['기타'],
    '광주 소개팅 — jQuery FullCalendar 기반'
  )
on conflict (slug) do nothing;

-- 시크릿살롱, 플리포 추가
insert into public.companies (slug, name, base_url, crawl_url, crawl_type, regions, description)
values
  (
    'secretsalon',
    '시크릿살롱',
    'https://secretsalon.co.kr',
    'https://secretsalon.co.kr/shop',
    'dynamic',
    array['강남','서초'],
    '2021년부터 운영, 양재 기반 로테이션 소개팅 파티'
  ),
  (
    'flipo',
    '플리포',
    'https://flipo.co.kr',
    'https://flipo.co.kr/Fruit',
    'dynamic',
    array['수원','천안'],
    '수원/천안아산 지역 로테이션 소개팅'
  )
on conflict (slug) do nothing;
