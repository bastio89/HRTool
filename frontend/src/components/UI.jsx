export function Card({ children, className = '', hover = false, ...props }) {
  return (
    <div 
      className={`bg-white rounded-[20px] sm:rounded-[32px] shadow-[0_8px_30px_rgba(0,0,0,0.04)] border border-gray-100/80 p-5 sm:p-10 ${hover ? 'hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] hover:-translate-y-1 transition-all duration-500' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

export function Button({ children, variant = 'primary', size = 'md', className = '', disabled, ...props }) {
  const variants = {
    primary: 'bg-[#0071e3] hover:bg-[#0077ed] text-white shadow-sm',
    secondary: 'bg-[#f5f5f7] hover:bg-[#e8e8ed] text-black',
    danger: 'bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20 text-[#ff3b30]',
    ghost: 'hover:bg-[#f5f5f7] text-gray-500 hover:text-black',
    dark: 'bg-black hover:bg-gray-800 text-white shadow-sm',
  }

  const sizes = {
    sm: 'px-5 py-2.5 text-[14px] rounded-full',
    md: 'px-7 py-3.5 text-[16px] rounded-full',
    lg: 'px-9 py-4 text-[17px] rounded-full',
  }

  return (
    <button
      className={`inline-flex items-center justify-center gap-2.5 font-medium transition-all duration-300 
        ${variants[variant]} ${sizes[size]} 
        ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer'}
        ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}

export function Input({ label, className = '', ...props }) {
  return (
    <div className="space-y-3">
      {label && (
        <label className="block text-[15px] font-medium text-gray-600 ml-2">
          {label}
        </label>
      )}
      <input
        className={`w-full px-6 py-4 bg-[#f5f5f7] border border-transparent rounded-[20px] 
          text-black text-[16px] placeholder:text-gray-400
          focus:outline-none focus:bg-white focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10
          transition-all duration-300 ${className}`}
        {...props}
      />
    </div>
  )
}

export function Textarea({ label, className = '', ...props }) {
  return (
    <div className="space-y-3">
      {label && (
        <label className="block text-[15px] font-medium text-gray-600 ml-2">
          {label}
        </label>
      )}
      <textarea
        className={`w-full px-6 py-5 bg-[#f5f5f7] border border-transparent rounded-[24px] 
          text-black text-[16px] placeholder:text-gray-400
          focus:outline-none focus:bg-white focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10
          transition-all duration-300 resize-y min-h-[180px] leading-relaxed ${className}`}
        {...props}
      />
    </div>
  )
}

export function ScoreRing({ score, size = 80, strokeWidth = 6 }) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score * circumference)
  
  const getColor = (s) => {
    if (s >= 0.8) return '#34c759'
    if (s >= 0.6) return '#0071e3'
    if (s >= 0.4) return '#ff9f0a'
    return '#ff3b30'
  }

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#f5f5f7" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={getColor(score)}
          strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.5s cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
      </svg>
      <span className="absolute font-semibold text-black tracking-tight" style={{ fontSize: size * 0.24 }}>
        {(score * 100).toFixed(0)}%
      </span>
    </div>
  )
}

export function ScoreBadge({ score }) {
  const getStyle = (s) => {
    if (s >= 0.8) return 'bg-[#34c759]/10 text-[#34c759]'
    if (s >= 0.6) return 'bg-[#0071e3]/10 text-[#0071e3]'
    if (s >= 0.4) return 'bg-[#ff9f0a]/10 text-[#ff9f0a]'
    return 'bg-[#ff3b30]/10 text-[#ff3b30]'
  }

  return (
    <span className={`inline-flex items-center px-4 py-1.5 rounded-full text-[14px] font-semibold tracking-wide ${getStyle(score)}`}>
      {score.toFixed(2)}
    </span>
  )
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      {Icon && (
        <div className="w-24 h-24 rounded-full bg-[#f5f5f7] flex items-center justify-center mb-10">
          <Icon className="w-10 h-10 text-gray-400" />
        </div>
      )}
      <h3 className="text-[28px] font-semibold tracking-tight text-black mb-4">{title}</h3>
      {description && (
        <p className="text-[18px] text-gray-500 max-w-lg mb-12 leading-relaxed">{description}</p>
      )}
      {action}
    </div>
  )
}

export function LoadingSpinner({ text = 'Laden...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-40">
      <div className="w-12 h-12 border-4 border-gray-100 border-t-[#0071e3] rounded-full animate-spin mb-8" />
      <p className="text-[17px] font-medium text-gray-500">{text}</p>
    </div>
  )
}
