import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { fetchMe, type Me } from './lib/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import AcceptInvite from './pages/AcceptInvite'
import Events from './pages/Events'
import Discount from './pages/Discount'
import Banner from './pages/Banner'
import Account from './pages/Account'

export default function App() {
  // null = 세션 확인 중
  const [me, setMe] = useState<Me | null>(null)

  const refresh = () => fetchMe().then(setMe)
  useEffect(() => {
    refresh()
  }, [])

  if (me === null) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-sm text-ink-faint">
        불러오는 중...
      </div>
    )
  }

  const guard = (el: React.ReactNode) =>
    me.authenticated ? <Layout me={me}>{el}</Layout> : <Navigate to="/login" replace />

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={me.authenticated ? <Navigate to="/events" replace /> : <Login onLogin={refresh} />}
        />
        <Route
          path="/accept-invite"
          element={me.authenticated ? <Navigate to="/events" replace /> : <AcceptInvite onDone={refresh} />}
        />
        {/* 대시보드(홈)는 없앴다 — 내용이 일정·할인 화면과 겹쳐서 오너가 뺐다(2026-09-05). */}
        <Route path="/" element={<Navigate to="/events" replace />} />
        <Route path="/events" element={guard(<Events />)} />
        <Route path="/discount" element={guard(<Discount />)} />
        <Route path="/banner" element={guard(me.tier === 'paid' ? <Banner /> : <Navigate to="/events" replace />)} />
        <Route path="/account" element={guard(<Account me={me} />)} />
        <Route path="*" element={<Navigate to="/events" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
