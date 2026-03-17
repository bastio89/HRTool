import { useState, useEffect, useRef } from 'react'
import { Bell, Check, CheckCheck, MessageSquare, AtSign, X } from 'lucide-react'
import { collaborationApi } from '../api'
import { useI18n } from '../I18nContext'

export default function NotificationBell() {
  const { t } = useI18n()
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)

  // Poll unread count every 30 seconds
  useEffect(() => {
    const fetchCount = () => collaborationApi.getUnreadCount().then(r => setCount(r.count)).catch(() => {})
    fetchCount()
    const interval = setInterval(fetchCount, 30000)
    return () => clearInterval(interval)
  }, [])

  // Close on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const toggleOpen = async () => {
    if (!open) {
      setLoading(true)
      try {
        const res = await collaborationApi.getNotifications({ page: 1 })
        setNotifications(res.data || [])
      } catch (_) {}
      setLoading(false)
    }
    setOpen(!open)
  }

  const markRead = async (id) => {
    await collaborationApi.markRead(id).catch(() => {})
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n))
    setCount(prev => Math.max(0, prev - 1))
  }

  const markAllRead = async () => {
    await collaborationApi.markAllRead().catch(() => {})
    setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })))
    setCount(0)
  }

  const typeIcons = {
    mention: <AtSign className="w-4 h-4 text-[#5e5ce6]" />,
    comment: <MessageSquare className="w-4 h-4 text-[#0071e3]" />,
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggleOpen} className="relative p-2 text-gray-400 hover:text-black dark:hover:text-white hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] rounded-xl transition-all cursor-pointer">
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-[#ff3b30] text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">{count > 9 ? '9+' : count}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[380px] max-h-[480px] bg-white dark:bg-[#2c2c2e] rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
            <h3 className="text-[15px] font-bold text-black dark:text-white">{t('collab.notifications')}</h3>
            <div className="flex items-center gap-2">
              {count > 0 && (
                <button onClick={markAllRead} className="text-[12px] text-[#0071e3] hover:underline font-medium cursor-pointer flex items-center gap-1">
                  <CheckCheck className="w-3 h-3" />{t('collab.mark_all_read')}
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1 text-gray-400 hover:text-black dark:hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-gray-300 border-t-[#5e5ce6] rounded-full animate-spin" />
              </div>
            ) : notifications.length === 0 ? (
              <p className="text-center text-[13px] text-gray-400 py-8">{t('collab.no_notifications')}</p>
            ) : (
              notifications.map(n => (
                <div key={n.id} onClick={() => !n.is_read && markRead(n.id)}
                  className={`flex items-start gap-3 px-4 py-3 border-b border-gray-50 dark:border-gray-700/50 transition-colors cursor-pointer hover:bg-[#f5f5f7] dark:hover:bg-[#3a3a3c] ${!n.is_read ? 'bg-[#0071e3]/5' : ''}`}>
                  <div className="w-8 h-8 rounded-xl bg-[#f5f5f7] dark:bg-[#1c1c1e] flex items-center justify-center flex-shrink-0">
                    {typeIcons[n.type] || <Bell className="w-4 h-4 text-gray-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] font-medium ${!n.is_read ? 'text-black dark:text-white' : 'text-gray-500'}`}>{n.title}</p>
                    {n.message && <p className="text-[12px] text-gray-400 mt-0.5 truncate">{n.message}</p>}
                    <p className="text-[11px] text-gray-400 mt-1">{new Date(n.created_at).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  {!n.is_read && <div className="w-2 h-2 rounded-full bg-[#0071e3] mt-2 flex-shrink-0" />}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
