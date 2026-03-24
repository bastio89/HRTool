import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Printer, EyeOff, Eye, MapPin, Briefcase, GraduationCap, Globe, Award, Car, Clock, Mail, Phone, DollarSign } from 'lucide-react'
import { useI18n } from '../I18nContext'

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
  const { t, locale } = useI18n()
  const [anonymized, setAnonymized] = useState(false)
  const printRef = useRef(null)

  if (!open || !candidate) return null

  const status = candidate.status || 'Aktiv'
  const tags = candidate.tags ? candidate.tags.split(',').map(tag => tag.trim()).filter(Boolean) : []
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
        <title>${t('print.candidate_profile')} – ${anonymized ? anonymizeName(candidate.name) : candidate.name}</title>
        <style>
          @page { margin: 16mm 14mm; size: A4; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', sans-serif; color: #1d1d1f; line-height: 1.55; background: #fff; }

          /* Header band */
          .print-header { background: linear-gradient(135deg, #1d1d1f 0%, #3a3a3c 100%); color: #fff; padding: 32px 36px; border-radius: 16px; display: flex; align-items: center; gap: 24px; margin-bottom: 28px; }
          .print-header .avatar { width: 72px; height: 72px; border-radius: 50%; background: rgba(255,255,255,0.15); display: flex; align-items: center; justify-content: center; font-size: 26px; font-weight: 700; color: #fff; flex-shrink: 0; letter-spacing: 1px; border: 2px solid rgba(255,255,255,0.25); }
          .print-header h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.4px; margin-bottom: 4px; }
          .print-header .subtitle { font-size: 14px; font-weight: 500; opacity: 0.7; }
          .status-badge { display: inline-block; padding: 4px 16px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; margin-top: 6px; }
          .anonymized-note { font-size: 11px; color: #ff9f0a; font-weight: 600; margin-top: 6px; }

          /* Sections */
          .section { margin-bottom: 24px; page-break-inside: avoid; }
          .section-card { background: #fafafa; border: 1px solid #e8e8ed; border-radius: 12px; padding: 20px 24px; }
          .section-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 2px; color: #0071e3; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
          .section-title::after { content: ''; flex: 1; height: 1px; background: #e8e8ed; }

          /* Info grid */
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 36px; }
          .info-item {}
          .info-label { font-size: 10px; font-weight: 700; color: #86868b; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px; }
          .info-value { font-size: 14px; font-weight: 500; color: #1d1d1f; line-height: 1.5; }

          /* Tags & Skills */
          .chip-container { display: flex; flex-wrap: wrap; gap: 8px; }
          .skill-chip { display: inline-block; padding: 5px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; background: #f0f0f5; color: #1d1d1f; border: 1px solid #e0e0e5; }
          .tag-chip { display: inline-block; padding: 5px 14px; border-radius: 8px; font-size: 12px; font-weight: 700; background: #0071e3; color: #fff; }

          /* Notes */
          .text-block { font-size: 14px; color: #1d1d1f; white-space: pre-line; line-height: 1.7; background: #f9f9fb; border-left: 3px solid #0071e3; padding: 14px 18px; border-radius: 0 8px 8px 0; }

          /* Footer */
          .footer { margin-top: 36px; padding-top: 14px; border-top: 2px solid #e8e8ed; font-size: 10px; color: #86868b; display: flex; justify-content: space-between; align-items: center; }
          .footer-brand { font-weight: 700; color: #1d1d1f; }
        </style>
      </head>
      <body>
        ${printContent.innerHTML}
        <div class="footer">
          <span class="footer-brand">HR-Tool</span>
          <span>${t('print.generated_on')} ${new Date().toLocaleDateString(locale === 'en' ? 'en-US' : 'de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}${anonymized ? ' · ' + t('print.anonymized_profile') : ''}</span>
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

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-[#1c1c1e] rounded-[24px] shadow-2xl w-full max-w-[800px] max-h-[90vh] overflow-hidden flex flex-col mx-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <h3 className="text-[18px] font-semibold text-black dark:text-white">{t('print.preview_title')}</h3>
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
              {anonymized ? t('print.anonymized') : t('print.anonymize')}
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-5 py-2 rounded-full bg-black dark:bg-white text-white dark:text-black text-[14px] font-semibold hover:opacity-80 transition-all cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              {t('print.print')}
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
        <div className="overflow-y-auto flex-1 p-8 bg-[#f0f0f3] dark:bg-[#000]">
          <div ref={printRef} className="bg-white rounded-[20px] shadow-xl p-0 max-w-[700px] mx-auto overflow-hidden" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif" }}>
            
            {/* Header Banner */}
            <div className="print-header" style={{ background: 'linear-gradient(135deg, #1d1d1f 0%, #3a3a3c 100%)', color: '#fff', padding: '32px 36px', display: 'flex', alignItems: 'center', gap: '24px' }}>
              <div className="avatar" style={{ width: '72px', height: '72px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', fontWeight: 700, color: '#fff', flexShrink: 0, letterSpacing: '1px', border: '2px solid rgba(255,255,255,0.25)' }}>
                {anonymized ? '?' : initials}
              </div>
              <div>
                <h1 style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-0.4px', color: '#fff', margin: 0 }}>{displayName}</h1>
                {candidate.current_position && (
                  <div style={{ fontSize: '14px', fontWeight: 500, opacity: 0.7, marginTop: '2px' }}>{candidate.current_position}{candidate.current_employer ? ` · ${candidate.current_employer}` : ''}</div>
                )}
                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span className="status-badge" style={{ display: 'inline-block', padding: '4px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', color: statusStyle.text, background: statusStyle.bg }}>
                    {status}
                  </span>
                  {candidate.location && !anonymized && (
                    <span style={{ fontSize: '13px', fontWeight: 500, opacity: 0.65 }}>📍 {candidate.location}</span>
                  )}
                  {candidate.location && anonymized && (
                    <span style={{ fontSize: '13px', fontWeight: 500, opacity: 0.65 }}>📍 {candidate.location.split(',')[0].split(' ').slice(-1)[0]}</span>
                  )}
                </div>
                {anonymized && (
                  <p style={{ fontSize: '11px', color: '#ff9f0a', fontWeight: 600, marginTop: '6px' }}>{t('print.anonymized_profile')}</p>
                )}
              </div>
            </div>

            {/* Content area */}
            <div style={{ padding: '28px 36px 36px' }}>

              {/* Kontaktdaten */}
              {(displayEmail || displayPhone) && (
                <div className="section" style={{ marginBottom: '24px' }}>
                  <div className="section-title" style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#0071e3', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {t('print.contact_data')}
                    <span style={{ flex: 1, height: '1px', background: '#e8e8ed', display: 'inline-block' }} />
                  </div>
                  <div className="section-card" style={{ background: '#fafafa', border: '1px solid #e8e8ed', borderRadius: '12px', padding: '20px 24px' }}>
                    <div className="info-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 36px' }}>
                      {displayEmail && (
                        <div>
                          <div className="info-label" style={{ fontSize: '10px', fontWeight: 700, color: '#86868b', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>{t('print.email')}</div>
                          <div className="info-value" style={{ fontSize: '14px', fontWeight: 500, color: '#1d1d1f' }}>{displayEmail}</div>
                        </div>
                      )}
                      {displayPhone && (
                        <div>
                          <div className="info-label" style={{ fontSize: '10px', fontWeight: 700, color: '#86868b', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>{t('print.phone')}</div>
                          <div className="info-value" style={{ fontSize: '14px', fontWeight: 500, color: '#1d1d1f' }}>{displayPhone}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Qualifikation */}
              {(candidate.experience || candidate.education) && (
                <div className="section" style={{ marginBottom: '24px' }}>
                  <div className="section-title" style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#0071e3', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {t('print.qualification')}
                    <span style={{ flex: 1, height: '1px', background: '#e8e8ed', display: 'inline-block' }} />
                  </div>
                  <div className="section-card" style={{ background: '#fafafa', border: '1px solid #e8e8ed', borderRadius: '12px', padding: '20px 24px' }}>
                    <div className="info-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 36px' }}>
                      {candidate.experience && (
                        <div>
                          <div className="info-label" style={{ fontSize: '10px', fontWeight: 700, color: '#86868b', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>{t('print.experience')}</div>
                          <div className="info-value" style={{ fontSize: '14px', fontWeight: 500, color: '#1d1d1f', lineHeight: '1.5' }}>{candidate.experience}</div>
                        </div>
                      )}
                      {candidate.education && (
                        <div>
                          <div className="info-label" style={{ fontSize: '10px', fontWeight: 700, color: '#86868b', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>{t('print.education')}</div>
                          <div className="info-value" style={{ fontSize: '14px', fontWeight: 500, color: '#1d1d1f', lineHeight: '1.5' }}>{candidate.education}</div>
                        </div>
                      )}
                      {candidate.availability && (
                        <div>
                          <div className="info-label" style={{ fontSize: '10px', fontWeight: 700, color: '#86868b', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>{t('print.availability')}</div>
                          <div className="info-value" style={{ fontSize: '14px', fontWeight: 500, color: '#1d1d1f' }}>{candidate.availability}</div>
                        </div>
                      )}
                      {candidate.desired_salary && !anonymized && (
                        <div>
                          <div className="info-label" style={{ fontSize: '10px', fontWeight: 700, color: '#86868b', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>{t('print.salary_expectation')}</div>
                          <div className="info-value" style={{ fontSize: '14px', fontWeight: 500, color: '#1d1d1f' }}>{candidate.desired_salary}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Sprachen & Mobilität */}
              {(candidate.languages || candidate.certificates || candidate.drivers_license || candidate.mobility) && (
                <div className="section" style={{ marginBottom: '24px' }}>
                  <div className="section-title" style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#0071e3', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {t('print.languages_mobility')}
                    <span style={{ flex: 1, height: '1px', background: '#e8e8ed', display: 'inline-block' }} />
                  </div>
                  <div className="section-card" style={{ background: '#fafafa', border: '1px solid #e8e8ed', borderRadius: '12px', padding: '20px 24px' }}>
                    <div className="info-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 36px' }}>
                      {candidate.languages && (
                        <div>
                          <div className="info-label" style={{ fontSize: '10px', fontWeight: 700, color: '#86868b', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>{t('print.languages')}</div>
                          <div className="info-value" style={{ fontSize: '14px', fontWeight: 500, color: '#1d1d1f' }}>{candidate.languages}</div>
                        </div>
                      )}
                      {candidate.certificates && (
                        <div>
                          <div className="info-label" style={{ fontSize: '10px', fontWeight: 700, color: '#86868b', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>{t('print.certificates')}</div>
                          <div className="info-value" style={{ fontSize: '14px', fontWeight: 500, color: '#1d1d1f' }}>{candidate.certificates}</div>
                        </div>
                      )}
                      {candidate.drivers_license && (
                        <div>
                          <div className="info-label" style={{ fontSize: '10px', fontWeight: 700, color: '#86868b', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>{t('print.drivers_license')}</div>
                          <div className="info-value" style={{ fontSize: '14px', fontWeight: 500, color: '#1d1d1f' }}>{candidate.drivers_license}</div>
                        </div>
                      )}
                      {candidate.mobility && (
                        <div>
                          <div className="info-label" style={{ fontSize: '10px', fontWeight: 700, color: '#86868b', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '2px' }}>{t('print.mobility')}</div>
                          <div className="info-value" style={{ fontSize: '14px', fontWeight: 500, color: '#1d1d1f' }}>{candidate.mobility}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Skills */}
              {skills.length > 0 && (
                <div className="section" style={{ marginBottom: '24px' }}>
                  <div className="section-title" style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#0071e3', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    Skills
                    <span style={{ flex: 1, height: '1px', background: '#e8e8ed', display: 'inline-block' }} />
                  </div>
                  <div className="chip-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {skills.map((s, i) => (
                      <span key={i} className="skill-chip" style={{ display: 'inline-block', padding: '5px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, background: '#f0f0f5', color: '#1d1d1f', border: '1px solid #e0e0e5' }}>{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Tags */}
              {tags.length > 0 && (
                <div className="section" style={{ marginBottom: '24px' }}>
                  <div className="section-title" style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#0071e3', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    Tags
                    <span style={{ flex: 1, height: '1px', background: '#e8e8ed', display: 'inline-block' }} />
                  </div>
                  <div className="chip-container" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {tags.map((tag, i) => (
                      <span key={i} className="tag-chip" style={{ display: 'inline-block', padding: '5px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, background: '#0071e3', color: '#fff' }}>{tag}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Notizen */}
              {candidate.notes && !anonymized && (
                <div className="section" style={{ marginBottom: '24px' }}>
                  <div className="section-title" style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#0071e3', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {t('print.notes')}
                    <span style={{ flex: 1, height: '1px', background: '#e8e8ed', display: 'inline-block' }} />
                  </div>
                  <div className="text-block" style={{ fontSize: '14px', color: '#1d1d1f', whiteSpace: 'pre-line', lineHeight: 1.7, background: '#f9f9fb', borderLeft: '3px solid #0071e3', padding: '14px 18px', borderRadius: '0 8px 8px 0' }}>{candidate.notes}</div>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
