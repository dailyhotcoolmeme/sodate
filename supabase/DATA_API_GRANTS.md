# Data API 자동 권한 부여 종료 대응 (2026-10-23)

공식 근거: https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically

2026-10-30부터 새 public 테이블에는 명시적 권한이 필요하다. 기존 운영 테이블의
권한은 유지된다. 서비스 키의 RLS 우회와 테이블 GRANT는 별개다.

## 반영 범위

- 저장소의 테이블 생성 21건에 같은 파일 안에서 service_role CRUD 및 RLS를 명시했다.
- 앱 공개 조회는 기존 공개 정책/열 단위 제한을 유지한다. analytics_events는
  기존 의도대로 anon INSERT만 부여한다. 서버 전용 테이블은 앱 역할에 열지 않는다.
- 과거 생성 파일의 보완은 **신규 구축용**이다. 적용된 과거 SQL을 운영에 다시
  실행하지 않는다. 현재 운영 권한은 이미 정상이라 추가 GRANT/REVOKE가 필요 없다.
- 운영 테이블/자료/기본 권한 설정은 변경하지 않았다. 새 테이블을 만들어서
  자동 부여에 의존하던 코드를 보완했으며, 기본 권한을 다시 켜는 우회책은 쓰지 않는다.

## 검사

`python3 supabase/check_data_api_grants.py`

새 public CREATE TABLE에는 같은 파일에 서버 CRUD GRANT와 ENABLE RLS가 있어야 한다.
앱의 광범위한 쓰기/ALL 권한은 거부한다. SQL 주석/문자열/함수 안의 가짜 GRANT나
다른 테이블의 GRANT로 검사를 통과할 수 없다. 이 검사는 일반 SQL 보안 감사나
전체 마이그레이션 재현 검사를 대신하지 않는다.

`python3 -m unittest discover -s supabase -p 'test_data_api_grants.py' -v`

`GRANTS_TEST_DB_URL`을 **폐기 가능한 로컬/CI 빈 PostgreSQL DB**로 지정하면 실제
Postgres 검사도 실행한다. 운영 URL은 절대 넣지 않는다. 생성문과 접근 제어문만
트랜잭션에서 실행하고 롤백한다. 업무 데이터/트리거/스케줄/외부 호출은 실행하지 않는다.

GitHub Test에 전용 Postgres 잡을 연결했고, 수동 마이그레이션 적용 전에도 검사한다.
전체 과거 마이그레이션을 운영에 재실행하거나 db reset한 것이 아니다.

## 검증 결과

- 자동 부여 없는 임시 PostgreSQL 18에서 21개 테이블 생성/권한 검사 통과.
- 회귀 검사 10개 통과(실제 PostgreSQL 검사 포함).
- 대응 전 운영 33개 테이블 RLS/서버 CRUD 확인. 앱 8개·서버 4개 Data API
  읽기 전용 접근은 모두 HTTP 200이었다. 추가 확인에서도 같은 경로를 재검증한다.

## 관리자 통계 뷰 보안 조치 (2026-10-23)

- `company_admin_stats`가 소유자 권한으로 동작하고 anon/authenticated에도
  권한이 남아 있어 보안 진단에 잡혔다. admin은 이미 세션 검증 프록시에서
  서버 키로 조회하므로 앱 역할에 이 뷰를 노출할 필요가 없다.
- 새 마이그레이션 `20261023022526_lock_down_company_admin_stats.sql`을 운영
  관리 API로 적용했다. 호출자 권한(`security_invoker=true`)으로 전환하고,
  PUBLIC/anon/authenticated 권한을 회수하고 service_role SELECT를 명시했다.
  원래 생성 파일에도 같은 보호를 넣어 신규 구축 시 재발하지 않게 했다.
- 적용 트랜잭션의 동일 스냅샷에서 전후 집계 JSON이 같은지 검사했다.
  불일치 또는 권한 오류면 롤백하도록 했다. 원본 테이블/정책/자료 변경은 없다.
- 운영 anon 조회는 401/42501, 서버 조회는 200/20행. 실제 admin 로그인 200,
  인증된 프록시 통계 조회 200/20행, 미인증 프록시 조회 401 확인.
- 보안 진단에서 `security_definer_view` 0건. 다른 함수/검색 경로 관련 기존
  경고는 이 뷰 조치와 별개이며 변경하지 않았다.
- 임시 PostgreSQL에서 공개 두 역할의 실제 SELECT 실패와 서버 집계 보존을
  확인하는 검사를 추가했다. 관련 검사 총 12개 통과.
