import { useState } from 'react'
import { useAuth } from '../AuthContext'
import { Command, LogIn, AlertCircle } from 'lucide-react'

export default function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
    } catch (err) {
      setError(err.message || 'Anmeldung fehlgeschlagen')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f5f7] dark:bg-black flex items-center justify-center selection:bg-[#0071e3] selection:text-white" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif' }}>
      <div className="w-full max-w-[420px] mx-4">
        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-16 h-16 bg-black rounded-[22px] flex items-center justify-center shadow-lg mb-5">
            <Command className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-[28px] font-semibold tracking-tight text-black dark:text-white">HR System</h1>
          <p className="text-[16px] text-gray-500 dark:text-gray-400 mt-1">Melde dich an, um fortzufahren</p>
        </div>

        {/* Login Card */}
        <div className="bg-white dark:bg-[#1c1c1e] rounded-[32px] p-10 shadow-[0_2px_20px_rgba(0,0,0,0.06)] border border-gray-200/60 dark:border-gray-700">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="flex items-center gap-3 bg-[#fff5f5] dark:bg-[#3a1c1c] text-[#ff3b30] text-[14px] font-medium px-5 py-3.5 rounded-2xl border border-red-100 dark:border-red-900">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <div>
              <label className="block text-[14px] font-medium text-gray-700 dark:text-gray-300 mb-2 ml-1">Benutzername</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-5 py-3.5 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-gray-200/60 dark:border-gray-700 text-[16px] dark:text-white outline-none focus:ring-2 focus:ring-[#0071e3]/30 focus:border-[#0071e3] transition-all"
                placeholder="Benutzername eingeben"
                autoFocus
                required
              />
            </div>

            <div>
              <label className="block text-[14px] font-medium text-gray-700 dark:text-gray-300 mb-2 ml-1">Passwort</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-5 py-3.5 rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-gray-200/60 dark:border-gray-700 text-[16px] dark:text-white outline-none focus:ring-2 focus:ring-[#0071e3]/30 focus:border-[#0071e3] transition-all"
                placeholder="Passwort eingeben"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="flex items-center justify-center gap-2 w-full py-4 bg-[#0071e3] hover:bg-[#0077ED] disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white rounded-2xl text-[16px] font-semibold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 disabled:hover:translate-y-0 disabled:hover:shadow-md duration-300 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <LogIn className="w-5 h-5" />
                  Anmelden
                </>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[13px] text-gray-400 dark:text-gray-500 mt-6">
          Standardzugang: admin / admin123
        </p>
      </div>
    </div>
  )
}
