import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { acceptInvite, fetchInviteInfo, type InviteInfo } from '../lib/auth'
import { SUPPORT_EMAIL } from '../lib/support'
import { INPUT, LABEL, HINT, BTN_PRIMARY, PANEL } from '../lib/ui'

const LINK_PROBLEM: Record<string, string> = {
  invalid_token:
    '이 초대 링크는 더 이상 쓸 수 없습니다. 이미 비밀번호를 정하셨거나, 링크가 잘못 복사됐을 수 있습니다.',
  expired_token: '초대 링크가 만료됐습니다. 초대 링크는 보내드린 날부터 7일간만 쓸 수 있습니다.',
}

const ERROR_MESSAGES: Record<string, string> = {
  ...LINK_PROBLEM,
  password_too_short: '비밀번호는 8자 이상으로 정해주세요.',
  network_error: '연결에 실패했습니다. 인터넷 상태를 확인하고 다시 시도해주세요.',
}

function LinkProblem({ message }: { message: string }) {
  return (
    <div>
      <p className="text-sm text-ink leading-relaxed">{message}</p>
      <p className="text-sm text-ink-muted leading-relaxed mt-3">
        모잇 담당자{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary font-medium">
          {SUPPORT_EMAIL}
        </a>
        로 연락 주시면 초대 메일을 다시 보내드립니다.
      </p>
    </div>
  )
}

export default function AcceptInvite({ onDone }: { onDone: () => void }) {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [linkError, setLinkError] = useState('')
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 비밀번호를 정하기 전에 "어느 업체 / 앞으로 쓸 아이디"를 먼저 확인시켜준다.
  useEffect(() => {
    if (!token) {
      setLinkError(LINK_PROBLEM.invalid_token)
      setChecking(false)
      return
    }
    fetchInviteInfo(token).then((r) => {
      if (r.ok) setInfo(r.info)
      else setLinkError(LINK_PROBLEM[r.error] ?? '초대 링크를 확인하지 못했습니다. 잠시 후 다시 열어주세요.')
      setChecking(false)
    })
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setError('')
    if (password.length < 8) return setError('비밀번호는 8자 이상으로 정해주세요.')
    if (password !== confirm) return setError('두 칸에 적으신 비밀번호가 서로 다릅니다. 다시 확인해주세요.')
    setSubmitting(true)
    const result = await acceptInvite(token, password)
    setSubmitting(false)
    if (result.ok) onDone()
    else setError(ERROR_MESSAGES[result.error] ?? '처리에 실패했습니다. 잠시 후 다시 시도해주세요.')
  }

  return (
    <div className="min-h-dvh bg-bg flex items-center justify-center p-5">
      <div className="hero-glow" />
      <div className={`${PANEL} relative z-10 w-full max-w-sm p-8`}>
        <p className="text-xs font-semibold tracking-[0.05em] text-primary mb-2">WELCOME</p>
        <h1 className="text-2xl font-bold text-ink leading-tight">
          {info?.companyName ? `${info.companyName}님, 환영합니다` : '모잇 제휴 센터'}
        </h1>
        <p className={`${HINT} mt-2 mb-6`}>
          처음 오셨네요. 앞으로 로그인할 때 쓰실 비밀번호를 직접 정해주세요.
        </p>

        {checking ? (
          <p className="text-sm text-ink-faint">초대 링크를 확인하고 있습니다...</p>
        ) : linkError ? (
          <LinkProblem message={linkError} />
        ) : (
          <>
            {/* 로그인 아이디가 뭐가 되는지 여기서 처음이자 유일하게 알려준다. */}
            <div className="rounded-2xl border border-line bg-surface-lowest p-4 mb-6">
              <p className="text-xs text-ink-faint mb-1">앞으로 쓰실 로그인 아이디</p>
              <p className="text-sm font-semibold text-ink break-all">{info?.email}</p>
              <p className="text-xs text-ink-faint mt-2 leading-relaxed">
                아이디는 이 주소로 정해져 있습니다. 비밀번호만 아래에서 정해주시면 됩니다.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className={LABEL}>쓰실 비밀번호</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={INPUT}
                  autoComplete="new-password"
                />
                <p className={HINT}>8자 이상으로, 원하시는 대로 직접 정하시면 됩니다.</p>
              </div>
              <div>
                <label className={LABEL}>한 번 더 입력</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className={INPUT}
                  autoComplete="new-password"
                />
                <p className={HINT}>잘못 입력하는 걸 막기 위해 같은 비밀번호를 한 번 더 적어주세요.</p>
              </div>
              {error && <p className="text-sm text-danger">{error}</p>}
              <button type="submit" disabled={submitting} className={`${BTN_PRIMARY} w-full`}>
                {submitting ? '설정하는 중...' : '비밀번호 정하고 시작하기'}
              </button>
              <p className="text-xs text-ink-faint text-center leading-relaxed">
                정하신 비밀번호는 다음부터 로그인할 때 쓰입니다. 잊으셨을 땐 모잇 담당자에게 문의해주세요.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
