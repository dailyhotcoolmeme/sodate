import { useState } from 'react'
import { login } from '../lib/auth'
import { SUPPORT_EMAIL } from '../lib/support'
import { INPUT, LABEL, HINT, BTN_PRIMARY, PANEL } from '../lib/ui'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: '이메일 또는 비밀번호가 맞지 않습니다. 다시 확인해주세요.',
  account_disabled: `지금은 로그인할 수 없는 계정입니다. ${SUPPORT_EMAIL} 로 문의해주세요.`,
  too_many_attempts: '여러 번 틀리셔서 잠시 잠겼습니다. 5분 뒤에 다시 시도해주세요.',
  network_error: '연결에 실패했습니다. 인터넷 상태를 확인하고 다시 시도해주세요.',
}

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setError('')
    setSubmitting(true)
    const result = await login(email, password)
    setSubmitting(false)
    if (result.ok) onLogin()
    else setError(ERROR_MESSAGES[result.error] ?? '로그인에 실패했습니다.')
  }

  return (
    <div className="min-h-dvh bg-bg flex items-center justify-center p-5">
      <div className="hero-glow" />
      <div className={`${PANEL} relative z-10 w-full max-w-sm p-8`}>
        <p className="text-xs font-semibold tracking-[0.05em] text-primary mb-2">PARTNER</p>
        <h1 className="text-2xl font-bold text-ink leading-tight">모잇 제휴 센터</h1>
        <p className={`${HINT} mt-2 mb-7`}>
          모잇에 올릴 모임 일정과 할인 혜택을 직접 등록·관리하는 곳입니다.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className={LABEL}>이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={INPUT}
              placeholder="example@company.com"
              autoComplete="username"
            />
            <p className={HINT}>모잇에서 보내드린 초대 메일을 받으신 주소예요.</p>
          </div>
          <div>
            <label className={LABEL}>비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT}
              placeholder="비밀번호"
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" disabled={submitting} className={`${BTN_PRIMARY} w-full`}>
            {submitting ? '확인 중...' : '로그인'}
          </button>
        </form>

        <div className="mt-7 pt-5 border-t border-surface-highest">
          <p className="text-xs text-ink-faint leading-relaxed">
            <b className="text-ink-muted">비밀번호를 잊으셨나요?</b>
            <br />
            모잇 담당자{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary font-medium">
              {SUPPORT_EMAIL}
            </a>
            로 연락 주시면 초대 메일을 다시 보내드립니다. 새 메일의 링크에서 비밀번호를 다시 정하시면 됩니다.
          </p>
        </div>
      </div>
    </div>
  )
}
