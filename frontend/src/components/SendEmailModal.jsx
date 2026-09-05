import { useState, useEffect, useId } from 'react'
import { Mail, Send, Loader2, Check, AlertTriangle } from 'lucide-react'
import { emailApi } from '../api'
import { Button } from './UI'
import Modal from './Modal'
import { useI18n } from '../I18nContext'

export default function SendEmailModal({ candidate, jobTitle, onClose, onSent }) {
  const fieldIdPrefix = useId()
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
    <Modal
      onClose={onClose}
      size="lg"
      icon={Mail}
      title={t('email.send_email')}
      subtitle={`${t('email.to')}: ${candidate.email}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleSend} disabled={sending || !subject || !body || !candidate.email}>
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {t('email.send')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Template selector */}
        <div>
          <label htmlFor={`${fieldIdPrefix}-template`} className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            {t('email.choose_template')}
          </label>
          <select
            id={`${fieldIdPrefix}-template`}
            value={selectedTemplate}
            onChange={e => handleTemplateChange(e.target.value)}
            data-autofocus
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
            <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-gray-400" />
          </div>
        ) : (
          <>
            <div>
              <label htmlFor={`${fieldIdPrefix}-subject`} className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t('email.subject')}
              </label>
              <input
                id={`${fieldIdPrefix}-subject`}
                type="text"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="w-full px-4 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-gray-200 dark:border-gray-700 rounded-xl text-[15px] text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0071e3] transition-all"
                placeholder={t('email.subject_placeholder')}
              />
            </div>

            <div>
              <label htmlFor={`${fieldIdPrefix}-body`} className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t('email.body')}
              </label>
              <textarea
                id={`${fieldIdPrefix}-body`}
                rows={10}
                value={body}
                onChange={e => setBody(e.target.value)}
                className="w-full px-4 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-gray-200 dark:border-gray-700 rounded-xl text-[15px] text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0071e3] transition-all resize-y"
                placeholder={t('email.body_placeholder')}
              />
            </div>
          </>
        )}

        {result && (
          <div
            role={result.type === 'success' ? 'status' : 'alert'}
            className={`flex items-center gap-2 px-4 py-3 rounded-xl text-[14px] font-medium ${
              result.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
            }`}
          >
            {result.type === 'success' ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {result.text}
          </div>
        )}
      </div>
    </Modal>
  )
}
