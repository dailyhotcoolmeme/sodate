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
        issues.push(`❌ ${(company?.companies as { name?: string })?.name ?? companyId} 크롤링 실패`)
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
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})
