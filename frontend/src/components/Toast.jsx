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

// Solid card surface with a coloured accent, instead of a 10% tint on a blur.
// The old translucent version was close to unreadable on a white page.
const COLORS = {
  success: { border: 'border-[#34c759]/40', text: 'text-[#1f9d55] dark:text-[#7dffaf]', rail: 'bg-[#34c759]' },
  error: { border: 'border-[#ff3b30]/40', text: 'text-[#d92d20] dark:text-[#ff8a80]', rail: 'bg-[#ff3b30]' },
  warning: { border: 'border-[#ff9f0a]/40', text: 'text-[#b26a00] dark:text-[#ffc46b]', rail: 'bg-[#ff9f0a]' },
  info: { border: 'border-[#0071e3]/40', text: 'text-[#0071e3] dark:text-[#0a84ff]', rail: 'bg-[#0071e3]' },
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
      <div
        className="fixed bottom-6 right-6 layer-toast flex flex-col gap-3 pointer-events-none max-w-[calc(100vw-3rem)]"
        role="region"
        aria-label="Benachrichtigungen"
      >
        {toasts.map(t => {
          const Icon = ICONS[t.type]
          const colors = COLORS[t.type]
          return (
            <div
              key={t.id}
              role={t.type === 'error' ? 'alert' : 'status'}
              aria-live={t.type === 'error' ? 'assertive' : 'polite'}
              className={`pointer-events-auto relative flex items-center gap-3 pl-6 pr-4 py-4 rounded-2xl border overflow-hidden
                bg-white dark:bg-[#1c1c1e] shadow-[var(--shadow-overlay)] ${colors.border}
                min-w-[280px] max-w-[420px]`}
              style={{ animation: 'slideIn 0.3s ease-out' }}
            >
              <span className={`absolute left-0 top-0 bottom-0 w-1.5 ${colors.rail}`} aria-hidden="true" />
              <Icon className={`w-5 h-5 flex-shrink-0 ${colors.text}`} />
              <span className="text-[14px] font-medium text-black dark:text-white flex-1">{t.message}</span>
              <button
                onClick={() => removeToast(t.id)}
                aria-label="Benachrichtigung schließen"
                className="w-6 h-6 rounded-full hover:bg-black/5 dark:hover:bg-white/10 flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-[#0071e3]/25"
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
