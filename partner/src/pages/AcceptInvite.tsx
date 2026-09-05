import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { acceptInvite, fetchInviteInfo, type InviteInfo } from '../lib/auth'
import { SUPPORT_EMAIL } from '../lib/support'

const LINK_PROBLEM: Record<string, string> = {
  invalid_token: '이 초대 링크는 더 이상 쓸 수 없습니다. 이미 비밀번호를 정하셨거나, 링크가 잘못 복사됐을 수 있습니다.',
  expired_token: '초대 링크가 만료됐습니다. 초대 링크는 보내드린 날부터 7일간만 쓸 수 있습니다.',
}

const ERROR_MESSAGES: Record<string, string> = {
  ...LINK_PROBLEM,
  password_too_short: '비밀번호는 8자 이상으로 정해주세요.',
  network_error: '연결에 실패했습니다. 인터넷 상태를 확인하고 다시 시도해주세요.',
}

/** 링크 자체가 못 쓰는 상태일 때 — 뭘 해야 하는지까지 알려준다. */
function LinkProblem({ message }: { message: string }) {
  return (
    <div>
      <p className="text-sm text-gray-800 leading-relaxed">{message}</p>
      <p className="text-sm text-gray-500 leading-relaxed mt-3">
        모잇 담당자{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-pink-600 font-medium">
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
    if (password.length < 8) {
      setError('비밀번호는 8자 이상으로 정해주세요.')
      return
    }
    if (password !== confirm) {
      setError('두 칸에 적으신 비밀번호가 서로 다릅니다. 다시 확인해주세요.')
      return
    }
    setSubmitting(true)
    const result = await acceptInvite(token, password)
    setSubmitting(false)
    if (result.ok) {
      onDone()
    } else {
      setError(ERROR_MESSAGES[result.error] ?? '처리에 실패했습니다. 잠시 후 다시 시도해주세요.')
    }
  }

  return (
    <div className="min-h-dvh bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 w-full max-w-sm">
        <div className="mb-6">
          <h1 className="text-lg font-bold text-gray-900">
            {info?.companyName ? `${info.companyName}님, 환영합니다` : '모잇 제휴 센터'}
          </h1>
          <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
            처음 오셨네요. 앞으로 로그인할 때 쓰실 비밀번호를 직접 정해주세요.
          </p>
        </div>

        {checking ? (
          <p className="text-sm text-gray-400">초대 링크를 확인하고 있습니다...</p>
        ) : linkError ? (
          <LinkProblem message={linkError} />
        ) : (
          <>
            {/* 로그인 아이디가 뭐가 되는지 여기서 처음이자 유일하게 알려준다. */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-5">
              <p className="text-xs text-gray-500 mb-1">앞으로 쓰실 로그인 아이디</p>
              <p className="text-sm font-semibold text-gray-900 break-all">{info?.email}</p>
              <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                아이디는 이 주소로 정해져 있습니다. 비밀번호만 아래에서 정해주시면 됩니다.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">쓰실 비밀번호</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                  autoComplete="new-password"
                />
                <p className="text-xs text-gray-400 mt-1">
                  8자 이상으로, 원하시는 대로 직접 정하시면 됩니다.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  한 번 더 입력
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                  autoComplete="new-password"
                />
                <p className="text-xs text-gray-400 mt-1">
                  잘못 입력하는 걸 막기 위해 같은 비밀번호를 한 번 더 적어주세요.
                </p>
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-pink-500 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-pink-600 transition-colors disabled:opacity-60"
              >
                {submitting ? '설정하는 중...' : '비밀번호 정하고 시작하기'}
              </button>
              <p className="text-xs text-gray-400 text-center leading-relaxed">
                정하신 비밀번호는 다음부터 로그인할 때 쓰입니다. 잊으셨을 땐 모잇 담당자에게 문의해주세요.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
