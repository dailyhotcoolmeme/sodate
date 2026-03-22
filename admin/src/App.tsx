import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { isLoggedIn } from './lib/auth'
import Login from './pages/Login'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Events from './pages/Events'
import Companies from './pages/Companies'
import CrawlLogs from './pages/CrawlLogs'
import Analytics from './pages/Analytics'
import { useState } from 'react'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  if (!isLoggedIn()) return <Navigate to="/login" replace />
  return <Layout>{children}</Layout>
}

export default function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn())

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={
          loggedIn
            ? <Navigate to="/" replace />
            : <Login onLogin={() => setLoggedIn(true)} />
        } />
        <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/events" element={<ProtectedRoute><Events /></ProtectedRoute>} />
        <Route path="/companies" element={<ProtectedRoute><Companies /></ProtectedRoute>} />
        <Route path="/crawl-logs" element={<ProtectedRoute><CrawlLogs /></ProtectedRoute>} />
        <Route path="/analytics" element={<ProtectedRoute><Analytics /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
