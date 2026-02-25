import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../AuthContext'
import { auditApi } from '../api'
import { useTheme } from '../ThemeContext'
import { Shield, Search, ChevronLeft, ChevronRight, Activity, User, Briefcase, Users, GitBranch, Clock, Filter } from 'lucide-react'

const ENTITY_COLORS = {
  Candidate: { bg: '#e8f5e9', text: '#2e7d32', darkBg: '#1b3a1e', darkText: '#66bb6a' },
  Job:       { bg: '#e3f2fd', text: '#1565c0', darkBg: '#0d2744', darkText: '#42a5f5' },
  Pipeline:  { bg: '#fff3e0', text: '#e65100', darkBg: '#3d2200', darkText: '#ff9800' },
  User:      { bg: '#f3e5f5', text: '#7b1fa2', darkBg: '#2a0e38', darkText: '#ba68c8' },
  System:    { bg: '#fce4ec', text: '#c62828', darkBg: '#3a0e14', darkText: '#ef5350' },
}

const ENTITY_ICONS = {
  Candidate: Users,
  Job: Briefcase,
  Pipeline: GitBranch,
  User: User,
  System: Shield,
}

export default function AuditLog() {
  const { isAdmin } = useAuth()
  const { isDark } = useTheme()
  const [entries, setEntries] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [filters, setFilters] = useState({ entity_type: '', action: '', search: '' })
  const [searchInput, setSearchInput] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, limit: 25, ...filters }
      const [logRes, statsRes] = await Promise.all([
        auditApi.getLog(params),
        page === 1 && !filters.entity_type && !filters.action && !filters.search ? auditApi.getStats() : Promise.resolve(null)
      ])
      setEntries(logRes.data)
      setTotalPages(logRes.pagination.totalPages)
      setTotal(logRes.pagination.total)
      if (statsRes) setStats(statsRes)
    } catch (err) {
      console.error('Audit-Log Fehler:', err)
    } finally {
      setLoading(false)
    }
  }, [page, filters])

  useEffect(() => { loadData() }, [loadData])

  const handleSearch = (e) => {
    e.preventDefault()
    setPage(1)
    setFilters(f => ({ ...f, search: searchInput }))
  }

  const handleFilterChange = (key, value) => {
    setPage(1)
    setFilters(f => ({ ...f, [key]: value }))
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: isDark ? '#aaa' : '#86868b' }}>
        <Shield size={48} style={{ marginBottom: 12, opacity: 0.3 }} />
        <p>Nur Admins haben Zugriff auf das Audit-Log.</p>
      </div>
    )
  }

  const formatDate = (dateStr) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const cardStyle = {
    background: isDark ? '#1c1c1e' : '#fff',
    borderRadius: 16,
    padding: '24px',
    border: `1px solid ${isDark ? '#38383a' : '#e5e5e7'}`,
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h1 style={{
          fontSize: 34, fontWeight: 700, margin: 0,
          color: isDark ? '#f5f5f7' : '#1d1d1f',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif'
        }}>
          Audit-Log
        </h1>
        <p style={{ margin: '8px 0 0', color: isDark ? '#98989d' : '#86868b', fontSize: 17 }}>
          Systemweites Änderungsprotokoll — Wer hat was wann geändert?
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
          <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: isDark ? 'rgba(10,132,255,0.15)' : 'rgba(0,113,227,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Activity size={22} color={isDark ? '#0a84ff' : '#0071e3'} />
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: isDark ? '#f5f5f7' : '#1d1d1f' }}>
                {stats.today}
              </div>
              <div style={{ fontSize: 13, color: isDark ? '#98989d' : '#86868b' }}>Heute</div>
            </div>
          </div>
          <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: isDark ? 'rgba(52,199,89,0.15)' : 'rgba(52,199,89,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Clock size={22} color='#34c759' />
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: isDark ? '#f5f5f7' : '#1d1d1f' }}>
                {stats.thisWeek}
              </div>
              <div style={{ fontSize: 13, color: isDark ? '#98989d' : '#86868b' }}>Diese Woche</div>
            </div>
          </div>
          {stats.byType?.slice(0, 3).map(t => {
            const colors = ENTITY_COLORS[t.entity_type] || ENTITY_COLORS.System
            const Icon = ENTITY_ICONS[t.entity_type] || Activity
            return (
              <div key={t.entity_type} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: isDark ? colors.darkBg : colors.bg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <Icon size={22} color={isDark ? colors.darkText : colors.text} />
                </div>
                <div>
                  <div style={{ fontSize: 28, fontWeight: 700, color: isDark ? '#f5f5f7' : '#1d1d1f' }}>
                    {t.count}
                  </div>
                  <div style={{ fontSize: 13, color: isDark ? '#98989d' : '#86868b' }}>{t.entity_type}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Filters */}
      <div style={{ ...cardStyle, marginBottom: 24, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <Filter size={18} color={isDark ? '#98989d' : '#86868b'} />
        <select
          value={filters.entity_type}
          onChange={e => handleFilterChange('entity_type', e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 10, border: `1px solid ${isDark ? '#38383a' : '#d2d2d7'}`,
            background: isDark ? '#2c2c2e' : '#f5f5f7', color: isDark ? '#f5f5f7' : '#1d1d1f',
            fontSize: 14, outline: 'none', cursor: 'pointer'
          }}
        >
          <option value="">Alle Bereiche</option>
          <option value="Candidate">Bewerber</option>
          <option value="Job">Stellen</option>
          <option value="Pipeline">Pipeline</option>
          <option value="User">Benutzer</option>
          <option value="System">System</option>
        </select>

        <select
          value={filters.action}
          onChange={e => handleFilterChange('action', e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 10, border: `1px solid ${isDark ? '#38383a' : '#d2d2d7'}`,
            background: isDark ? '#2c2c2e' : '#f5f5f7', color: isDark ? '#f5f5f7' : '#1d1d1f',
            fontSize: 14, outline: 'none', cursor: 'pointer'
          }}
        >
          <option value="">Alle Aktionen</option>
          <option value="erstellt">Erstellt</option>
          <option value="aktualisiert">Aktualisiert</option>
          <option value="gelöscht">Gelöscht</option>
          <option value="batch-gelöscht">Batch-Gelöscht</option>
          <option value="batch-status">Batch-Status</option>
          <option value="pipeline-hinzugefügt">Pipeline Hinzugefügt</option>
          <option value="stage-geändert">Stage Geändert</option>
          <option value="benutzer-erstellt">Benutzer Erstellt</option>
          <option value="benutzer-gelöscht">Benutzer Gelöscht</option>
          <option value="passwort-geändert">Passwort Geändert</option>
          <option value="passwort-zurückgesetzt">Passwort Zurückgesetzt</option>
          <option value="backup-erstellt">Backup Erstellt</option>
        </select>

        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, flex: 1, minWidth: 200 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={16} style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              color: isDark ? '#636366' : '#86868b'
            }} />
            <input
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Suche nach Benutzer, Aktion, Objekt..."
              style={{
                width: '100%', padding: '8px 12px 8px 36px', borderRadius: 10,
                border: `1px solid ${isDark ? '#38383a' : '#d2d2d7'}`,
                background: isDark ? '#2c2c2e' : '#f5f5f7', color: isDark ? '#f5f5f7' : '#1d1d1f',
                fontSize: 14, outline: 'none', boxSizing: 'border-box'
              }}
            />
          </div>
          <button type="submit" style={{
            padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer',
            background: isDark ? '#0a84ff' : '#0071e3', color: '#fff', fontSize: 14, fontWeight: 500
          }}>
            Suchen
          </button>
        </form>
      </div>

      {/* Table */}
      <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: isDark ? '#98989d' : '#86868b' }}>
            Lade Audit-Log...
          </div>
        ) : entries.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: isDark ? '#98989d' : '#86868b' }}>
            Keine Einträge gefunden.
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{
                    borderBottom: `1px solid ${isDark ? '#38383a' : '#e5e5e7'}`,
                    background: isDark ? '#2c2c2e' : '#f9f9fb'
                  }}>
                    <th style={thStyle(isDark)}>Zeitpunkt</th>
                    <th style={thStyle(isDark)}>Benutzer</th>
                    <th style={thStyle(isDark)}>Aktion</th>
                    <th style={thStyle(isDark)}>Bereich</th>
                    <th style={thStyle(isDark)}>Objekt</th>
                    <th style={thStyle(isDark)}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(entry => {
                    const colors = ENTITY_COLORS[entry.entity_type] || ENTITY_COLORS.System
                    const Icon = ENTITY_ICONS[entry.entity_type] || Activity
                    return (
                      <tr key={entry.id} style={{
                        borderBottom: `1px solid ${isDark ? '#2c2c2e' : '#f0f0f2'}`,
                        transition: 'background 0.15s'
                      }}
                        onMouseEnter={e => e.currentTarget.style.background = isDark ? '#2c2c2e' : '#f9f9fb'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={tdStyle(isDark)}>
                          <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: 13 }}>
                            {formatDate(entry.created_at)}
                          </span>
                        </td>
                        <td style={tdStyle(isDark)}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <User size={14} color={isDark ? '#98989d' : '#86868b'} />
                            <span style={{ fontWeight: 500 }}>{entry.username || '—'}</span>
                          </div>
                        </td>
                        <td style={tdStyle(isDark)}>
                          <span style={{
                            padding: '3px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                            background: isDark ? 'rgba(10,132,255,0.12)' : 'rgba(0,113,227,0.06)',
                            color: isDark ? '#0a84ff' : '#0071e3'
                          }}>
                            {entry.action}
                          </span>
                        </td>
                        <td style={tdStyle(isDark)}>
                          <div style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '3px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                            background: isDark ? colors.darkBg : colors.bg,
                            color: isDark ? colors.darkText : colors.text
                          }}>
                            <Icon size={12} />
                            {entry.entity_type}
                          </div>
                        </td>
                        <td style={tdStyle(isDark)}>
                          <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                            {entry.entity_label || `#${entry.entity_id || '—'}`}
                          </span>
                        </td>
                        <td style={tdStyle(isDark)}>
                          {entry.details ? (
                            <span style={{
                              fontSize: 12, color: isDark ? '#98989d' : '#86868b',
                              maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block'
                            }}>
                              {typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details)}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '16px 20px', borderTop: `1px solid ${isDark ? '#38383a' : '#e5e5e7'}`,
              fontSize: 13, color: isDark ? '#98989d' : '#86868b'
            }}>
              <span>{total} Einträge gesamt</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  style={paginationBtn(isDark, page <= 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span style={{ fontWeight: 500, color: isDark ? '#f5f5f7' : '#1d1d1f' }}>
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  style={paginationBtn(isDark, page >= totalPages)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function thStyle(isDark) {
  return {
    padding: '12px 16px', textAlign: 'left', fontWeight: 600, fontSize: 12,
    textTransform: 'uppercase', letterSpacing: '0.5px',
    color: isDark ? '#98989d' : '#86868b'
  }
}

function tdStyle(isDark) {
  return {
    padding: '12px 16px', color: isDark ? '#f5f5f7' : '#1d1d1f'
  }
}

function paginationBtn(isDark, disabled) {
  return {
    padding: '6px 8px', borderRadius: 8, border: `1px solid ${isDark ? '#38383a' : '#d2d2d7'}`,
    background: disabled ? 'transparent' : (isDark ? '#2c2c2e' : '#f5f5f7'),
    color: disabled ? (isDark ? '#48484a' : '#d2d2d7') : (isDark ? '#f5f5f7' : '#1d1d1f'),
    cursor: disabled ? 'default' : 'pointer', display: 'flex', alignItems: 'center',
    opacity: disabled ? 0.4 : 1
  }
}
