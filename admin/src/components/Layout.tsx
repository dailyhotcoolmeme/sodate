import { NavLink, useNavigate } from 'react-router-dom'
import { logout } from '../lib/auth'
import { LayoutDashboard, CalendarDays, Building2, FileText, BarChart3, LogOut } from 'lucide-react'

const NAV = [
  { to: '/', label: '대시보드', icon: LayoutDashboard },
  { to: '/events', label: '이벤트', icon: CalendarDays },
  { to: '/companies', label: '업체', icon: Building2 },
  { to: '/crawl-logs', label: '크롤링', icon: FileText },
  { to: '/analytics', label: '분석', icon: BarChart3 },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* 사이드바 */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col">
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-gray-100">
          <img src="/favicon.png" className="w-8 h-8 rounded-lg object-cover" alt="소개팅모아" />
          <div>
            <p className="text-sm font-bold text-gray-900">소개팅모아</p>
            <p className="text-xs text-gray-400">Admin</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-pink-50 text-pink-600'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-gray-100">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
          >
            <LogOut size={16} />
            로그아웃
          </button>
        </div>
      </aside>

      {/* 본문 */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
