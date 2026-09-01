// 게시판 신고가 들어오면 운영자 이메일로 알린다.
//
// 왜 필요한가:
//   애플 1.2(UGC) 요건 — 신고 접수 후 24시간 내 조치를 하려면, 관리자가 매번 관리자
//   화면을 들여다보지 않아도 신고가 들어온 걸 즉시 알아야 한다.
//
// 어떻게 불리나:
//   board_reports 의 INSERT 트리거가 pg_net 으로 이 함수를 호출한다(서버측 — 앱을 거치지
//   않음). 앱에서 호출하면 앱이 죽거나 네트워크가 끊긴 경우 알림이 통째로 누락된다.
//   (parkinon-app의 notify-admin-content 와 같은 구조 — 2026-08 오너 지시로 이식)
//
// 발송 수단:
//   구글 워크스페이스 계정 SMTP(앱 비밀번호). nodemailer 사용 — denomailer는 한글 제목을
//   RFC 2047 인코딩할 때 75자 제한을 넘겨 Gmail이 디코딩 못 하는 문제가 parkinon에서
//   실측됐다.
//
// 트리거는 board_reports 에 붙인 pg_net 트리거(trg_board_report_notify)다. 대시보드
// Database Webhooks 대신 직접 만든 이유: CLI 로만 접근 가능한 환경이라 대시보드를 거치지
// 않고 끝내야 했다(2026-08-03). 시크릿은 migration 파일에 평문으로 넣지 않고 Postgres
// Vault(vault.decrypted_secrets, name='board_report_hook_secret')에서 읽어 트리거가
// x-webhook-secret 헤더로 보낸다 — match-subscriptions 의 WEBHOOK_SECRET 과는 별개 값을
// 새로 만들었다(그 값은 write-only라 재사용하려 해도 값을 알 수 없었다).
//
// 필요한 시크릿:
//   BOARD_REPORT_SECRET  이 웹훅 전용(새로 생성) — 트리거가 보내는 x-webhook-secret 검증
//   GMAIL_USER            보내는 계정 (admin@ourmine.co.kr)
//   GMAIL_APP_PASSWORD    구글 앱 비밀번호 16자리(공백 없이)
//   ADMIN_NOTIFY_TO        받는 주소 (미설정 시 GMAIL_USER 로 보냄, 선택)
import nodemailer from 'npm:nodemailer@6.9.14'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const GMAIL_USER = Deno.env.get('GMAIL_USER') ?? ''
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD') ?? ''
const NOTIFY_TO = Deno.env.get('ADMIN_NOTIFY_TO') || GMAIL_USER
const NOTIFY_SECRET = Deno.env.get('BOARD_REPORT_SECRET') ?? ''

const ADMIN_URL = 'https://sodate-admin.pages.dev'

const TARGET_LABEL: Record<string, string> = {
  post: '게시글',
  comment: '댓글',
  content: '첨부(사진·링크)',
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function sendMail(subject: string, html: string, text: string): Promise<void> {
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  })
  await transport.sendMail({
    from: `"모잇 신고 알림" <${GMAIL_USER}>`,
    to: NOTIFY_TO,
    subject,
    text,
    html,
  })
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
      console.error('[notify-admin-report] GMAIL_USER / GMAIL_APP_PASSWORD 미설정')
      return new Response(JSON.stringify({ error: 'mail not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // pg_net 트리거(trg_board_report_notify)가 x-webhook-secret 헤더로 시크릿을 보낸다.
    if (NOTIFY_SECRET && req.headers.get('x-webhook-secret') !== NOTIFY_SECRET) {
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json().catch(() => ({}))
    // Database Webhook 고정 페이로드: { type, table, record, schema, old_record }
    const reportId: string = body.record?.id ?? body.reportId
    if (!reportId) {
      return new Response(JSON.stringify({ error: 'reportId가 필요합니다' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: report } = await supabase
      .from('board_reports')
      .select('id,target_type,target_id,reason,created_at')
      .eq('id', reportId)
      .single()
    if (!report) {
      return new Response(JSON.stringify({ skipped: 'report not found' }), { status: 200, headers: corsHeaders })
    }

    const typeLabel = TARGET_LABEL[report.target_type] ?? report.target_type
    let title = ''
    let author = ''
    let contentPreview = ''
    let reportCount = 0

    if (report.target_type === 'post' || report.target_type === 'content') {
      const { data: post } = await supabase
        .from('board_posts')
        .select('nickname,title,content,report_count,content_report_count')
        .eq('id', report.target_id)
        .maybeSingle()
      if (post) {
        title = post.title
        author = post.nickname
        contentPreview = post.content
        reportCount = report.target_type === 'content' ? post.content_report_count : post.report_count
      }
    } else {
      const { data: comment } = await supabase
        .from('board_comments')
        .select('nickname,content,is_secret,secret_content,report_count,post_id,board_posts(title)')
        .eq('id', report.target_id)
        .maybeSingle()
      if (comment) {
        title = (comment.board_posts as { title?: string } | null)?.title ?? '(원글 없음)'
        author = comment.nickname
        // 비밀 댓글은 content 가 빈 문자열이라 그대로 쓰면 신고 메일의 '신고 대상 내용'이
        // 빈 칸으로 나갔다. 신고된 건은 판단 근거가 있어야 24시간 내 조치가 가능하므로
        // 본문을 실어 보낸다(2026-08-13 감사). 열람 사실은 개인정보처리방침에 고지돼 있다.
        contentPreview = comment.is_secret
          ? `[비밀 댓글] ${comment.secret_content ?? '(내용 없음)'}`
          : comment.content
        reportCount = comment.report_count
      }
    }

    const subject = `[모잇] ${typeLabel} 신고 · ${title || '(내용 없음)'}`
    const text = `${typeLabel} 신고가 접수됐습니다 (누적 ${reportCount}건)\n` +
      `글: ${title}\n작성자: ${author}\n신고 사유: ${report.reason || '(사유 없음)'}\n\n` +
      `신고 대상 내용:\n${contentPreview}\n\n관리자: ${ADMIN_URL}`
    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;font-size:15px;line-height:1.6;color:#222">
        <div style="color:#c0392b;font-size:13px;font-weight:700">${esc(typeLabel)} 신고 접수 · 누적 ${reportCount}건</div>
        <h2 style="margin:6px 0 2px;font-size:18px">${esc(title || '(내용 없음)')}</h2>
        <div style="color:#666;font-size:13px;margin-bottom:4px">작성자 ${esc(author)}</div>
        <div style="color:#666;font-size:13px;margin-bottom:12px">신고 사유: ${esc(report.reason || '(사유 없음)')}</div>
        <div style="white-space:pre-wrap;background:#f7f7f8;border-radius:10px;padding:14px">${esc(contentPreview)}</div>
        <p style="margin-top:16px"><a href="${ADMIN_URL}" style="color:#c0392b">관리자에서 확인·조치하기</a></p>
      </div>`
    await sendMail(subject, html, text)
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('[notify-admin-report] 실패:', e)
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
