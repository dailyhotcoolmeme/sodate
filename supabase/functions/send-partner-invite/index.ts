// 제휴 포털 초대 메일 발송 — admin 서버(functions/api/partner-invite.ts)가 서버 대
// 서버로 호출한다. notify-admin-report 와 같은 Gmail SMTP(nodemailer) 인프라를
// 그대로 재사용한다 — 이 기능을 위해 새 이메일 계정·API 키를 따로 안 만든다.
//
// 인증: admin은 오너 전용 콘솔이라 이미 세션으로 게이트돼 있다. 이 함수 자체는
// x-webhook-secret 으로 한 번 더 막는다(공개 인터넷에 그대로 노출된 Edge Function
// 이라 익명 호출로 메일 폭탄을 못 보내게).
import nodemailer from 'npm:nodemailer@6.9.14'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
}

const GMAIL_USER = Deno.env.get('GMAIL_USER') ?? ''
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD') ?? ''
const INVITE_SECRET = Deno.env.get('PARTNER_INVITE_SECRET') ?? ''

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return new Response(JSON.stringify({ error: 'mail not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  if (!INVITE_SECRET || req.headers.get('x-webhook-secret') !== INVITE_SECRET) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const body = await req.json().catch(() => ({}))
  const email = String(body.email ?? '')
  const companyName = String(body.companyName ?? '모잇')
  const inviteUrl = String(body.inviteUrl ?? '')
  if (!email || !inviteUrl) {
    return new Response(JSON.stringify({ error: 'email과 inviteUrl이 필요합니다' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <h2 style="color:#FF6B9D">모잇 제휴 센터 초대</h2>
      <p><b>${esc(companyName)}</b>님, 모잇과의 제휴가 시작됐습니다.</p>
      <p>아래 버튼을 눌러 로그인에 쓸 비밀번호를 직접 설정해주세요. 링크는 7일간 유효합니다.</p>
      <p style="margin:28px 0">
        <a href="${inviteUrl}" style="background:#FF6B9D;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:bold">
          비밀번호 설정하고 시작하기
        </a>
      </p>
      <p style="color:#999;font-size:13px">버튼이 안 눌리면 아래 주소를 브라우저에 붙여넣어주세요.<br/>${esc(inviteUrl)}</p>
    </div>
  `.trim()
  const text = `모잇 제휴 센터 초대\n\n${companyName}님, 모잇과의 제휴가 시작됐습니다.\n아래 링크에서 비밀번호를 설정해주세요(7일간 유효):\n${inviteUrl}`

  try {
    const transport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    })
    await transport.sendMail({
      from: `"모잇 제휴 센터" <${GMAIL_USER}>`,
      to: email,
      subject: '[모잇] 제휴 센터 초대 — 비밀번호를 설정해주세요',
      text,
      html,
    })
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('[send-partner-invite] 발송 실패', e)
    return new Response(JSON.stringify({ error: 'send_failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
