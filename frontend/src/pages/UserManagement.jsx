import { useState, useEffect } from 'react'
import { useAuth } from '../AuthContext'
import { authApi } from '../api'
import { UserPlus, Trash2, Shield, User, AlertCircle, CheckCircle } from 'lucide-react'

export default function UserManagement() {
  const { user: currentUser, isAdmin } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', display_name: '', role: 'recruiter' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  const loadUsers = async () => {
    try {
      const res = await authApi.getUsers()
      setUsers(res.data || res)
    } catch {
      setError('Benutzer konnten nicht geladen werden')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadUsers() }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setSaving(true)
    try {
      await authApi.createUser(form)
      setSuccess(`Benutzer "${form.username}" wurde erstellt`)
      setForm({ username: '', password: '', display_name: '', role: 'recruiter' })
      setShowForm(false)
      loadUsers()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id, username) => {
    if (!confirm(`Benutzer "${username}" wirklich löschen?`)) return
    setError('')
    setSuccess('')
    try {
      await authApi.deleteUser(id)
      setSuccess(`Benutzer "${username}" wurde gelöscht`)
      loadUsers()
    } catch (err) {
      setError(err.message)
    }
  }

  if (!isAdmin) {
    return (
      <div className="text-center py-20">
        <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <p className="text-[18px] text-gray-500 font-medium">Nur Administratoren haben Zugriff auf die Benutzerverwaltung.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-[34px] font-bold tracking-tight text-black">Benutzer</h1>
          <p className="text-[16px] text-gray-500 mt-1">{users.length} Benutzer registriert</p>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setError(''); setSuccess('') }}
          className="flex items-center gap-2 px-6 py-3.5 bg-[#0071e3] hover:bg-[#0077ED] text-white rounded-2xl text-[15px] font-semibold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 duration-300"
        >
          <UserPlus className="w-5 h-5" />
          Neuer Benutzer
        </button>
      </div>

      {/* Feedback messages */}
      {error && (
        <div className="flex items-center gap-3 bg-[#fff5f5] text-[#ff3b30] text-[14px] font-medium px-5 py-3.5 rounded-2xl border border-red-100 mb-6">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-3 bg-[#f0fdf4] text-[#34c759] text-[14px] font-medium px-5 py-3.5 rounded-2xl border border-green-100 mb-6">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          {success}
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="bg-[#f5f5f7] rounded-[24px] p-8 mb-8 border border-gray-200/60">
          <h2 className="text-[20px] font-semibold text-black mb-6">Neuen Benutzer anlegen</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-5">
            <div>
              <label className="block text-[14px] font-medium text-gray-700 mb-2 ml-1">Benutzername</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="w-full px-5 py-3.5 rounded-2xl bg-white border border-gray-200/60 text-[15px] outline-none focus:ring-2 focus:ring-[#0071e3]/30 focus:border-[#0071e3] transition-all"
                placeholder="z.B. jdoe"
                required
              />
            </div>
            <div>
              <label className="block text-[14px] font-medium text-gray-700 mb-2 ml-1">Passwort</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full px-5 py-3.5 rounded-2xl bg-white border border-gray-200/60 text-[15px] outline-none focus:ring-2 focus:ring-[#0071e3]/30 focus:border-[#0071e3] transition-all"
                placeholder="Mindestens 4 Zeichen"
                required
                minLength={4}
              />
            </div>
            <div>
              <label className="block text-[14px] font-medium text-gray-700 mb-2 ml-1">Anzeigename</label>
              <input
                type="text"
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                className="w-full px-5 py-3.5 rounded-2xl bg-white border border-gray-200/60 text-[15px] outline-none focus:ring-2 focus:ring-[#0071e3]/30 focus:border-[#0071e3] transition-all"
                placeholder="z.B. Jane Doe"
                required
              />
            </div>
            <div>
              <label className="block text-[14px] font-medium text-gray-700 mb-2 ml-1">Rolle</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full px-5 py-3.5 rounded-2xl bg-white border border-gray-200/60 text-[15px] outline-none focus:ring-2 focus:ring-[#0071e3]/30 focus:border-[#0071e3] transition-all appearance-none"
              >
                <option value="recruiter">Recruiter</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="col-span-2 flex justify-end gap-3 mt-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-6 py-3 text-[15px] font-medium text-gray-600 hover:text-black transition-colors"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-3 bg-[#0071e3] hover:bg-[#0077ED] disabled:bg-gray-300 text-white rounded-2xl text-[15px] font-semibold transition-all duration-300 disabled:cursor-not-allowed"
              >
                {saving ? 'Wird erstellt...' : 'Erstellen'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users list */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-[3px] border-gray-200 border-t-[#0071e3] rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white rounded-[24px] border border-gray-200/60 shadow-[0_2px_10px_rgba(0,0,0,0.04)] overflow-hidden">
          {users.map((u, i) => (
            <div key={u.id} className={`flex items-center justify-between px-8 py-5 ${i > 0 ? 'border-t border-gray-100' : ''}`}>
              <div className="flex items-center gap-5">
                <img
                  src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${u.display_name || u.username}`}
                  alt={u.display_name}
                  className="w-11 h-11 rounded-full bg-gray-100 border border-gray-200"
                />
                <div>
                  <p className="text-[16px] font-semibold text-black">{u.display_name}</p>
                  <p className="text-[14px] text-gray-500">@{u.username}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[13px] font-semibold ${
                  u.role === 'admin'
                    ? 'bg-purple-50 text-purple-600'
                    : 'bg-blue-50 text-[#0071e3]'
                }`}>
                  {u.role === 'admin' ? <Shield className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                  {u.role === 'admin' ? 'Admin' : 'Recruiter'}
                </span>
                {u.id !== currentUser.id && (
                  <button
                    onClick={() => handleDelete(u.id, u.username)}
                    className="p-2.5 text-gray-400 hover:text-[#ff3b30] hover:bg-red-50 rounded-xl transition-all"
                    title="Benutzer löschen"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
