import { NavLink, useNavigate } from 'react-router-dom'
import { logout } from '../lib/auth'
import { LayoutDashboard, CalendarDays, Building2, FileText, BarChart3, LogOut, MessageSquareWarning, MessagesSquare } from 'lucide-react'

// 메뉴 순서 = 쓰는 빈도. 매일 보는 것(일정·업체·후기)이 앞, 가끔 보는 것(분석·로그)이 뒤.
// ⚠️ /events(옛 '이벤트')는 메뉴에서 뺐다 — /register와 같은 events 테이블을 다뤄
//    중복이었다. 거기에만 있던 앱 노출·추천·삭제·검색은 일정 관리로 옮겼다.
//    라우트는 살려둬서 북마크나 직접 접근은 계속 동작한다.
const NAV = [
  { to: '/', label: '대시보드', icon: LayoutDashboard },
  { to: '/register', label: '일정 관리', icon: CalendarDays },
  { to: '/companies', label: '업체 관리', icon: Building2 },
  { to: '/reviews', label: '후기 관리', icon: MessageSquareWarning },
  { to: '/board', label: '게시판 관리', icon: MessagesSquare },
  { to: '/analytics', label: '분석', icon: BarChart3 },
  { to: '/crawl-logs', label: '크롤링 로그', icon: FileText },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="md:flex md:h-screen bg-gray-50">
      {/* 데스크탑 사이드바 */}
      <aside className="hidden md:flex md:flex-col w-56 bg-white border-r border-gray-200">
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

      {/* 본문 (데스크탑은 사이드바 옆 스크롤 영역, 모바일은 일반 흐름) */}
      <main className="flex-1 min-w-0 md:overflow-auto">
        {/* 모바일 상단 메뉴 — 본문 흐름 안에 자연 배치 (스티키/고정 아님) */}
        <div className="md:hidden bg-white border-b border-gray-200 px-4 py-3">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2">
              <img src="/favicon.png" className="w-7 h-7 rounded-lg object-cover" alt="소개팅모아" />
              <span className="text-sm font-bold text-gray-900">소개팅모아 <span className="text-gray-400 font-normal">Admin</span></span>
            </div>
            <button onClick={handleLogout} className="flex items-center gap-1 text-xs text-gray-400 px-2 py-1">
              <LogOut size={14} /> 로그아웃
            </button>
          </div>
          <nav className="flex flex-wrap gap-1.5">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${
                    isActive ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-600'
                  }`
                }
              >
                <Icon size={14} />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>

        {children}
      </main>
    </div>
  )
}
