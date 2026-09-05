import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { logout } from '../lib/auth'
import type { Me } from '../lib/auth'

// 톱바에 그대로 나오는 주 메뉴. 자주 쓰는 것만 짧은 이름으로 둔다 —
// 폰에서도 한 줄에 들어가야 하고, 메뉴가 늘어나도 여기만 추가하면 된다.
const MAIN_NAV = [
  { to: '/', label: '홈' },
  { to: '/events', label: '일정' },
  { to: '/discount', label: '할인' },
]

// 자주 안 쓰는 것은 햄버거 안으로. 톱바가 두 줄로 늘어나는 걸 막는다.
const MENU_NAV = [{ to: '/account', label: '계정 설정' }]

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {open ? (
        <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  )
}

/** 업체 로고. 대부분의 업체는 로고가 없어서, 없으면 이름 첫 글자를 원형으로 보여준다. */
function CompanyMark({ me }: { me: Me }) {
  const name = me.companyName ?? '모잇'
  if (me.logoUrl) {
    return <img src={me.logoUrl} alt={name} className="w-7 h-7 rounded-full object-cover shrink-0" />
  }
  return (
    <span
      aria-hidden="true"
      className="w-7 h-7 rounded-full bg-pink-100 text-pink-600 text-xs font-bold flex items-center justify-center shrink-0"
    >
      {name.slice(0, 1)}
    </span>
  )
}

export default function Layout({ children, me }: { children: React.ReactNode; me: Me }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const nav = [
    ...MAIN_NAV,
    // 유료 등급만 배너 메뉴가 보인다(오너 확정) — 무료 업체는 메뉴 자체가 없다.
    ...(me.tier === 'paid' ? [{ to: '/banner', label: '배너' }] : []),
  ]

  // 다른 화면으로 넘어가면 열린 메뉴는 닫는다.
  useEffect(() => setOpen(false), [location.pathname])

  // 메뉴 바깥을 누르면 닫힌다 — 열어놓고 딴 데를 눌렀는데 안 닫히면 답답하다.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="min-h-dvh bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto flex items-stretch h-14 px-2">
          <div className="flex items-center gap-2 pr-3 shrink-0">
            <CompanyMark me={me} />
            <p className="text-sm font-bold text-gray-900 truncate max-w-[5.5rem] sm:max-w-none">
              {me.companyName ?? '모잇 제휴'}
            </p>
          </div>

          <nav className="tab-scroll flex items-stretch">
            {nav.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  // -mb-px 로 탭의 밑줄이 헤더 아래 경계선 위에 정확히 겹쳐 앉는다.
                  `shrink-0 flex items-center whitespace-nowrap px-3.5 -mb-px border-b-2 text-sm font-medium transition-colors ${
                    isActive ? 'border-pink-500 text-pink-600' : 'border-transparent text-gray-500'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          {/* 햄버거는 맨 오른쪽 끝. ml-auto 로 남는 공간을 전부 밀어낸다. */}
          <div ref={menuRef} className="relative flex items-center ml-auto pl-2">
            <button
              onClick={() => setOpen((v) => !v)}
              aria-label="메뉴"
              aria-expanded={open}
              className="w-11 h-11 flex items-center justify-center rounded-lg text-gray-600 hover:bg-gray-50"
            >
              <MenuIcon open={open} />
            </button>

            {open && (
              <div className="absolute right-0 top-12 z-20 w-44 bg-white rounded-xl border border-gray-200 shadow-lg py-1.5">
                {MENU_NAV.map(({ to, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className="block px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    {label}
                  </NavLink>
                ))}
                <div className="my-1.5 border-t border-gray-100" />
                <button
                  onClick={handleLogout}
                  className="block w-full text-left px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50"
                >
                  로그아웃
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-4 md:p-8">{children}</main>
    </div>
  )
}
