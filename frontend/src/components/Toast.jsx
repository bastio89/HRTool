import { createContext, useContext, useState, useCallback, useMemo } from 'react'
import { CheckCircle, AlertTriangle, XCircle, Info, X } from 'lucide-react'

const ToastContext = createContext()

export function useToast() {
  return useContext(ToastContext)
}

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
}

const COLORS = {
  success: { bg: 'bg-[#34c759]/10', border: 'border-[#34c759]/20', text: 'text-[#34c759]' },
  error: { bg: 'bg-[#ff3b30]/10', border: 'border-[#ff3b30]/20', text: 'text-[#ff3b30]' },
  warning: { bg: 'bg-[#ff9f0a]/10', border: 'border-[#ff9f0a]/20', text: 'text-[#ff9f0a]' },
  info: { bg: 'bg-[#0071e3]/10', border: 'border-[#0071e3]/20', text: 'text-[#0071e3]' },
}

let toastId = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'success', duration = 4000) => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, message, type }])
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, duration)
    }
    return id
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useMemo(() => ({
    success: (msg, dur) => addToast(msg, 'success', dur),
    error: (msg, dur) => addToast(msg, 'error', dur ?? 6000),
    warning: (msg, dur) => addToast(msg, 'warning', dur),
    info: (msg, dur) => addToast(msg, 'info', dur),
  }), [addToast])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Toast Container */}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none">
        {toasts.map(t => {
          const Icon = ICONS[t.type]
          const colors = COLORS[t.type]
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-center gap-3 px-5 py-4 rounded-2xl border shadow-lg backdrop-blur-xl
                ${colors.bg} ${colors.border}
                animate-[slideIn_0.3s_ease-out] min-w-[280px] max-w-[420px]`}
              style={{ animation: 'slideIn 0.3s ease-out' }}
            >
              <Icon className={`w-5 h-5 flex-shrink-0 ${colors.text}`} />
              <span className="text-[14px] font-medium text-black dark:text-white flex-1">{t.message}</span>
              <button
                onClick={() => removeToast(t.id)}
                className="w-6 h-6 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5 text-gray-400" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
