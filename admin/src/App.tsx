import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { checkSession } from './lib/auth'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Register from './pages/Register'
import Events from './pages/Events'
import Socialing from './pages/Socialing'
import Places from './pages/Places'
import PlaceReviews from './pages/PlaceReviews'
import Companies from './pages/Companies'
import Reviews from './pages/Reviews'
import Board from './pages/Board'
import CrawlLogs from './pages/CrawlLogs'
import Analytics from './pages/Analytics'
import Trends from './pages/Trends'

function guard(authed: boolean, el: React.ReactNode) {
  return authed ? <Layout>{el}</Layout> : <Navigate to="/login" replace />
}

export default function App() {
  // null = 세션 확인 중
  const [authed, setAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    checkSession().then(setAuthed)
  }, [])

  if (authed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">
        불러오는 중...
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={authed ? <Navigate to="/" replace /> : <Login onLogin={() => setAuthed(true)} />}
        />
        <Route path="/" element={guard(authed, <Dashboard />)} />
        <Route path="/register" element={guard(authed, <Register />)} />
        <Route path="/events" element={guard(authed, <Events />)} />
        <Route path="/socialing" element={guard(authed, <Socialing />)} />
        <Route path="/places" element={guard(authed, <Places />)} />
        <Route path="/place-reviews" element={guard(authed, <PlaceReviews />)} />
        <Route path="/companies" element={guard(authed, <Companies />)} />
        <Route path="/reviews" element={guard(authed, <Reviews />)} />
        <Route path="/board" element={guard(authed, <Board />)} />
        <Route path="/crawl-logs" element={guard(authed, <CrawlLogs />)} />
        <Route path="/analytics" element={guard(authed, <Analytics />)} />
        <Route path="/trends" element={guard(authed, <Trends />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
