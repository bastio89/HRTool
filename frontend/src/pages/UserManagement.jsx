import { useState, useEffect } from 'react'
import { useAuth } from '../AuthContext'
import { useI18n } from '../I18nContext'
import { authApi } from '../api'
import { UserPlus, Trash2, Shield, User, AlertCircle, CheckCircle, Key, Lock, Database, Download } from 'lucide-react'
import PasswordStrength, { isPasswordValid } from '../components/PasswordStrength'
import { useToast } from '../components/Toast'

export default function UserManagement() {
  const { user: currentUser, isAdmin } = useAuth()
  const { t } = useI18n()
  const toast = useToast()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', display_name: '', role: 'recruiter' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)
  const [resetUserId, setResetUserId] = useState(null)
  const [resetPassword, setResetPassword] = useState('')
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [changeForm, setChangeForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [backupLoading, setBackupLoading] = useState(false)

  const handleBackup = async () => {
    setBackupLoading(true)
    setError('')
    setSuccess('')
    try {
      const token = localStorage.getItem('hrtool_token')
      const response = await fetch('/api/auth/admin/backup', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: t('users.backup_error') }))
        throw new Error(err.error)
      }
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `hrtool-backup-${new Date().toISOString().slice(0, 10)}.db`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      a.remove()
      setSuccess(t('users.backup_success'))
    } catch (err) {
      setError(err.message)
    } finally {
      setBackupLoading(false)
    }
  }

  const loadUsers = async () => {
    try {
      const res = await authApi.getUsers()
      setUsers(res.data || res)
    } catch {
      setError(t('users.load_error'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadUsers() }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (!isPasswordValid(form.password)) {
      setError(t('users.password_complexity'))
      return
    }
    setSaving(true)
    try {
      await authApi.createUser(form)
      toast.success(t('users.user_created').replace('{name}', form.username))
      setSuccess(t('users.user_created').replace('{name}', form.username))
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
    if (!confirm(t('users.delete_confirm').replace('{name}', username))) return
    setError('')
    setSuccess('')
    try {
      await authApi.deleteUser(id)
      toast.success(t('users.user_deleted').replace('{name}', username))
      setSuccess(t('users.user_deleted').replace('{name}', username))
      loadUsers()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleResetPassword = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (!isPasswordValid(resetPassword)) {
      setError(t('users.password_complexity'))
      return
    }
    setSaving(true)
    try {
      const user = users.find(u => u.id === resetUserId)
      await authApi.resetPassword(resetUserId, resetPassword)
      toast.success(t('users.password_reset').replace('{name}', user?.display_name))
      setSuccess(t('users.password_reset').replace('{name}', user?.display_name))
      setResetUserId(null)
      setResetPassword('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleChangeOwnPassword = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (changeForm.newPassword !== changeForm.confirmPassword) {
      setError(t('users.password_mismatch'))
      return
    }
    if (!isPasswordValid(changeForm.newPassword)) {
      setError(t('users.password_complexity'))
      return
    }
    setSaving(true)
    try {
      await authApi.changePassword(changeForm.currentPassword, changeForm.newPassword)
      toast.success(t('users.password_changed'))
      setSuccess(t('users.password_changed_desc'))
      setShowChangePassword(false)
      setChangeForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="text-center py-20">
        <Shield className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <p className="text-[18px] text-gray-500 dark:text-gray-400 font-medium">{t('users.admin_only')}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-[34px] font-bold tracking-tight text-black dark:text-white">{t('users.heading')}</h1>
          <p className="text-[16px] text-gray-500 dark:text-gray-400 mt-1">{users.length} {t('users.registered_count')}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleBackup}
            disabled={backupLoading}
            className="flex items-center gap-2 px-6 py-3.5 bg-[#34c759]/10 hover:bg-[#34c759]/20 text-[#34c759] rounded-2xl text-[15px] font-semibold transition-all duration-300 cursor-pointer disabled:opacity-50"
          >
            <Database className="w-4 h-4" />
            {backupLoading ? t('users.backup_creating') : t('users.backup')}
          </button>
          <button
            onClick={() => { setShowChangePassword(!showChangePassword); setShowForm(false); setResetUserId(null); setError(''); setSuccess('') }}
            className="flex items-center gap-2 px-6 py-3.5 bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] text-gray-700 dark:text-gray-300 rounded-2xl text-[15px] font-semibold transition-all duration-300 cursor-pointer"
          >
            <Lock className="w-4 h-4" />
            {t('users.my_password')}
          </button>
          <button
            onClick={() => { setShowForm(!showForm); setShowChangePassword(false); setResetUserId(null); setError(''); setSuccess('') }}
            className="flex items-center gap-2 px-6 py-3.5 bg-[#0071e3] hover:bg-[#0077ED] text-white rounded-2xl text-[15px] font-semibold transition-all shadow-md hover:shadow-lg hover:-translate-y-0.5 duration-300 cursor-pointer"
          >
            <UserPlus className="w-5 h-5" />
            {t('users.new_user')}
          </button>
        </div>
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
        <div className="bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[24px] p-8 mb-8 border border-gray-200/6 dark:border-gray-700/60 dark:border-gray-700/60">
          <h2 className="text-[20px] font-semibold text-black dark:text-white mb-6">{t('users.create_user')}</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-5">
            <div>
              <label className="block text-[14px] font-medium text-gray-700 dark:text-gray-300 mb-2 ml-1">{t('users.username')}</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="w-full px-5 py-3.5 rounded-2xl bg-white dark:bg-[#1c1c1e] border border-gray-200/6 dark:border-gray-700/60 dark:border-gray-700/60 text-[15px] outline-none focus:ring-2 focus:ring-[#0071e3]/30 focus:border-[#0071e3] transition-all"
                placeholder={t('users.username_placeholder')}
                required
              />
            </div>
            <div>
              <label className="block text-[14px] font-medium text-gray-700 dark:text-gray-300 mb-2 ml-1">{t('users.password')}</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full px-5 py-3.5 rounded-2xl bg-white dark:bg-[#1c1c1e] border border-gray-200/6 dark:border-gray-700/60 dark:border-gray-700/60 text-[15px] outline-none focus:ring-2 focus:ring-[#0071e3]/30 focus:border-[#0071e3] transition-all"
                placeholder={t('users.password_hint')}
                required
                minLength={8}
              />
              <PasswordStrength password={form.password} />
            </div>
            <div>
              <label className="block text-[14px] font-medium text-gray-700 dark:text-gray-300 mb-2 ml-1">{t('users.display_name')}</label>
              <input
                type="text"
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                className="w-full px-5 py-3.5 rounded-2xl bg-white dark:bg-[#1c1c1e] border border-gray-200/6 dark:border-gray-700/60 dark:border-gray-700/60 text-[15px] outline-none focus:ring-2 focus:ring-[#0071e3]/30 focus:border-[#0071e3] transition-all"
                placeholder={t('users.display_name_placeholder')}
                required
              />
            </div>
            <div>
              <label className="block text-[14px] font-medium text-gray-700 dark:text-gray-300 mb-2 ml-1">{t('users.role')}</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full px-5 py-3.5 rounded-2xl bg-white dark:bg-[#1c1c1e] border border-gray-200/6 dark:border-gray-700/60 dark:border-gray-700/60 text-[15px] outline-none focus:ring-2 focus:ring-[#0071e3]/30 focus:border-[#0071e3] transition-all appearance-none"
              >
                <option value="recruiter">Recruiter</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="col-span-2 flex justify-end gap-3 mt-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-6 py-3 text-[15px] font-medium text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-3 bg-[#0071e3] hover:bg-[#0077ED] disabled:bg-gray-300 text-white rounded-2xl text-[15px] font-semibold transition-all duration-300 disabled:cursor-not-allowed"
              >
                {saving ? t('users.creating') : t('users.create')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Change own password form */}
      {showChangePassword && (
        <div className="bg-[#f5f5f7] dark:bg-[#2c2c2e] rounded-[24px] p-8 mb-8 border border-gray-200/6 dark:border-gray-700/60 dark:border-gray-700/60">
          <h2 className="text-[20px] font-semibold text-black dark:text-white mb-6 flex items-center gap-3">
            <Lock className="w-5 h-5 text-[#0071e3]" />
            {t('users.change_password')}
          </h2>
          <form onSubmit={handleChangeOwnPassword} className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div>
              <label className="block text-[14px] font-medium text-gray-700 dark:text-gray-300 mb-2 ml-1">{t('users.current_password')}</label>
              <input
                type="password"
                value={changeForm.currentPassword}
                onChange={(e) => setChangeForm({ ...changeForm, currentPassword: e.target.value })}
                className="w-full px-5 py-3.5 rounded-2xl bg-white dark:bg-[#1c1c1e] border border-gray-200/6 dark:border-gray-700/60 dark:border-gray-700/60 text-[15px] outline-none focus:ring-2 focus:ring-[#0071e3]/30 focus:border-[#0071e3] transition-all"
                required
              />
            </div>
            <div>
              <label className="block text-[14px] font-medium text-gray-700 dark:text-gray-300 mb-2 ml-1">{t('users.new_password')}</label>
              <input
                type="password"
                value={changeForm.newPassword}
                onChange={(e) => setChangeForm({ ...changeForm, newPassword: e.target.value })}
                className="w-full px-5 py-3.5 rounded-2xl bg-white dark:bg-[#1c1c1e] border border-gray-200/6 dark:border-gray-700/60 dark:border-gray-700/60 text-[15px] outline-none focus:ring-2 focus:ring-[#0071e3]/30 focus:border-[#0071e3] transition-all"
                placeholder={t('users.min_password')}
                required
                minLength={8}
              />
              <PasswordStrength password={changeForm.newPassword} />
            </div>
            <div>
              <label className="block text-[14px] font-medium text-gray-700 dark:text-gray-300 mb-2 ml-1">{t('users.confirm_password')}</label>
              <input
                type="password"
                value={changeForm.confirmPassword}
                onChange={(e) => setChangeForm({ ...changeForm, confirmPassword: e.target.value })}
                className="w-full px-5 py-3.5 rounded-2xl bg-white dark:bg-[#1c1c1e] border border-gray-200/6 dark:border-gray-700/60 dark:border-gray-700/60 text-[15px] outline-none focus:ring-2 focus:ring-[#0071e3]/30 focus:border-[#0071e3] transition-all"
                required
                minLength={8}
              />
            </div>
            <div className="sm:col-span-3 flex justify-end gap-3 mt-2">
              <button
                type="button"
                onClick={() => setShowChangePassword(false)}
                className="px-6 py-3 text-[15px] font-medium text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-3 bg-[#0071e3] hover:bg-[#0077ED] disabled:bg-gray-300 text-white rounded-2xl text-[15px] font-semibold transition-all duration-300 disabled:cursor-not-allowed cursor-pointer"
              >
                {saving ? t('users.changing') : t('users.change')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Admin reset password form */}
      {resetUserId && (
        <div className="bg-[#fff8f0] rounded-[24px] p-8 mb-8 border border-[#ff9f0a]/20">
          <h2 className="text-[20px] font-semibold text-black dark:text-white mb-6 flex items-center gap-3">
            <Key className="w-5 h-5 text-[#ff9f0a]" />
            {t('users.reset_for').replace('{name}', users.find(u => u.id === resetUserId)?.display_name)}
          </h2>
          <form onSubmit={handleResetPassword} className="flex flex-col gap-4">
            <div className="flex-1 max-w-md">
              <label className="block text-[14px] font-medium text-gray-700 dark:text-gray-300 mb-2 ml-1">{t('users.new_password')}</label>
              <input
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                className="w-full px-5 py-3.5 rounded-2xl bg-white dark:bg-[#1c1c1e] border border-gray-200/6 dark:border-gray-700/60 dark:border-gray-700/60 text-[15px] outline-none focus:ring-2 focus:ring-[#ff9f0a]/30 focus:border-[#ff9f0a] transition-all"
                placeholder={t('users.password_hint')}
                required
                minLength={8}
              />
              <PasswordStrength password={resetPassword} />
            </div>
            <div className="flex gap-3">
            <button
              type="button"
              onClick={() => { setResetUserId(null); setResetPassword('') }}
              className="px-6 py-3.5 text-[15px] font-medium text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors cursor-pointer"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3.5 bg-[#ff9f0a] hover:bg-[#e8900a] disabled:bg-gray-300 text-white rounded-2xl text-[15px] font-semibold transition-all duration-300 disabled:cursor-not-allowed cursor-pointer"
            >
              {saving ? t('users.resetting') : t('users.reset')}
            </button>
            </div>
          </form>
        </div>
      )}

      {/* Users list */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-[3px] border-gray-200 dark:border-gray-700 border-t-[#0071e3] rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-white dark:bg-[#1c1c1e] rounded-[24px] border border-gray-200/6 dark:border-gray-700/60 dark:border-gray-700/60 shadow-[0_2px_10px_rgba(0,0,0,0.04)] overflow-hidden">
          {users.map((u, i) => (
            <div key={u.id} className={`flex items-center justify-between px-8 py-5 ${i > 0 ? 'border-t border-gray-100 dark:border-gray-700' : ''}`}>
              <div className="flex items-center gap-5">
                <img
                  src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${u.display_name || u.username}`}
                  alt={u.display_name}
                  className="w-11 h-11 rounded-full bg-gray-100 dark:bg-[#2c2c2e] border border-gray-200 dark:border-gray-700"
                />
                <div>
                  <p className="text-[16px] font-semibold text-black dark:text-white">{u.display_name}</p>
                  <p className="text-[14px] text-gray-500 dark:text-gray-400">@{u.username}</p>
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
                  <>
                    <button
                      onClick={() => { setResetUserId(u.id); setResetPassword(''); setShowForm(false); setShowChangePassword(false); setError(''); setSuccess('') }}
                      className="p-2.5 text-gray-400 hover:text-[#ff9f0a] hover:bg-orange-50 rounded-xl transition-all cursor-pointer"
                      title={t('users.reset_password')}
                    >
                      <Key className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(u.id, u.username)}
                    className="p-2.5 text-gray-400 hover:text-[#ff3b30] hover:bg-red-50 rounded-xl transition-all"
                    title={t('users.delete_user')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
