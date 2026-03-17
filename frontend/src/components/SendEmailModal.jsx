import { useState, useEffect } from 'react'
import { Mail, X, Send, FileText, Loader2, Eye, Check, AlertTriangle } from 'lucide-react'
import { emailApi } from '../api'
import { Button } from '../components/UI'
import { useI18n } from '../I18nContext'

export default function SendEmailModal({ candidate, jobTitle, onClose, onSent }) {
  const { t } = useI18n()
  const [templates, setTemplates] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [result, setResult] = useState(null)

  useEffect(() => {
    emailApi.getTemplates().then(res => {
      setTemplates(res.data || [])
    }).catch(console.error)
  }, [])

  const handleTemplateChange = async (templateId) => {
    setSelectedTemplate(templateId)
    if (!templateId) {
      setSubject('')
      setBody('')
      return
    }
    setPreviewing(true)
    try {
      const res = await emailApi.preview({
        template_id: parseInt(templateId),
        candidate_id: candidate.id,
        job_title: jobTitle,
      })
      setSubject(res.subject)
      setBody(res.body)
    } catch (err) {
      console.error(err)
    } finally {
      setPreviewing(false)
    }
  }

  const handleSend = async () => {
    if (!subject || !body) return
    setSending(true)
    setResult(null)
    try {
      await emailApi.send({
        candidate_id: candidate.id,
        template_id: selectedTemplate ? parseInt(selectedTemplate) : null,
        to_email: candidate.email,
        subject,
        body,
        job_title: jobTitle,
      })
      setResult({ type: 'success', text: t('email.send_success') })
      setTimeout(() => {
        onSent?.()
        onClose()
      }, 1500)
    } catch (err) {
      setResult({ type: 'error', text: err.message })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#1c1c1e] rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
              <Mail className="w-5 h-5 text-[#0071e3] dark:text-[#0a84ff]" />
            </div>
            <div>
              <h2 className="text-[18px] font-semibold text-black dark:text-white">{t('email.send_email')}</h2>
              <p className="text-[13px] text-gray-500">{t('email.to')}: {candidate.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl transition-colors cursor-pointer">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Template selector */}
          <div>
            <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t('email.choose_template')}
            </label>
            <select
              value={selectedTemplate}
              onChange={e => handleTemplateChange(e.target.value)}
              className="w-full px-4 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-gray-200 dark:border-gray-700 rounded-xl text-[15px] text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0071e3] transition-all"
            >
              <option value="">{t('email.custom_email')}</option>
              {templates.map(tpl => (
                <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
              ))}
            </select>
          </div>

          {previewing ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              {/* Subject */}
              <div>
                <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {t('email.subject')}
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full px-4 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-gray-200 dark:border-gray-700 rounded-xl text-[15px] text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0071e3] transition-all"
                  placeholder={t('email.subject_placeholder')}
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {t('email.body')}
                </label>
                <textarea
                  rows={10}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  className="w-full px-4 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-gray-200 dark:border-gray-700 rounded-xl text-[15px] text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0071e3] transition-all resize-y"
                  placeholder={t('email.body_placeholder')}
                />
              </div>
            </>
          )}

          {/* Result message */}
          {result && (
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-[14px] font-medium ${
              result.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
            }`}>
              {result.type === 'success' ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {result.text}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleSend} disabled={sending || !subject || !body || !candidate.email}>
            {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
            {t('email.send')}
          </Button>
        </div>
      </div>
    </div>
  )
}
