# SEC.md — 보안 에이전트 지시서

## 역할
전체 프로젝트의 보안 취약점을 탐지하고 수정합니다.
API 키 노출, RLS 우회, 인젝션, 크롤러 보안을 담당합니다.

---

## 보안 체크리스트

### 1. API 키 / 환경변수 보안

```bash
# 코드베이스 전체에서 API 키 패턴 검색
grep -r "SUPABASE_SERVICE_ROLE_KEY\s*=" --include="*.ts" --include="*.tsx" --include="*.py" .
grep -r "eyJ" --include="*.ts" --include="*.tsx" --include="*.py" . # JWT 패턴
grep -r "sk-" --include="*.ts" --include="*.tsx" --include="*.py" . # API 키 패턴

# .env 파일이 git에 추적되지 않는지 확인
git ls-files | grep ".env"  # 결과가 없어야 함

# .gitignore에 .env 포함 여부
grep "\.env" .gitignore  # 반드시 존재해야 함
```

**자동화 스크립트: `.github/workflows/security.yml`**
```yaml
name: Security Scan

on: [push, pull_request]

jobs:
  secret-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Scan for secrets
        uses: trufflesecurity/trufflehog@main
        with:
          path: ./
          base: main
          head: HEAD
          extra_args: --only-verified
```

---

### 2. Supabase RLS 보안 검증

```sql
-- SEC-001: anon 역할로 push_tokens 접근 불가 검증
set role anon;
select count(*) from push_tokens;
-- 기대값: 0 (RLS 차단) 또는 에러

-- SEC-002: anon 역할로 alert_subscriptions 접근 불가
set role anon;
select count(*) from alert_subscriptions;
-- 기대값: 0 또는 에러

-- SEC-003: anon이 is_active=false 이벤트 조회 불가
set role anon;
select count(*) from events where is_active = false;
-- 기대값: 0

-- SEC-004: anon이 events INSERT 불가
set role anon;
insert into events (company_id, title, event_date, location_region, source_url)
values (gen_random_uuid(), 'hack', now(), '강남', 'https://hack.com');
-- 기대값: 에러 (permission denied)

-- SEC-005: anon이 companies 수정 불가
set role anon;
update companies set name = 'hacked' where id = (select id from companies limit 1);
-- 기대값: 에러 (permission denied)
```

---

### 3. 크롤러 보안

```python
# crawler/utils/security.py

import re
from urllib.parse import urlparse

ALLOWED_DOMAINS = [
    'lovematching.kr',
    'yeonin.co.kr',
    'emotional0ranges.com',
    'frip.co.kr',
    'munto.kr',
    'somoim.co.kr',
]

def is_allowed_url(url: str) -> bool:
    """허용된 도메인만 크롤링"""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.replace('www.', '')
        return any(domain.endswith(allowed) for allowed in ALLOWED_DOMAINS)
    except Exception:
        return False

def sanitize_text(text: str) -> str:
    """텍스트 XSS 방지용 정제"""
    # HTML 태그 제거
    clean = re.sub(r'<[^>]+>', '', text)
    # 제어 문자 제거
    clean = re.sub(r'[\x00-\x1f\x7f]', '', clean)
    return clean.strip()

def is_valid_image_url(url: str) -> bool:
    """이미지 URL 유효성 검사"""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ('http', 'https'):
            return False
        ext = parsed.path.lower().split('.')[-1]
        return ext in ('jpg', 'jpeg', 'png', 'webp', 'gif')
    except Exception:
        return False

# 모든 스크래퍼에서 사용:
# from utils.security import is_allowed_url, sanitize_text, is_valid_image_url
```

---

### 4. 앱 보안

```typescript
// app/lib/security.ts

// 아웃링크 URL 검증 - 허용된 도메인만
const ALLOWED_OUTLINK_DOMAINS = [
  'lovematching.kr',
  'yeonin.co.kr',
  'emotional0ranges.com',
  'frip.co.kr',
  'munto.kr',
  'somoim.co.kr',
]

export function isAllowedOutlink(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return false
    const domain = parsed.hostname.replace('www.', '')
    return ALLOWED_OUTLINK_DOMAINS.some(d => domain.endsWith(d))
  } catch {
    return false
  }
}

// outlink.ts에서 반드시 사용:
// if (!isAllowedOutlink(url)) throw new Error('허용되지 않은 URL')
```

---

### 5. Edge Function 보안

```typescript
// 모든 Edge Function에 적용할 공통 보안 헤더
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'",
}

// 요청 유효성 검사 예시
function validateRequest(req: Request): boolean {
  // Content-Type 검사
  const contentType = req.headers.get('content-type')
  if (!contentType?.includes('application/json')) return false

  // 과도한 요청 방지 (기본 Supabase rate limit 활용)
  return true
}
```

---

### 6. 의존성 취약점 스캔

```yaml
# .github/workflows/security.yml 에 추가

  dependency-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Python 의존성 스캔
      - name: Python safety check
        run: |
          pip install safety
          cd crawler && safety check -r requirements.txt

      # Node 의존성 스캔
      - name: Node audit
        run: cd app && npm audit --audit-level=high
```

---

## 보안 체크리스트 최종 검증

```
코드 레벨:
[ ] SUPABASE_SERVICE_ROLE_KEY 코드에 없음
[ ] SUPABASE_ANON_KEY만 앱 클라이언트에 사용
[ ] .env 파일 .gitignore에 포함
[ ] 아웃링크 URL 허용 도메인 검증 구현
[ ] 크롤링 대상 도메인 화이트리스트 적용
[ ] 이미지 URL 유효성 검사 구현

DB 레벨:
[ ] 모든 테이블 RLS 활성화
[ ] anon이 push_tokens/alert_subscriptions 접근 불가
[ ] anon이 events INSERT/UPDATE/DELETE 불가
[ ] events.is_active=false RLS로 숨김

인프라 레벨:
[ ] GitHub Secrets에 민감 정보 등록
[ ] TruffleHog 시크릿 스캔 CI 통과
[ ] Python safety check 통과
[ ] npm audit high severity 0건

크롤러 레벨:
[ ] 허용 도메인 화이트리스트 적용
[ ] 요청 간 딜레이 구현 (최소 1초)
[ ] 개인정보 필드 저장 안함 (이름, 연락처, 이메일)
[ ] robots.txt 준수
```

## ⛔ 절대 금지
- RLS 비활성화 상태 배포 금지
- anon_key와 service_role_key 혼용 금지
- 사용자 입력값 직접 SQL 사용 금지 (Supabase 클라이언트는 자동 방지)
- 개인정보(이름/전화번호/이메일) 수집/저장 절대 금지
