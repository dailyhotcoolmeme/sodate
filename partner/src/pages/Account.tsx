import { useState } from 'react'
import { accountApi } from '../lib/api'
import type { Me } from '../lib/auth'
import { SUPPORT_EMAIL } from '../lib/support'

const PASSWORD_ERRORS: Record<string, string> = {
  current_password_incorrect: '지금 쓰고 계신 비밀번호가 맞지 않습니다.',
  password_too_short: '새 비밀번호는 8자 이상으로 정해주세요.',
}

const EMAIL_ERRORS: Record<string, string> = {
  password_incorrect: '비밀번호가 맞지 않습니다. 지금 쓰고 계신 비밀번호를 적어주세요.',
  invalid_email: '이메일 주소 형식이 아닙니다. 다시 확인해주세요.',
  email_taken: '다른 곳에서 이미 쓰고 있는 주소입니다. 다른 주소를 적어주세요.',
}

const INPUT =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent'
const CARD = 'bg-white rounded-2xl border border-gray-200 p-5'
const SUBMIT =
  'w-full bg-pink-500 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-pink-600 transition-colors disabled:opacity-60'

/** 로그인 아이디(이메일) 변경. 담당자가 바뀌었을 때 업체가 직접 넘길 수 있게 한다. */
function EmailSection({ me }: { me: Me }) {
  const [current, setCurrent] = useState(me.email ?? '')
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [ok, setOk] = useState(false)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setOk(false)
    setSubmitting(true)
    try {
      const saved = await accountApi.changeEmail(password, newEmail.trim())
      setCurrent(saved)
      setNewEmail('')
      setPassword('')
      setOpen(false)
      setOk(true)
    } catch (e) {
      setError(EMAIL_ERRORS[(e as Error).message] ?? '변경에 실패했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={CARD}>
      <h2 className="text-sm font-bold text-gray-900 mb-3">로그인 아이디</h2>

      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <p className="text-xs text-gray-500 mb-1">지금 쓰고 계신 아이디</p>
        <p className="text-sm font-semibold text-gray-900 break-all">{current || '-'}</p>
      </div>
      {ok && <p className="text-sm text-green-600 mt-3">아이디를 바꿨습니다. 다음 로그인부터 새 주소를 쓰시면 됩니다.</p>}

      {!open ? (
        <>
          <button
            onClick={() => {
              setOpen(true)
              setOk(false)
            }}
            className="mt-4 px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
          >
            아이디 바꾸기
          </button>
          <p className="text-xs text-gray-400 mt-3 leading-relaxed">
            담당자가 바뀌셨다면 여기서 새 담당자 이메일로 바꾸시면 됩니다.
          </p>
        </>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">새 이메일 주소</label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className={INPUT}
              placeholder="example@company.com"
              autoComplete="email"
            />
            <p className="text-xs text-gray-400 mt-1">앞으로 이 주소로 로그인하시게 됩니다.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">지금 쓰는 비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT}
              autoComplete="current-password"
            />
            <p className="text-xs text-gray-400 mt-1">본인이 맞는지 확인하기 위해 한 번 더 여쭤봅니다.</p>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex gap-3">
            <button type="submit" disabled={submitting} className={`${SUBMIT} flex-1`}>
              {submitting ? '바꾸는 중...' : '아이디 바꾸기'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setError('')
                setNewEmail('')
                setPassword('')
              }}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold bg-white border border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              취소
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function PasswordSection() {
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
      setError('새 비밀번호는 8자 이상으로 정해주세요.')
      return
    }
    if (next !== confirm) {
      setError('두 칸에 적으신 새 비밀번호가 서로 다릅니다. 다시 확인해주세요.')
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
      setError(PASSWORD_ERRORS[(e as Error).message] ?? '변경에 실패했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={`${CARD} space-y-4`}>
      <h2 className="text-sm font-bold text-gray-900">비밀번호 변경</h2>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">지금 쓰는 비밀번호</label>
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          className={INPUT}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">새 비밀번호</label>
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          className={INPUT}
        />
        <p className="text-xs text-gray-400 mt-1">8자 이상으로 정해주세요.</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">새 비밀번호 한 번 더</label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          className={INPUT}
        />
        <p className="text-xs text-gray-400 mt-1">잘못 입력하는 걸 막기 위해 같은 비밀번호를 한 번 더 적어주세요.</p>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {ok && <p className="text-sm text-green-600">비밀번호를 바꿨습니다. 다음 로그인부터 새 비밀번호를 쓰시면 됩니다.</p>}
      <button type="submit" disabled={submitting} className={SUBMIT}>
        {submitting ? '바꾸는 중...' : '비밀번호 바꾸기'}
      </button>
    </form>
  )
}

export default function Account({ me }: { me: Me }) {
  return (
    <div className="max-w-md space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">계정 설정</h1>
        <p className="text-sm text-gray-500 leading-relaxed">
          로그인에 쓰는 아이디와 비밀번호를 여기서 바꾸실 수 있습니다.
        </p>
      </div>

      <EmailSection me={me} />
      <PasswordSection />

      <p className="text-xs text-gray-400 leading-relaxed">
        비밀번호를 잊으셨을 땐 모잇 담당자{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-pink-600 font-medium">
          {SUPPORT_EMAIL}
        </a>
        로 연락 주세요. 초대 메일을 다시 보내드립니다.
      </p>
    </div>
  )
}
