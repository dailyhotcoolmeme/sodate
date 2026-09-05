import { useState } from 'react'
import { login } from '../lib/auth'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: '이메일 또는 비밀번호가 올바르지 않습니다',
  account_disabled: '제휴가 종료되어 로그인할 수 없습니다. 문의는 admin@ourmine.co.kr',
  too_many_attempts: '너무 여러 번 실패했습니다. 잠시 후 다시 시도해주세요',
  network_error: '연결에 실패했습니다. 잠시 후 다시 시도해주세요',
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-sm">
        <div className="mb-8">
          <h1 className="text-lg font-bold text-gray-900">모잇 제휴 센터</h1>
          <p className="text-xs text-gray-400 mt-1">제휴 업체 전용 관리 화면</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
              placeholder="담당자 이메일"
              autoComplete="username"
            />
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
        <p className="text-xs text-gray-400 mt-6 text-center">
          비밀번호를 잊으셨나요? 담당자에게 재초대를 요청해주세요.
        </p>
      </div>
    </div>
  )
}
