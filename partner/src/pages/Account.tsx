import { useState } from 'react'
import { accountApi } from '../lib/api'

const ERROR_MESSAGES: Record<string, string> = {
  current_password_incorrect: '현재 비밀번호가 올바르지 않습니다',
  password_too_short: '새 비밀번호는 8자 이상이어야 합니다',
}

export default function Account() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setOk(false)
    if (next.length < 8) {
      setError('새 비밀번호는 8자 이상이어야 합니다')
      return
    }
    if (next !== confirm) {
      setError('새 비밀번호가 서로 다릅니다')
      return
    }
    setSubmitting(true)
    try {
      await accountApi.changePassword(current, next)
      setOk(true)
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (e) {
      setError(ERROR_MESSAGES[(e as Error).message] ?? '변경에 실패했습니다')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-md">
      <h1 className="text-xl font-bold text-gray-900 mb-1">계정 설정</h1>
      <p className="text-sm text-gray-500 mb-6">비밀번호를 변경합니다.</p>

      <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">현재 비밀번호</label>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">새 비밀번호 (8자 이상)</label>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">새 비밀번호 확인</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
          />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        {ok && <p className="text-sm text-green-600">변경됐습니다</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-pink-500 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-pink-600 transition-colors disabled:opacity-60"
        >
          {submitting ? '변경 중...' : '비밀번호 변경'}
        </button>
      </form>
    </div>
  )
}
