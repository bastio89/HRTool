import { useLocation, Link } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'

const routeLabels = {
  '': 'Übersicht',
  'candidates': 'Bewerber',
  'new': 'Neu anlegen',
  'edit': 'Bearbeiten',
  'detail': 'Details',
  'jobs': 'Stellen',
  'matching': 'Matching',
  'results': 'Ergebnisse',
  'history': 'Historie',
  'pipeline': 'Pipeline',
  'admin': 'Administration',
  'users': 'Benutzer',
  'audit': 'Audit-Log',
  'dsgvo': 'DSGVO',
  'ki-transparenz': 'KI-Transparenz',
}

export default function Breadcrumb() {
  const location = useLocation()
  const segments = location.pathname.split('/').filter(Boolean)

  if (segments.length === 0) return null

  const crumbs = []
  let path = ''

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    path += `/${seg}`

    // Skip numeric IDs as standalone crumbs — attach context to the label instead
    if (/^\d+$/.test(seg)) continue

    const label = routeLabels[seg] || seg.charAt(0).toUpperCase() + seg.slice(1)
    const isLast = i === segments.length - 1 || (i === segments.length - 2 && /^\d+$/.test(segments[i + 1]))

    crumbs.push({ label, path, isLast })
  }

  if (crumbs.length === 0) return null

  return (
    <nav className="flex items-center gap-1.5 text-[13px] font-medium mb-6">
      <Link
        to="/"
        className="text-gray-400 dark:text-gray-500 hover:text-[#0071e3] dark:hover:text-[#0a84ff] transition-colors flex items-center"
      >
        <Home className="w-3.5 h-3.5" />
      </Link>
      {crumbs.map((crumb, idx) => (
        <span key={idx} className="flex items-center gap-1.5">
          <ChevronRight className="w-3 h-3 text-gray-300 dark:text-gray-600" />
          {crumb.isLast ? (
            <span className="text-black dark:text-white">{crumb.label}</span>
          ) : (
            <Link
              to={crumb.path}
              className="text-gray-400 dark:text-gray-500 hover:text-[#0071e3] dark:hover:text-[#0a84ff] transition-colors"
            >
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  )
}
