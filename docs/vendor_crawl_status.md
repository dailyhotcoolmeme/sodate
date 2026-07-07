# 업체(companies) 크롤링 상태

companies 테이블 = 등록 업체의 정본(13개). 크롤 여부는 **`companies.crawl_enabled` 플래그**로 관리한다.
- **삭제하지 않는다.** 휴면 업체도 등록은 유지 → 나중에 새 업체 추가 시 slug 중복 방지.
- `crawl_enabled=false` 면 크롤러(main.py, discover_candidates.py) 둘 다 스킵.
- admin 탭은 원래부터 "이벤트 있는 업체"만 노출(`Register.tsx` companyCounts>0)이라, 이벤트 0인 업체는 어차피 안 보임.

## 현재 상태 (2026-07-07)
| 업체 | slug | crawl_enabled | 비고 |
|---|---|---|---|
| 에모셔널오렌지 | emotional-orange | ✅ true | 가격/연령/티어 자동채움(전용) |
| 문토 | munto | ✅ true | |
| 프립 | frip | ✅ true | |
| 연인어때 | yeonin | ✅ true | |
| 로꼬(Loco) | lovecommunity-loco | ✅ true | |
| 토크블라썸 | talkblossom | ✅ true | |
| 괜찮소 | yeongyul | ✅ true | |
| 러브캐스팅 | lovecasting | ✅ true | |
| 모드파티 | modparty | ✅ true | |
| 시크릿살롱 | secretsalon | ❌ false | 이벤트 0 (휴면) — 크롤 금지 |
| 인썸파티 | inssumparty | ❌ false | 이벤트 0 (휴면) — 크롤 금지 |
| 플리포 | flipo | ❌ false | 이벤트 0 (휴면) — 크롤 금지 |
| 이연시(투연시) | twoyeonsi | ❌ false | 이벤트 0 (휴면) — 크롤 금지 |

## 참고
- `scrapers/seolrem.py`(설렘한편)는 **companies에 등록도 안 됐고 main.py에도 import 안 됨 = 죽은 코드**. 업체 아님.
- 나중에 휴면 업체를 다시 돌리려면 `update companies set crawl_enabled=true where slug='...'` 만 하면 됨(코드는 이미 dict에 남아있음).

---

# 가격/연령 자동채움(enrichment) 현황

`discover_candidates.py`가 **날짜+링크만** 넣는 게 기본(refresh_company). 아래 업체는 **가격·연령까지 자동채움**하도록 전용 경로를 둠. 공통 원칙: **기존 이벤트를 source_url로 매칭해 UPDATE**(오너 날짜/지역 보존), 없으면 crawl 삽입. 가격은 항상 남>여.

| 업체 | 함수 | 방식 | 나이 | 티어 |
|---|---|---|---|---|
| 에모셔널오렌지 | `discover_emotional_orange` | imweb `load_option.cm` **2단계**(일시→성별). 날짜마다 2차 조회 | 남성만(나이코드 A~G→연령), 여=무관 | 정가+얼리버드+품절 → `price_detail` jsonb, 앱 취소선 |
| 괜찮소 | `discover_platform_enriched`(`PLATFORM_ENRICHED={'yeongyul'}`) | 기존 `YeongyulScraper`가 이미 뽑는 price/age 재활용 | 남=여 공통 범위 | 없음(단순 단일가) |
| 러브캐스팅 | `discover_lovecasting` | Elementor DOM 조각→포스트링크 상위 카드 컨테이너 직접 파싱. `#evt` 앵커 뗀 URL경로로 매칭 | **남/여 다름**(age_male/age_female 각각) | 없음 |
| 로꼬(loco) | `discover_loco` | imweb `load_option.cm` **3단계**(일시→성별→참가프로그램). 각 성별 3단계에서 **'와인파티 참석권' 기본가만**(후기특가·동반할인 무시) | 없음(가격만) | 없음. **없는 날짜는 신규 insert**(사이트=지역당 6날짜) |

**업체별 함정(다음에 안 깨지게):**
- **에모셔널오렌지**: 목록 가격(28k/38k)은 더미. 실제가는 2차 옵션. `prod_price`도 무시. 나이표는 티키타카 기준(블랙라운지/돌싱은 다르나 /date엔 티키타카만).
- **괜찮소**: source_url = canonical `yeongyul.com/ab-N-N`(#evt 없음). 스크래퍼가 price/age 이미 파싱하므로 `discover_platform_enriched`로 값만 안 버리면 됨.
- **러브캐스팅**: source_url이 DB엔 `#evt=YYYYMMDDHHMM` 앵커 붙어있으나 스크래퍼 시각(14:00)과 리스팅 표시시각(PM 5:00)이 달라 **시각 대신 URL경로(앵커 제거)로 매칭**. 가격은 `남/여` 라벨이 금액 **뒤**에 옴(`50,000원 남 35세~45세`). 남/여 나이 다름. **지역=리스팅 역명 그대로**(삼성역/선릉역). 상세페이지의 "강남구" 안 씀 — 역명만으로 충분(오너 지시). resolve_region은 이 역들에 '기타' 뱉으니 쓰지 말 것.
- **로꼬**: 3단계 옵션. source_url = `/party/?idx=N#evt=YYYYMMDD1900`(19:00 고정). 시각 불일치 회피 위해 **(idx, YYYYMMDD)로 매칭**. 지역=상품제목 대괄호(`[수원]`→수원, `[사당]`→사당). 날짜 대괄호(`[6/27 GRAND OPEN]`)는 제외. 상품 idx=1(수원)·3(사당)·4(과거).

**⚠️ 자동 반복(크론) 미연결 — 중요:** 크론(crawl.yml)은 **main.py**를 돌리고 위 enrichment는 **discover_candidates.py**(수동)에 있음. 즉 **현재 채워진 값은 1회 수동 실행 결과**이며, 가격/이벤트가 바뀌어도 자동 갱신 안 됨. main.py의 base_scraper는 price를 pop(보존), age_male/female은 EventModel에 없어 안 건드림 → **채운 값이 크론에 지워지진 않음**. 완전 자동화하려면 discover_candidates.py를 크론에 연결(+main.py와 이중쓰기 정리) 필요. 이건 앱 리빌드/광고와 함께 나갈 배치 작업.
