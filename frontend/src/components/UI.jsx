export function Card({ children, className = '', hover = false, ...props }) {
  return (
    <div
      className={`bg-white dark:bg-[#1c1c1e] rounded-[20px] sm:rounded-[32px] shadow-[var(--shadow-card)] border border-gray-100/80 dark:border-gray-700/60 p-5 sm:p-10 ${hover ? 'hover:shadow-[var(--shadow-card-hover)] hover:-translate-y-1 transition-all duration-500' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

/**
 * Page shell. Every route renders inside one of these so the content column has
 * the same width everywhere instead of jumping between 1000/1200/1400/1600px.
 *
 *   content – lists, dashboards, detail pages (default)
 *   narrow  – forms and single-column reading views
 *   wide    – board/matrix views that genuinely need the room
 */
const CONTAINER_WIDTHS = {
  narrow: 'max-w-[880px]',
  content: 'max-w-[1400px]',
  wide: 'max-w-[1600px]',
}

export function PageContainer({ width = 'content', className = '', children, ...props }) {
  return (
    <div className={`fade-in w-full ${CONTAINER_WIDTHS[width] || CONTAINER_WIDTHS.content} mx-auto ${className}`} {...props}>
      {children}
    </div>
  )
}

const BUTTON_VARIANTS = {
  primary: 'bg-[#0071e3] hover:bg-[#0077ed] text-white shadow-sm',
  secondary: 'bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] text-black dark:text-white',
  danger: 'bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20 text-[#ff3b30]',
  'danger-solid': 'bg-[#ff3b30] hover:bg-[#ff2d20] text-white shadow-sm',
  success: 'bg-[#34c759]/10 hover:bg-[#34c759]/20 text-[#1f9d55] dark:text-[#7dffaf]',
  ghost: 'hover:bg-[#f5f5f7] dark:hover:bg-[#2c2c2e] text-gray-500 hover:text-black dark:hover:text-white',
  dark: 'bg-black dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-200 text-white dark:text-black shadow-sm',
}

const BUTTON_SIZES = {
  sm: 'px-5 py-2.5 text-[14px] rounded-full',
  md: 'px-7 py-3.5 text-[16px] rounded-full',
  lg: 'px-9 py-4 text-[17px] rounded-full',
}

export function Button({ children, variant = 'primary', size = 'md', className = '', disabled, ...props }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2.5 font-medium transition-all duration-300
        focus:outline-none focus-visible:ring-4 focus-visible:ring-[#0071e3]/25
        ${BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary} ${BUTTON_SIZES[size] || BUTTON_SIZES.md}
        ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer'}
        ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}

const ICON_BUTTON_SIZES = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-12 h-12',
}

const ICON_SIZES = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
  lg: 'w-5.5 h-5.5',
}

/**
 * Round icon-only button. This shape was hand-rolled ~40 times across the app
 * (close buttons, row actions, toolbar buttons); it lives here now so it looks
 * and focuses the same everywhere. `label` is required – it becomes the
 * accessible name and the tooltip.
 */
export function IconButton({ icon: Icon, label, variant = 'secondary', size = 'md', className = '', disabled, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-full transition-all duration-300
        focus:outline-none focus-visible:ring-4 focus-visible:ring-[#0071e3]/25
        ${BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.secondary} ${ICON_BUTTON_SIZES[size] || ICON_BUTTON_SIZES.md}
        ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer'}
        ${className}`}
      disabled={disabled}
      {...props}
    >
      {Icon && <Icon className={ICON_SIZES[size] || ICON_SIZES.md} />}
    </button>
  )
}

export function Input({ label, className = '', ...props }) {
  return (
    <div className="space-y-3">
      {label && (
        <label className="block text-[15px] font-medium text-gray-600 dark:text-gray-400 ml-2">
          {label}
        </label>
      )}
      <input
        className={`w-full px-6 py-4 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-transparent rounded-[20px]
          text-black dark:text-white text-[16px] placeholder:text-gray-400
          focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c] focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10
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
        <label className="block text-[15px] font-medium text-gray-600 dark:text-gray-400 ml-2">
          {label}
        </label>
      )}
      <textarea
        className={`w-full px-6 py-5 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-transparent rounded-[24px]
          text-black dark:text-white text-[16px] placeholder:text-gray-400
          focus:outline-none focus:bg-white dark:focus:bg-[#3a3a3c] focus:border-[#0071e3]/30 focus:ring-4 focus:ring-[#0071e3]/10
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
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--apple-surface)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={getColor(score)}
          strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.5s cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
      </svg>
      <span className="absolute font-semibold text-black dark:text-white tracking-tight" style={{ fontSize: size * 0.24 }}>
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

/**
 * `size` keeps this usable inside modals and small cards – the old fixed
 * py-32 made it unusable anywhere but a full page.
 */
const EMPTY_SIZES = {
  sm: { wrap: 'py-10', icon: 'w-14 h-14 mb-5', glyph: 'w-6 h-6', title: 'text-[18px] mb-2', desc: 'text-[15px] mb-6' },
  md: { wrap: 'py-20', icon: 'w-20 h-20 mb-7', glyph: 'w-8 h-8', title: 'text-[22px] mb-3', desc: 'text-[16px] mb-8' },
  lg: { wrap: 'py-32', icon: 'w-24 h-24 mb-10', glyph: 'w-10 h-10', title: 'text-[28px] mb-4', desc: 'text-[18px] mb-12' },
}

export function EmptyState({ icon: Icon, title, description, action, size = 'md', className = '' }) {
  const s = EMPTY_SIZES[size] || EMPTY_SIZES.md
  return (
    <div className={`flex flex-col items-center justify-center text-center ${s.wrap} ${className}`}>
      {Icon && (
        <div className={`${s.icon} rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center`}>
          <Icon className={`${s.glyph} text-gray-400`} />
        </div>
      )}
      <h3 className={`${s.title} font-semibold tracking-tight text-black dark:text-white`}>{title}</h3>
      {description && (
        <p className={`${s.desc} text-gray-500 dark:text-gray-400 max-w-lg leading-relaxed`}>{description}</p>
      )}
      {action}
    </div>
  )
}

const SPINNER_SIZES = {
  sm: { wrap: 'py-8', ring: 'w-6 h-6 border-2 mb-3', text: 'text-[14px]' },
  md: { wrap: 'py-20', ring: 'w-10 h-10 border-[3px] mb-5', text: 'text-[16px]' },
  lg: { wrap: 'py-40', ring: 'w-12 h-12 border-4 mb-8', text: 'text-[17px]' },
}

export function LoadingSpinner({ text = 'Laden...', size = 'md', className = '' }) {
  const s = SPINNER_SIZES[size] || SPINNER_SIZES.md
  return (
    <div className={`flex flex-col items-center justify-center ${s.wrap} ${className}`} role="status" aria-live="polite">
      <div className={`${s.ring} border-gray-100 dark:border-gray-700 border-t-[#0071e3] rounded-full animate-spin`} />
      {text && <p className={`${s.text} font-medium text-gray-500`}>{text}</p>}
    </div>
  )
}

/** Shimmer placeholder – preferred over a spinner for lists and cards, because
 *  it reserves the final layout and avoids the content jump on load. */
export function Skeleton({ className = '', rounded = 'rounded-[12px]' }) {
  return <div aria-hidden="true" className={`skeleton ${rounded} ${className}`} />
}

export function SkeletonList({ rows = 5, className = '' }) {
  return (
    <div className={`space-y-4 ${className}`} role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Laden...</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="bg-white dark:bg-[#1c1c1e] rounded-[20px] sm:rounded-[32px] border border-gray-100/80 dark:border-gray-700/60 p-5 sm:p-8 flex items-center gap-5"
        >
          <Skeleton className="w-14 h-14 flex-shrink-0" rounded="rounded-full" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-8 w-24" rounded="rounded-full" />
        </div>
      ))}
    </div>
  )
}
