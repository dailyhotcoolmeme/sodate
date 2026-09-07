# 운영·배포·자격증명 (2026-09-07)

> 저장소 밖에 있어서 코드만 봐서는 알 수 없는 것들을 모아 둔다.
> **비밀값 자체는 여기 안 적는다** — 어느 파일에 있는지만 적는다.

---

## 1. 자격증명이 있는 곳

전부 이미 저장돼 있다. **오너에게 다시 요청하지 말 것.**
폴더는 700, 파일은 600. **값을 화면·로그·커밋 어디에도 출력하지 않는다.**
쓸 때는 파일에서 읽어 변수로만 쓴다: `PAT=$(cat ~/.config/sodate/supabase-pat-moit)`

### `~/.config/sodate/`

| 파일 | 무엇 | 쓰는 곳 |
|---|---|---|
| `supabase-pat-moit` | 관리 PAT | DDL·마이그레이션·Edge Function 배포 |
| `supabase-anon-key-moit` | anon 키 | 앱·공개 조회 |
| `supabase-service-key-moit` | service_role 키 | 크롤러·admin·워커 (**앱에 넣지 말 것**) |
| `cf-workers-token` | Cloudflare Workers 편집 | 워커 시크릿·배포 |
| `cf-dns-token` | Cloudflare DNS 편집 | 도메인 레코드 |
| `supabase-pat-sodate-old`(+`-old2`) | 옛 프로젝트 PAT | 되돌릴 때만 |
| `README.md` | 위 내용 표 | 먼저 읽을 것 |

### `~/.config/parkinon/`

| 파일 | 무엇 |
|---|---|
| `cf-deploy-token` | Cloudflare **Pages 전용** 토큰 (워커는 못 건드린다) |

---

## 2. Supabase

**🚨 2026-09-04 프로젝트가 바뀌었다.**

| | 값 |
|---|---|
| 지금 쓰는 프로젝트 | `kmakdtcavtheaqobktlj` (이름 `moit`) |
| URL | `https://kmakdtcavtheaqobktlj.supabase.co` |
| 옛 프로젝트 | `xgcldcnqfqcugkcifyae` — **잠김·일시중지. 쓰지 마라** |

왜 옮겼나: 크롤러 버그로 무료 전송량이 소진돼 출시 앱이 멈췄다(`docs/CRAWLING.md` 3-4 참고).

### DDL·조회하는 법 (MCP 권한이 없어 관리 API를 쓴다)

```bash
PAT=$(cat ~/.config/sodate/supabase-pat-moit)
curl -s -X POST "https://api.supabase.com/v1/projects/kmakdtcavtheaqobktlj/database/query" \
  -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
  -d '{"query":"select 1"}'
```

⚠️ 프로젝트가 일시중지면 이 엔드포인트가 죽는다(Connection timeout).
상태는 `GET /v1/projects/{ref}` 의 `status` 로 본다(`ACTIVE_HEALTHY` / `INACTIVE`).

⚠️ 따옴표가 많은 SQL 은 셸에서 깨진다. **파일로 만들어 `-d @파일` 로 보낼 것.**

### 주소·키가 박혀 있는 곳 (바꿀 땐 전부 같이)

`app/.env.local` · `crawler/.env` · `admin/.dev.vars` + CF Pages 시크릿 ·
GitHub Secrets(`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ACCESS_TOKEN`) ·
`.github/workflows/{deploy-functions,apply-migration}.yml` 의 `--project-ref` ·
Cloudflare 워커 `match-subscriptions` 시크릿

---

## 3. 사이트 4개

| 사이트 | 주소 | 폴더 | CF Pages 프로젝트 |
|---|---|---|---|
| 관리자 콘솔 | sodate-admin.pages.dev | `admin/` | `sodate-admin` |
| 제휴 포털(업체용) | partner.moitbiz.com | `partner/` | `sodate-partner` |
| 소개 사이트 | moitbiz.com | `~/dev/moit-web` (**별도 저장소, 원격 없음**) | `moit-web` |
| 앱 | 스토어 | `app/` | — |

### Cloudflare Pages 배포

```bash
cd <폴더> && npm run build     # admin·partner 만
CLOUDFLARE_API_TOKEN=$(cat ~/.config/parkinon/cf-deploy-token) \
CLOUDFLARE_ACCOUNT_ID=4c0f5d706177b84ade4d424a08ec46e8 \
  npx wrangler pages deploy dist --project-name=<프로젝트> --branch=main --commit-dirty=true
```

⚠️ **`CLOUDFLARE_ACCOUNT_ID` 를 반드시 같이 준다.** 없으면 wrangler 가 `/memberships` 를
부르는데 이 토큰엔 그 권한이 없어 `Authentication error [code: 10000]` 으로 죽는다.

⚠️ moit-web 은 정적 파일이라 `npm run build` 없이 `npx wrangler pages deploy .` 로 올린다.

⚠️ **Pages 시크릿을 새로 넣으면 한 번 더 배포해야 적용된다.**

### 새 Pages 프로젝트 만들기

wrangler 로는 막힌다. REST API 로 만든다:
`POST https://api.cloudflare.com/client/v4/accounts/{account_id}/pages/projects`
커스텀 도메인도 같은 방식(`.../pages/projects/{name}/domains`) + `cf-dns-token` 으로 CNAME 생성.

---

## 4. 앱 배포(OTA)

**JS·에셋만 바뀐 변경은 그냥 OTA 로 내보낸다.** 네이티브가 바뀔 때만 스토어 빌드가 필요하다.

```bash
cd ~/dev/sodate/app
npx eas update --branch production --environment production --message "설명" --non-interactive
```

- **채널은 `production` 하나로 합쳐졌다** — 한 번 쏘면 안드·iOS 둘 다 받는다(2026-09-05 실측)
- `app.json` 의 `runtimeVersion` 은 **고정 문자열**이다. 옛 «지문 맞추기» 절차는 하지 말 것
  — 그 절차 자체가 사고 원인이었다
- 네이티브가 바뀌면(새 expo 모듈·SDK 업그레이드·권한 추가) `runtimeVersion` 을 올리고
  **스토어에 새 빌드를 제출**한다. 안 올리면 구버전 앱이 크래시한다

🚨 **변경이 안 보인다고 "예전 빌드다 / OTA가 안 왔다" 같은 전달 핑계를 절대 꺼내지 말 것**
(오너 격노 지점). **변경이 안 보이면 = 코드 수정이 틀린 것.** 코드에서 진짜 원인을 찾는다.
빌드도 함부로 하지 말 것(오너 허락 필수).

---

## 5. 미디어는 전부 R2

Supabase Storage 를 쓰지 않는다. Cloudflare R2 버킷 `sodate-media` 를 쓴다.

- 업로드: admin `POST /api/upload`(세션 인증), 삭제 `DELETE /api/upload?key=`
- 공개 서빙: `GET /media/{key}` (무인증·immutable 캐시) — admin 의 함수가 담당
- 제휴 포털도 **같은 버킷**을 쓰고 `partner/{company_id}/` 밑에 넣는다. 서빙은 admin 것을 그대로 쓴다
- 상세 이미지 키: `detail/{slug}/{typeId}/{uuid}.ext`
- ⚠️ R2 는 `CopyObject` 가 S3 와 호환되지 않는다

---

## 6. 관리자 콘솔 로그인

`admin/.dev.vars` 에 로컬 개발용 값이 있다(gitignore 됨). 운영 값은 CF Pages 시크릿에 있다.
로그인 API 는 `{"id": ..., "pw": ...}` 를 받는다(`password` 아님).

## 7. 제휴 포털

`docs/` 밖 내용은 `project_sodate_partner_portal_design` 에 있던 것을 아래로 옮긴다.

- 오너가 admin «모잇 Pick!» 화면에서 업체를 골라 초대 → 1회용 토큰 링크가 메일로 나감
  → 업체가 비밀번호를 스스로 정함. **자체 비번 재설정은 없다**(오너가 재초대)
- 목록에 없는 개별 호스트(문토·프립 안의 진행자)는 «목록에 없는 제휴처 초대하기» 로
  새 `companies` 행을 만들며 초대한다. 그 행은 `crawl_enabled=false` 라 크롤러가 안 건드린다
- 비밀번호 해시는 PBKDF2(Web Crypto). ⚠️ **Cloudflare Workers 는 반복횟수 100,000 이 상한**이다
  (넘으면 즉시 예외 → 500). 로컬에서는 재현이 안 되고 실제 배포 후에야 드러난다
- 파트너가 등록한 일정은 `is_partner_direct=true` + `verified=true` → 크롤러가 안 지운다

## 8. moitbiz.com/partner 문구

**HTML 을 직접 고치지 말 것.** 문구의 정본은 Supabase `site_content` 표(`key='partner'`)다.
`~/dev/moit-web/functions/partner.ts` 가 그 값을 읽어 서버에서 그린다.
문구는 **admin → «제휴 소개 페이지»** 에서 고친다. 저장하면 즉시 반영된다.
