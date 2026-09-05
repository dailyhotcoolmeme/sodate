import { useEffect, useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { logout } from '../lib/auth'
import type { Me } from '../lib/auth'

// 톱바에 그대로 나오는 주 메뉴. 대시보드(홈)는 두 화면과 내용이 겹쳐 없앴다(오너 확정).
const MAIN_NAV = [
  { to: '/events', label: '일정 등록' },
  { to: '/discount', label: '할인 혜택' },
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
    return (
      <img
        src={me.logoUrl}
        alt={name}
        className="w-7 h-7 rounded-full object-cover shrink-0 ring-1 ring-line"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="w-7 h-7 rounded-full bg-primary text-on-primary text-xs font-bold flex items-center justify-center shrink-0"
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
    ...(me.tier === 'paid' ? [{ to: '/banner', label: '배너 광고' }] : []),
  ]

  useEffect(() => setOpen(false), [location.pathname])

  // 메뉴 바깥을 누르면 닫힌다.
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
    <div className="min-h-dvh bg-bg">
      <div className="hero-glow" />

      <header className="relative z-10 border-b border-surface-highest bg-surface-lowest">
        <div className="max-w-5xl mx-auto flex items-stretch h-16 px-3">
          <div className="flex items-center gap-2.5 pr-4 shrink-0">
            <CompanyMark me={me} />
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink truncate max-w-[7rem] sm:max-w-none leading-tight">
                {me.companyName ?? '모잇 제휴'}
              </p>
              <p className="text-[11px] text-ink-faint leading-tight">모잇 제휴 센터</p>
            </div>
          </div>

          <nav className="tab-scroll flex items-stretch">
            {nav.map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  // -mb-px 로 탭의 밑줄이 헤더 아래 경계선 위에 정확히 겹쳐 앉는다.
                  `shrink-0 flex items-center whitespace-nowrap px-4 -mb-px border-b-2 text-sm font-semibold transition-colors ${
                    isActive ? 'border-primary text-primary' : 'border-transparent text-ink-faint hover:text-ink-muted'
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
              className="w-11 h-11 flex items-center justify-center rounded-xl text-ink-muted hover:bg-surface-high transition-colors"
            >
              <MenuIcon open={open} />
            </button>

            {open && (
              <div className="absolute right-0 top-14 z-20 w-48 rounded-2xl border border-line bg-surface shadow-2xl py-1.5">
                {MENU_NAV.map(({ to, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className="block px-4 py-2.5 text-sm text-ink-muted hover:bg-surface-high hover:text-ink"
                  >
                    {label}
                  </NavLink>
                ))}
                <div className="my-1.5 border-t border-surface-highest" />
                <button
                  onClick={handleLogout}
                  className="block w-full text-left px-4 py-2.5 text-sm text-ink-faint hover:bg-surface-high hover:text-ink"
                >
                  로그아웃
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-5xl mx-auto px-4 py-8 md:px-6 md:py-12">{children}</main>
    </div>
  )
}
