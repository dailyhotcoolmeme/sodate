import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { acceptInvite } from '../lib/auth'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_token: '초대 링크가 올바르지 않습니다. 담당자에게 다시 요청해주세요.',
  expired_token: '초대 링크가 만료됐습니다. 담당자에게 재초대를 요청해주세요.',
  password_too_short: '비밀번호는 8자 이상이어야 합니다.',
  network_error: '연결에 실패했습니다. 잠시 후 다시 시도해주세요.',
}

export default function AcceptInvite({ onDone }: { onDone: () => void }) {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setError('')
    if (!token) {
      setError('초대 링크가 올바르지 않습니다.')
      return
    }
    if (password.length < 8) {
      setError('비밀번호는 8자 이상이어야 합니다.')
      return
    }
    if (password !== confirm) {
      setError('비밀번호가 서로 다릅니다.')
      return
    }
    setSubmitting(true)
    const result = await acceptInvite(token, password)
    setSubmitting(false)
    if (result.ok) {
      onDone()
    } else {
      setError(ERROR_MESSAGES[result.error] ?? '처리에 실패했습니다.')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-sm">
        <div className="mb-6">
          <h1 className="text-lg font-bold text-gray-900">모잇 제휴 센터 가입</h1>
          <p className="text-xs text-gray-400 mt-1">앞으로 로그인에 쓸 비밀번호를 정해주세요</p>
        </div>

        {!token ? (
          <p className="text-sm text-red-500">초대 링크가 올바르지 않습니다. 담당자에게 다시 요청해주세요.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호 (8자 이상)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">비밀번호 확인</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                autoComplete="new-password"
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-pink-500 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-pink-600 transition-colors disabled:opacity-60"
            >
              {submitting ? '처리 중...' : '설정하고 시작하기'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
