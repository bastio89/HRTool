import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './AuthContext'
import { ThemeProvider } from './ThemeContext'
import { I18nProvider } from './I18nContext'
import { ToastProvider } from './components/Toast'
import ErrorBoundary from './components/ErrorBoundary'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Candidates from './pages/Candidates'
import CandidateForm from './pages/CandidateForm'
import CandidateDetail from './pages/CandidateDetail'
import Matching from './pages/Matching'
import MatchingResults from './pages/MatchingResults'
import History from './pages/History'
import Jobs from './pages/Jobs'
import JobForm from './pages/JobForm'
import Pipeline from './pages/Pipeline'
import UserManagement from './pages/UserManagement'
import AuditLog from './pages/AuditLog'
import DSGVO from './pages/DSGVO'
import KITransparenz from './pages/KITransparenz'
import EmailSettings from './pages/EmailSettings'
import Reports from './pages/Reports'

function AdminRoute({ children }) {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <Navigate to="/" replace />
  return children
}

function ProtectedRoutes() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f5f7] dark:bg-black flex items-center justify-center">
        <div className="w-10 h-10 border-[3px] border-gray-200 dark:border-gray-700 border-t-[#0071e3] rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="candidates" element={<Candidates />} />
        <Route path="candidates/new" element={<CandidateForm />} />
        <Route path="candidates/:id/edit" element={<CandidateForm />} />
        <Route path="candidates/:id/detail" element={<CandidateDetail />} />
        <Route path="jobs" element={<Jobs />} />
        <Route path="jobs/new" element={<JobForm />} />
        <Route path="jobs/:id/edit" element={<JobForm />} />
        <Route path="pipeline/:jobId" element={<Pipeline />} />
        <Route path="matching" element={<Matching />} />
        <Route path="matching/results/:id" element={<MatchingResults />} />
        <Route path="history" element={<History />} />
        <Route path="admin" element={<AdminRoute><Navigate to="/admin/users" replace /></AdminRoute>} />
        <Route path="admin/users" element={<AdminRoute><UserManagement /></AdminRoute>} />
        <Route path="admin/audit" element={<AdminRoute><AuditLog /></AdminRoute>} />
        <Route path="admin/dsgvo" element={<AdminRoute><DSGVO /></AdminRoute>} />
        <Route path="admin/ki-transparenz" element={<AdminRoute><KITransparenz /></AdminRoute>} />
        <Route path="admin/email" element={<AdminRoute><EmailSettings /></AdminRoute>} />
        <Route path="admin/reports" element={<AdminRoute><Reports /></AdminRoute>} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <I18nProvider>
    <ThemeProvider>
    <AuthProvider>
      <ToastProvider>
      <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<LoginGuard />} />
          <Route path="/*" element={<ProtectedRoutes />} />
        </Routes>
      </ErrorBoundary>
      </ToastProvider>
    </AuthProvider>
    </ThemeProvider>
    </I18nProvider>
  )
}

function LoginGuard() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user) return <Navigate to="/" replace />
  return <Login />
}
