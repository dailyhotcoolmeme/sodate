import { useState } from 'react'
import { login } from '../lib/auth'

import { SUPPORT_EMAIL } from '../lib/support'

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
    if (result.ok) {
      onLogin()
    } else {
      setError(ERROR_MESSAGES[result.error] ?? '로그인에 실패했습니다')
    }
  }

  return (
    <div className="min-h-dvh bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-sm">
        <div className="mb-6">
          <h1 className="text-lg font-bold text-gray-900">모잇 제휴 센터</h1>
          <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
            모잇에 올릴 모임 일정과 할인 혜택을 직접 등록·관리하는 곳입니다.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              placeholder="example@company.com"
              autoComplete="username"
            />
            <p className="text-xs text-gray-400 mt-1">모잇에서 보내드린 초대 메일을 받으신 주소예요.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              placeholder="비밀번호"
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-pink-500 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-pink-600 transition-colors disabled:opacity-60"
          >
            {submitting ? '확인 중...' : '로그인'}
          </button>
        </form>
        <div className="mt-6 pt-5 border-t border-gray-100">
          <p className="text-xs text-gray-500 leading-relaxed">
            <b className="text-gray-700">비밀번호를 잊으셨나요?</b>
            <br />
            모잇 담당자{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-pink-600 font-medium">
              {SUPPORT_EMAIL}
            </a>
            로 연락 주시면 초대 메일을 다시 보내드립니다. 새 메일의 링크에서 비밀번호를 다시 정하시면 됩니다.
          </p>
        </div>
      </div>
    </div>
  )
}
