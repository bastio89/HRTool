import { useState, useCallback } from 'react'
import { useAuth } from '../AuthContext'

const DEFAULT_WIDGETS = [
  { id: 'stats', label: 'Statistiken', icon: 'BarChart2', visible: true },
  { id: 'pipelines', label: 'Aktive Pipelines', icon: 'GitBranch', visible: true },
  { id: 'matches', label: 'Letzte Matchings', icon: 'GitCompare', visible: true },
  { id: 'locations', label: 'Top Standorte', icon: 'MapPin', visible: true },
  { id: 'sources', label: 'Quellen-Analyse', icon: 'Share2', visible: true },
  { id: 'timetohire', label: 'Time-to-Hire', icon: 'Timer', visible: true },
  { id: 'dsgvo', label: 'DSGVO-Status', icon: 'ShieldAlert', visible: true },
  { id: 'calendar', label: 'Interviews', icon: 'Calendar', visible: true },
]

function getStorageKey(userId) {
  return `hrtool_dashboard_widgets_${userId || 'default'}`
}

export function useWidgetConfig() {
  const { user } = useAuth()

  const [widgets, setWidgets] = useState(() => {
    try {
      const stored = localStorage.getItem(getStorageKey(user?.id))
      if (stored) {
        const parsed = JSON.parse(stored)
        // Merge with defaults to handle new widgets added later
        const storedIds = parsed.map(w => w.id)
        const merged = [...parsed]
        for (const dw of DEFAULT_WIDGETS) {
          if (!storedIds.includes(dw.id)) {
            merged.push({ ...dw })
          }
        }
        return merged
      }
    } catch {}
    return DEFAULT_WIDGETS.map(w => ({ ...w }))
  })

  const save = useCallback((newWidgets) => {
    setWidgets(newWidgets)
    try {
      localStorage.setItem(getStorageKey(user?.id), JSON.stringify(newWidgets))
    } catch {}
  }, [user?.id])

  const toggleWidget = useCallback((id) => {
    const updated = widgets.map(w => w.id === id ? { ...w, visible: !w.visible } : w)
    save(updated)
  }, [widgets, save])

  const reorder = useCallback((fromIndex, toIndex) => {
    const updated = [...widgets]
    const [moved] = updated.splice(fromIndex, 1)
    updated.splice(toIndex, 0, moved)
    save(updated)
  }, [widgets, save])

  const resetToDefault = useCallback(() => {
    save(DEFAULT_WIDGETS.map(w => ({ ...w })))
  }, [save])

  const visibleWidgets = widgets.filter(w => w.visible)

  return { widgets, visibleWidgets, toggleWidget, reorder, resetToDefault }
}
