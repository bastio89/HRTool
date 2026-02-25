import { useState, useRef } from 'react'
import { X, Printer, EyeOff, Eye, MapPin, Briefcase, GraduationCap, Globe, Award, Car, Clock, Mail, Phone, DollarSign } from 'lucide-react'

const STATUS_STYLES = {
  'Aktiv':      { bg: '#34c759', text: '#fff' },
  'Passiv':     { bg: '#ff9f0a', text: '#fff' },
  'In Prozess': { bg: '#0071e3', text: '#fff' },
  'Blacklist':  { bg: '#ff3b30', text: '#fff' },
}

function anonymizeName(name) {
  if (!name) return '—'
  const parts = name.split(' ')
  if (parts.length <= 1) return parts[0][0] + '***'
  return parts[0][0] + '*** ' + parts.slice(1).map(p => p[0] + '***').join(' ')
}

function anonymizeEmail(email) {
  if (!email) return null
  const [local, domain] = email.split('@')
  if (!domain) return '***@***'
  return local[0] + '***@' + domain
}

function anonymizePhone(phone) {
  if (!phone) return null
  return phone.slice(0, 4) + '****' + phone.slice(-2)
}

export default function CandidatePrintProfile({ candidate, open, onClose }) {
  const [anonymized, setAnonymized] = useState(false)
  const printRef = useRef(null)

  if (!open || !candidate) return null

  const status = candidate.status || 'Aktiv'
  const tags = candidate.tags ? candidate.tags.split(',').map(t => t.trim()).filter(Boolean) : []
  const skills = candidate.skills ? candidate.skills.split(',').map(s => s.trim()).filter(Boolean) : []
  const statusStyle = STATUS_STYLES[status] || STATUS_STYLES['Aktiv']

  const displayName = anonymized ? anonymizeName(candidate.name) : candidate.name
  const displayEmail = anonymized ? anonymizeEmail(candidate.email) : candidate.email
  const displayPhone = anonymized ? anonymizePhone(candidate.phone) : candidate.phone
  const initials = candidate.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

  const handlePrint = () => {
    const printContent = printRef.current
    if (!printContent) return

    const printWindow = window.open('', '_blank')
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bewerberprofil – ${anonymized ? anonymizeName(candidate.name) : candidate.name}</title>
        <style>
          @page { margin: 20mm 15mm; size: A4; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif; color: #1d1d1f; line-height: 1.5; background: #fff; }
          .header { display: flex; align-items: center; gap: 20px; padding-bottom: 20px; margin-bottom: 24px; border-bottom: 2px solid #e5e5e7; }
          .avatar { width: 64px; height: 64px; border-radius: 50%; background: #f5f5f7; display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 600; color: #86868b; flex-shrink: 0; }
          .header-info h1 { font-size: 26px; font-weight: 600; letter-spacing: -0.3px; }
          .status-badge { display: inline-block; padding: 3px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; color: ${statusStyle.text}; background: ${statusStyle.bg}; margin-top: 4px; }
          .section { margin-bottom: 22px; }
          .section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #86868b; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #f0f0f0; }
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 32px; }
          .info-item { display: flex; align-items: flex-start; gap: 8px; }
          .info-label { font-size: 12px; font-weight: 600; color: #86868b; text-transform: uppercase; letter-spacing: 0.8px; }
          .info-value { font-size: 15px; font-weight: 500; color: #1d1d1f; }
          .tags-container, .skills-container { display: flex; flex-wrap: wrap; gap: 6px; }
          .skill-tag { padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 500; background: #f5f5f7; color: #1d1d1f; }
          .tag { padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; background: #0071e3; color: #fff; opacity: 0.85; }
          .text-block { font-size: 15px; color: #1d1d1f; white-space: pre-line; line-height: 1.6; }
          .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e5e5e7; font-size: 11px; color: #86868b; text-align: center; }
          .anonymized-note { font-size: 11px; color: #ff9f0a; font-weight: 500; margin-top: 4px; }
        </style>
      </head>
      <body>
        ${printContent.innerHTML}
        <div class="footer">
          Generiert am ${new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })} · HR-Tool${anonymized ? ' · Anonymisiertes Profil' : ''}
        </div>
      </body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    setTimeout(() => {
      printWindow.print()
      printWindow.close()
    }, 300)
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-[#1c1c1e] rounded-[24px] shadow-2xl w-full max-w-[800px] max-h-[90vh] overflow-hidden flex flex-col mx-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <h3 className="text-[18px] font-semibold text-black dark:text-white">Druckvorschau</h3>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAnonymized(!anonymized)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-[14px] font-medium transition-all cursor-pointer ${
                anonymized
                  ? 'bg-[#ff9f0a]/10 text-[#ff9f0a]'
                  : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] text-gray-600 dark:text-gray-400 hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c]'
              }`}
            >
              {anonymized ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {anonymized ? 'Anonymisiert' : 'Anonymisieren'}
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-5 py-2 rounded-full bg-black dark:bg-white text-white dark:text-black text-[14px] font-semibold hover:opacity-80 transition-all cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              Drucken
            </button>
            <button
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-[#f5f5f7] dark:bg-[#2c2c2e] flex items-center justify-center hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Print Preview */}
        <div className="overflow-y-auto flex-1 p-8 bg-[#f5f5f7] dark:bg-[#000]">
          <div ref={printRef} className="bg-white rounded-[16px] shadow-lg p-10 max-w-[700px] mx-auto" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif" }}>
            {/* Header */}
            <div className="header" style={{ display: 'flex', alignItems: 'center', gap: '20px', paddingBottom: '20px', marginBottom: '24px', borderBottom: '2px solid #e5e5e7' }}>
              <div className="avatar" style={{ width: '64px', height: '64px', borderRadius: '50%', background: '#f5f5f7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', fontWeight: 600, color: '#86868b', flexShrink: 0 }}>
                {anonymized ? '?' : initials}
              </div>
              <div>
                <h1 style={{ fontSize: '26px', fontWeight: 600, letterSpacing: '-0.3px', color: '#1d1d1f', margin: 0 }}>{displayName}</h1>
                <span className="status-badge" style={{ display: 'inline-block', padding: '3px 14px', borderRadius: '20px', fontSize: '13px', fontWeight: 600, color: statusStyle.text, background: statusStyle.bg, marginTop: '4px' }}>
                  {status}
                </span>
                {anonymized && (
                  <p style={{ fontSize: '11px', color: '#ff9f0a', fontWeight: 500, marginTop: '4px' }}>Anonymisiertes Profil</p>
                )}
              </div>
            </div>

            {/* Kontaktdaten */}
            {(displayEmail || displayPhone || candidate.location) && (
              <div className="section" style={{ marginBottom: '22px' }}>
                <div className="section-title" style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#86868b', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid #f0f0f0' }}>Kontaktdaten</div>
                <div className="info-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 32px' }}>
                  {displayEmail && (
                    <div>
                      <div className="info-label" style={{ fontSize: '12px', fontWeight: 600, color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.8px' }}>E-Mail</div>
                      <div className="info-value" style={{ fontSize: '15px', fontWeight: 500, color: '#1d1d1f' }}>{displayEmail}</div>
                    </div>
                  )}
                  {displayPhone && (
                    <div>
                      <div className="info-label" style={{ fontSize: '12px', fontWeight: 600, color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Telefon</div>
                      <div className="info-value" style={{ fontSize: '15px', fontWeight: 500, color: '#1d1d1f' }}>{displayPhone}</div>
                    </div>
                  )}
                  {candidate.location && !anonymized && (
                    <div>
                      <div className="info-label" style={{ fontSize: '12px', fontWeight: 600, color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Standort</div>
                      <div className="info-value" style={{ fontSize: '15px', fontWeight: 500, color: '#1d1d1f' }}>{candidate.location}</div>
                    </div>
                  )}
                  {candidate.location && anonymized && (
                    <div>
                      <div className="info-label" style={{ fontSize: '12px', fontWeight: 600, color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Region</div>
                      <div className="info-value" style={{ fontSize: '15px', fontWeight: 500, color: '#1d1d1f' }}>{candidate.location.split(',')[0].split(' ').slice(-1)[0]}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Qualifikation */}
            {(candidate.experience || candidate.education || candidate.availability || candidate.desired_salary) && (
              <div className="section" style={{ marginBottom: '22px' }}>
                <div className="section-title" style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#86868b', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid #f0f0f0' }}>Qualifikation</div>
                <div className="info-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 32px' }}>
                  {candidate.experience && (
                    <div>
                      <div className="info-label" style={{ fontSize: '12px', fontWeight: 600, color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Berufserfahrung</div>
                      <div className="info-value" style={{ fontSize: '15px', fontWeight: 500, color: '#1d1d1f' }}>{candidate.experience}</div>
                    </div>
                  )}
                  {candidate.education && (
                    <div>
                      <div className="info-label" style={{ fontSize: '12px', fontWeight: 600, color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Ausbildung</div>
                      <div className="info-value" style={{ fontSize: '15px', fontWeight: 500, color: '#1d1d1f' }}>{candidate.education}</div>
                    </div>
                  )}
                  {candidate.availability && (
                    <div>
                      <div className="info-label" style={{ fontSize: '12px', fontWeight: 600, color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Verfügbarkeit</div>
                      <div className="info-value" style={{ fontSize: '15px', fontWeight: 500, color: '#1d1d1f' }}>{candidate.availability}</div>
                    </div>
                  )}
                  {candidate.desired_salary && !anonymized && (
                    <div>
                      <div className="info-label" style={{ fontSize: '12px', fontWeight: 600, color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Gehaltsvorstellung</div>
                      <div className="info-value" style={{ fontSize: '15px', fontWeight: 500, color: '#1d1d1f' }}>{candidate.desired_salary}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Sprachen & Mobilität */}
            {(candidate.languages || candidate.certificates || candidate.drivers_license || candidate.mobility) && (
              <div className="section" style={{ marginBottom: '22px' }}>
                <div className="section-title" style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#86868b', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid #f0f0f0' }}>Sprachen & Mobilität</div>
                <div className="info-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 32px' }}>
                  {candidate.languages && (
                    <div>
                      <div className="info-label" style={{ fontSize: '12px', fontWeight: 600, color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Sprachen</div>
                      <div className="info-value" style={{ fontSize: '15px', fontWeight: 500, color: '#1d1d1f' }}>{candidate.languages}</div>
                    </div>
                  )}
                  {candidate.certificates && (
                    <div>
                      <div className="info-label" style={{ fontSize: '12px', fontWeight: 600, color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Zertifikate</div>
                      <div className="info-value" style={{ fontSize: '15px', fontWeight: 500, color: '#1d1d1f' }}>{candidate.certificates}</div>
                    </div>
                  )}
                  {candidate.drivers_license && (
                    <div>
                      <div className="info-label" style={{ fontSize: '12px', fontWeight: 600, color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Führerschein</div>
                      <div className="info-value" style={{ fontSize: '15px', fontWeight: 500, color: '#1d1d1f' }}>{candidate.drivers_license}</div>
                    </div>
                  )}
                  {candidate.mobility && (
                    <div>
                      <div className="info-label" style={{ fontSize: '12px', fontWeight: 600, color: '#86868b', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Mobilität</div>
                      <div className="info-value" style={{ fontSize: '15px', fontWeight: 500, color: '#1d1d1f' }}>{candidate.mobility}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Skills */}
            {skills.length > 0 && (
              <div className="section" style={{ marginBottom: '22px' }}>
                <div className="section-title" style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#86868b', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid #f0f0f0' }}>Skills</div>
                <div className="skills-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {skills.map((s, i) => (
                    <span key={i} className="skill-tag" style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: 500, background: '#f5f5f7', color: '#1d1d1f' }}>{s}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Tags */}
            {tags.length > 0 && (
              <div className="section" style={{ marginBottom: '22px' }}>
                <div className="section-title" style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#86868b', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid #f0f0f0' }}>Tags</div>
                <div className="tags-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {tags.map((t, i) => (
                    <span key={i} className="tag" style={{ padding: '4px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: 600, background: '#0071e3', color: '#fff', opacity: 0.85 }}>{t}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Notizen */}
            {candidate.notes && !anonymized && (
              <div className="section" style={{ marginBottom: '22px' }}>
                <div className="section-title" style={{ fontSize: '13px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#86868b', marginBottom: '10px', paddingBottom: '6px', borderBottom: '1px solid #f0f0f0' }}>Notizen</div>
                <div className="text-block" style={{ fontSize: '15px', color: '#1d1d1f', whiteSpace: 'pre-line', lineHeight: 1.6 }}>{candidate.notes}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
