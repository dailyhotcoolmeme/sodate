// 초대 링크를 눌렀을 때, 비밀번호를 정하기 전에 "어느 업체로 / 어떤 아이디로"
// 가입되는지 화면에 보여주기 위한 조회. 업체 담당자는 자기가 받은 링크가 우리
// 회사 것이 맞는지, 앞으로 로그인에 쓸 아이디가 뭔지 여기서 처음 알게 된다.
//
// 인증: 세션이 없는 상태에서 부르는 유일한 조회다. 토큰 자체가 비밀이므로,
// 토큰이 맞을 때만 업체명·이메일을 돌려준다. 토큰이 틀리면 아무것도 안 알려준다.
import { json } from '../_lib/session'
import { db, type DbEnv } from '../_lib/db'

interface InviteRow {
  company_id: string
  email: string
  invite_expires_at: string | null
}

export const onRequestGet: PagesFunction<DbEnv> = async ({ request, env }) => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'server_not_configured' }, 500)
  }

  const token = new URL(request.url).searchParams.get('token') ?? ''
  if (!token) return json({ error: 'missing_token' }, 400)

  let rows: InviteRow[]
  try {
    rows = await db.select<InviteRow>(
      env,
      'partner_accounts',
      `select=company_id,email,invite_expires_at&invite_token=eq.${encodeURIComponent(token)}&limit=1`,
    )
  } catch {
    return json({ error: 'server_error' }, 500)
  }

  const invite = rows[0]
  if (!invite) return json({ error: 'invalid_token' }, 404)
  if (invite.invite_expires_at && new Date(invite.invite_expires_at).getTime() < Date.now()) {
    return json({ error: 'expired_token' }, 410)
  }

  let companyName = ''
  try {
    const companies = await db.select<{ name: string }>(
      env,
      'companies',
      `select=name&id=eq.${invite.company_id}&limit=1`,
    )
    companyName = companies[0]?.name ?? ''
  } catch {
    // 업체명은 화면을 더 친절하게 만들 뿐, 없어도 비밀번호 설정 자체는 되어야 한다.
  }

  return json({ companyName, email: invite.email })
}
