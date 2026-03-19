# MONITOR.md — 모니터링 에이전트 지시서

## 역할
배포 후 크롤링 성공률, 앱 오류, DB 이상을 지속적으로 감시합니다.
이상 감지 시 즉시 알림을 발송합니다.

---

## 모니터링 대상

| 대상 | 임계값 | 알림 채널 |
|---|---|---|
| 크롤링 성공률 | 3회 연속 실패 | GitHub Actions + 이메일 |
| 신규 이벤트 없음 | 24시간 이상 | 이메일 |
| DB 연결 오류 | 1회 | 즉시 |
| 앱 빌드 실패 | 1회 | GitHub Actions |

---

## Step 1. 크롤링 상태 모니터링

### `supabase/functions/check-crawl-health/index.ts`
```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const issues: string[] = []

  // 1. 최근 24시간 크롤링 성공률 체크
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: logs } = await supabase
    .from('crawl_logs')
    .select('company_id, status, executed_at, companies(name)')
    .gte('executed_at', since)
    .order('executed_at', { ascending: false })

  if (logs) {
    // 업체별 최근 상태 확인
    const companyLatest: Record<string, string> = {}
    for (const log of logs) {
      if (!companyLatest[log.company_id]) {
        companyLatest[log.company_id] = log.status
      }
    }

    for (const [companyId, status] of Object.entries(companyLatest)) {
      if (status === 'failed') {
        const company = logs.find(l => l.company_id === companyId)
        issues.push(`❌ ${company?.companies?.name} 크롤링 실패`)
      }
    }
  }

  // 2. 신규 이벤트 24시간 없음 체크
  const { count } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', since)

  if (count === 0) {
    issues.push('⚠️ 24시간 동안 신규 이벤트 없음')
  }

  // 3. 미래 이벤트 총 수 체크
  const { count: futureCount } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('is_closed', false)
    .gte('event_date', new Date().toISOString())

  if (futureCount === 0) {
    issues.push('🚨 앱에 표시될 미래 이벤트 0건')
  }

  return new Response(
    JSON.stringify({
      healthy: issues.length === 0,
      issues,
      checked_at: new Date().toISOString(),
      stats: { new_events_24h: count, future_events: futureCount }
    }),
    { status: 200 }
  )
})
```

---

## Step 2. GitHub Actions 헬스체크

### `.github/workflows/health-check.yml`
```yaml
name: Health Check

on:
  schedule:
    - cron: '0 */6 * * *'    # 6시간마다
  workflow_dispatch:

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - name: Check crawl health
        id: health
        run: |
          RESPONSE=$(curl -s -X POST \
            "${{ secrets.SUPABASE_URL }}/functions/v1/check-crawl-health" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}")

          echo "response=$RESPONSE" >> $GITHUB_OUTPUT
          HEALTHY=$(echo $RESPONSE | python3 -c "import sys,json; print(json.load(sys.stdin)['healthy'])")
          echo "healthy=$HEALTHY" >> $GITHUB_OUTPUT

      - name: Notify on issues
        if: steps.health.outputs.healthy == 'False'
        uses: actions/github-script@v7
        with:
          script: |
            const response = JSON.parse('${{ steps.health.outputs.response }}')
            const issues = response.issues.join('\n')
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: `🚨 헬스체크 실패 - ${new Date().toLocaleDateString('ko-KR')}`,
              body: `## 감지된 이슈\n\n${issues}\n\n**확인 시각**: ${response.checked_at}`,
              labels: ['monitoring', 'bug']
            })
```

---

## Step 3. Supabase 대시보드 쿼리

Supabase 대시보드 → SQL Editor에 저장할 모니터링 쿼리:

```sql
-- 쿼리 1: 일별 크롤링 현황
select
  date_trunc('day', executed_at) as date,
  c.name as company,
  count(*) as total_runs,
  sum(case when status = 'success' then 1 else 0 end) as successes,
  sum(case when status = 'failed' then 1 else 0 end) as failures,
  sum(events_new) as new_events
from crawl_logs cl
join companies c on cl.company_id = c.id
where executed_at >= now() - interval '7 days'
group by 1, 2
order by 1 desc, 2;

-- 쿼리 2: 앱에 표시될 이벤트 현황
select
  c.name,
  count(*) as total,
  min(e.event_date) as nearest_event
from events e
join companies c on e.company_id = c.id
where e.is_active = true
  and e.is_closed = false
  and e.event_date >= now()
group by c.name
order by c.name;

-- 쿼리 3: 푸시 알림 현황
select
  date_trunc('day', last_seen_at) as date,
  platform,
  count(*) as active_tokens
from push_tokens
where last_seen_at >= now() - interval '30 days'
group by 1, 2
order by 1 desc;

-- 쿼리 4: 크롤링 성공률 (최근 7일)
select
  c.name,
  count(*) as total,
  round(100.0 * sum(case when status = 'success' then 1 else 0 end) / count(*), 1) as success_rate,
  avg(duration_ms) as avg_duration_ms
from crawl_logs cl
join companies c on cl.company_id = c.id
where cl.executed_at >= now() - interval '7 days'
group by c.name
order by success_rate asc;
```

---

## ✅ 완료 기준 (DoD)
- [ ] `check-crawl-health` Edge Function 배포 완료
- [ ] GitHub Actions `health-check.yml` 수동 실행 성공
- [ ] 크롤링 실패 시 GitHub Issue 자동 생성 확인
- [ ] Supabase 대시보드에 4개 모니터링 쿼리 저장
- [ ] 6시간마다 자동 헬스체크 스케줄 활성화

## ⛔ 절대 금지
- 모니터링 알림을 사용자(앱 유저)에게 노출 금지
- 프로덕션 DB에 모니터링 목적의 과도한 쿼리 금지
- 헬스체크 엔드포인트를 인증 없이 외부 공개 금지
