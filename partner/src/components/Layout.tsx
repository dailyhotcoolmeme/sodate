import { NavLink, useNavigate } from 'react-router-dom'
import { logout } from '../lib/auth'
import type { Me } from '../lib/auth'

const BASE_NAV = [
  { to: '/', label: '대시보드' },
  { to: '/events', label: '일정 관리' },
  { to: '/discount', label: '제휴 할인 관리' },
]

export default function Layout({ children, me }: { children: React.ReactNode; me: Me }) {
  const navigate = useNavigate()
  const nav = [
    ...BASE_NAV,
    // 유료 등급만 배너 메뉴가 보인다(오너 확정) — 무료 업체는 메뉴 자체가 없다.
    ...(me.tier === 'paid' ? [{ to: '/banner', label: '배너 광고' }] : []),
    { to: '/account', label: '계정 설정' },
  ]

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="md:flex md:h-screen bg-gray-50">
      <aside className="hidden md:flex md:flex-col w-56 bg-white border-r border-gray-200">
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-gray-100">
          <img src="/favicon.png" className="w-8 h-8 rounded-lg object-cover" alt="모잇" />
          <div>
            <p className="text-sm font-bold text-gray-900">{me.companyName ?? '모잇 제휴'}</p>
            <p className="text-xs text-gray-400">제휴 센터</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {nav.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `block px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-pink-50 text-pink-600' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-100">
          <button
            onClick={handleLogout}
            className="w-full px-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-900 text-left"
          >
            로그아웃
          </button>
        </div>
      </aside>

      {/* 모바일 상단바 — 사이드바 없이 최소한만 */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
        <p className="text-sm font-bold text-gray-900">{me.companyName ?? '모잇 제휴'}</p>
        <button onClick={handleLogout} className="text-xs text-gray-500">
          로그아웃
        </button>
      </header>
      <nav className="md:hidden tab-scroll flex gap-1 px-3 py-2 bg-white border-b border-gray-200">
        {nav.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `shrink-0 whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium ${
                isActive ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-600'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
    </div>
  )
}
