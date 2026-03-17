import { useState, useEffect } from 'react'
import { Mail, Send, Settings, FileText, Plus, Trash2, Edit3, Eye, Check, X, Loader2, AlertTriangle, TestTube, Zap } from 'lucide-react'
import { emailApi } from '../api'
import { Card, Button, Input, LoadingSpinner } from '../components/UI'
import { useI18n } from '../I18nContext'

const STAGES = ['Beworben', 'Vorauswahl', 'Interview', 'Angebot', 'Hired', 'Abgesagt']
const TEMPLATE_VARS = ['{{vorname}}', '{{nachname}}', '{{name}}', '{{email}}', '{{stelle}}', '{{unternehmen}}', '{{datum}}']

export default function EmailSettings() {
  const { t } = useI18n()
  const [tab, setTab] = useState('smtp')
  const [loading, setLoading] = useState(true)

  // SMTP state
  const [smtp, setSmtp] = useState({
    smtp_host: '', smtp_port: '587', smtp_user: '', smtp_pass: '', smtp_from_name: '', email_company_name: ''
  })
  const [smtpSaving, setSmtpSaving] = useState(false)
  const [smtpTesting, setSmtpTesting] = useState(false)
  const [smtpMsg, setSmtpMsg] = useState({ type: '', text: '' })

  // Templates state
  const [templates, setTemplates] = useState([])
  const [editTpl, setEditTpl] = useState(null)
  const [tplSaving, setTplSaving] = useState(false)

  // Log state
  const [logs, setLogs] = useState([])
  const [logPagination, setLogPagination] = useState({ page: 1, total: 0 })

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      const [smtpData, tplData] = await Promise.all([
        emailApi.getSmtpSettings(),
        emailApi.getTemplates(),
      ])
      setSmtp(prev => ({ ...prev, ...smtpData }))
      setTemplates(tplData.data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const loadLog = async (page = 1) => {
    try {
      const res = await emailApi.getLog({ page, limit: 30 })
      setLogs(res.data || [])
      setLogPagination(res.pagination || { page: 1, total: 0 })
    } catch (err) {
      console.error(err)
    }
  }

  // SMTP handlers
  const handleSmtpSave = async () => {
    setSmtpSaving(true)
    setSmtpMsg({ type: '', text: '' })
    try {
      await emailApi.saveSmtpSettings(smtp)
      setSmtpMsg({ type: 'success', text: t('email.smtp_saved') })
      setTimeout(() => setSmtpMsg({ type: '', text: '' }), 3000)
    } catch (err) {
      setSmtpMsg({ type: 'error', text: err.message })
    } finally {
      setSmtpSaving(false)
    }
  }

  const handleSmtpTest = async () => {
    setSmtpTesting(true)
    setSmtpMsg({ type: '', text: '' })
    try {
      const res = await emailApi.testSmtp()
      setSmtpMsg({ type: 'success', text: res.message || t('email.smtp_test_success') })
      setTimeout(() => setSmtpMsg({ type: '', text: '' }), 5000)
    } catch (err) {
      setSmtpMsg({ type: 'error', text: err.message })
    } finally {
      setSmtpTesting(false)
    }
  }

  // Template handlers
  const newTemplate = () => {
    setEditTpl({ id: null, name: '', subject: '', body: '', trigger_stage: '', is_active: 1 })
  }

  const saveTemplate = async () => {
    setTplSaving(true)
    try {
      if (editTpl.id) {
        await emailApi.updateTemplate(editTpl.id, editTpl)
      } else {
        await emailApi.createTemplate(editTpl)
      }
      setEditTpl(null)
      const res = await emailApi.getTemplates()
      setTemplates(res.data || [])
    } catch (err) {
      alert(err.message)
    } finally {
      setTplSaving(false)
    }
  }

  const deleteTemplate = async (id) => {
    if (!confirm(t('email.confirm_delete_template'))) return
    try {
      await emailApi.deleteTemplate(id)
      setTemplates(templates.filter(t => t.id !== id))
    } catch (err) {
      alert(err.message)
    }
  }

  if (loading) return <LoadingSpinner text={t('common.loading')} />

  const tabs = [
    { key: 'smtp', icon: Settings, label: t('email.tab_smtp') },
    { key: 'templates', icon: FileText, label: t('email.tab_templates') },
    { key: 'log', icon: Mail, label: t('email.tab_log') },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-[28px] sm:text-[34px] font-bold tracking-tight text-black dark:text-white">{t('email.title')}</h1>
        <p className="text-[15px] sm:text-[17px] text-gray-500 mt-1">{t('email.subtitle')}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700 pb-0">
        {tabs.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => { setTab(key); if (key === 'log') loadLog(); }}
            className={`flex items-center gap-2 px-4 py-3 text-[14px] font-medium border-b-2 transition-all cursor-pointer ${
              tab === key
                ? 'border-[#0071e3] text-[#0071e3] dark:border-[#0a84ff] dark:text-[#0a84ff]'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* SMTP Tab */}
      {tab === 'smtp' && (
        <Card className="p-6 space-y-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
              <Settings className="w-5 h-5 text-[#0071e3] dark:text-[#0a84ff]" />
            </div>
            <div>
              <h2 className="text-[18px] font-semibold text-black dark:text-white">{t('email.smtp_title')}</h2>
              <p className="text-[13px] text-gray-500">{t('email.smtp_desc')}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={t('email.smtp_host')}
              placeholder="smtp.gmail.com"
              value={smtp.smtp_host || ''}
              onChange={e => setSmtp({ ...smtp, smtp_host: e.target.value })}
            />
            <Input
              label={t('email.smtp_port')}
              placeholder="587"
              type="number"
              value={smtp.smtp_port || '587'}
              onChange={e => setSmtp({ ...smtp, smtp_port: e.target.value })}
            />
            <Input
              label={t('email.smtp_user')}
              placeholder="user@example.com"
              value={smtp.smtp_user || ''}
              onChange={e => setSmtp({ ...smtp, smtp_user: e.target.value })}
            />
            <Input
              label={t('email.smtp_pass')}
              placeholder="••••••••"
              type="password"
              value={smtp.smtp_pass || ''}
              onChange={e => setSmtp({ ...smtp, smtp_pass: e.target.value })}
            />
            <Input
              label={t('email.smtp_from_name')}
              placeholder="HR-Team"
              value={smtp.smtp_from_name || ''}
              onChange={e => setSmtp({ ...smtp, smtp_from_name: e.target.value })}
            />
            <Input
              label={t('email.company_name')}
              placeholder="Meine Firma GmbH"
              value={smtp.email_company_name || ''}
              onChange={e => setSmtp({ ...smtp, email_company_name: e.target.value })}
            />
          </div>

          {smtpMsg.text && (
            <div className={`flex items-center gap-2 px-4 py-3 rounded-xl text-[14px] font-medium ${
              smtpMsg.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
            }`}>
              {smtpMsg.type === 'success' ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {smtpMsg.text}
            </div>
          )}

          <div className="flex gap-3">
            <Button onClick={handleSmtpSave} disabled={smtpSaving}>
              {smtpSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {t('common.save')}
            </Button>
            <Button variant="secondary" onClick={handleSmtpTest} disabled={smtpTesting}>
              {smtpTesting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <TestTube className="w-4 h-4 mr-2" />}
              {t('email.test_connection')}
            </Button>
          </div>
        </Card>
      )}

      {/* Templates Tab */}
      {tab === 'templates' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-semibold text-black dark:text-white">{t('email.templates_title')}</h2>
            <Button onClick={newTemplate}><Plus className="w-4 h-4 mr-2" />{t('email.new_template')}</Button>
          </div>

          {/* Template Editor */}
          {editTpl && (
            <Card className="p-6 space-y-4 border-2 border-[#0071e3]/30 dark:border-[#0a84ff]/30">
              <h3 className="text-[16px] font-semibold text-black dark:text-white">
                {editTpl.id ? t('email.edit_template') : t('email.new_template')}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label={t('email.template_name')}
                  placeholder="z. B. Bewerbungseingang"
                  value={editTpl.name}
                  onChange={e => setEditTpl({ ...editTpl, name: e.target.value })}
                />
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('email.trigger_stage')}</label>
                  <select
                    value={editTpl.trigger_stage || ''}
                    onChange={e => setEditTpl({ ...editTpl, trigger_stage: e.target.value || null })}
                    className="w-full px-4 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-gray-200 dark:border-gray-700 rounded-xl text-[15px] text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0071e3] transition-all"
                  >
                    <option value="">{t('email.no_trigger')}</option>
                    {STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <Input
                label={t('email.subject')}
                placeholder={t('email.subject_placeholder')}
                value={editTpl.subject}
                onChange={e => setEditTpl({ ...editTpl, subject: e.target.value })}
              />
              <div>
                <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t('email.body')}</label>
                <textarea
                  rows={8}
                  value={editTpl.body}
                  onChange={e => setEditTpl({ ...editTpl, body: e.target.value })}
                  className="w-full px-4 py-3 bg-[#f5f5f7] dark:bg-[#2c2c2e] border border-gray-200 dark:border-gray-700 rounded-xl text-[15px] text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-[#0071e3] transition-all resize-y"
                  placeholder={t('email.body_placeholder')}
                />
              </div>

              {/* Variable help */}
              <div className="flex flex-wrap gap-2">
                <span className="text-[12px] text-gray-500 font-medium">{t('email.variables')}:</span>
                {TEMPLATE_VARS.map(v => (
                  <button
                    key={v}
                    onClick={() => setEditTpl({ ...editTpl, body: editTpl.body + v })}
                    className="px-2 py-1 text-[12px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 cursor-pointer transition-colors font-mono"
                  >
                    {v}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editTpl.is_active === 1}
                    onChange={e => setEditTpl({ ...editTpl, is_active: e.target.checked ? 1 : 0 })}
                    className="w-4 h-4 accent-[#0071e3]"
                  />
                  <span className="text-[14px] text-gray-700 dark:text-gray-300">{t('email.active')}</span>
                </label>
              </div>

              <div className="flex gap-3">
                <Button onClick={saveTemplate} disabled={tplSaving || !editTpl.name || !editTpl.subject || !editTpl.body}>
                  {tplSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  {t('common.save')}
                </Button>
                <Button variant="secondary" onClick={() => setEditTpl(null)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </Card>
          )}

          {/* Template List */}
          <div className="space-y-3">
            {templates.length === 0 ? (
              <Card className="p-8 text-center text-gray-500">
                <FileText className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p>{t('email.no_templates')}</p>
              </Card>
            ) : templates.map(tpl => (
              <Card key={tpl.id} className="p-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <h3 className="text-[15px] font-semibold text-black dark:text-white truncate">{tpl.name}</h3>
                    {tpl.trigger_stage && (
                      <span className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-lg">
                        <Zap className="w-3 h-3" />
                        {tpl.trigger_stage}
                      </span>
                    )}
                    <span className={`w-2 h-2 rounded-full ${tpl.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                  </div>
                  <p className="text-[13px] text-gray-500 truncate mt-0.5">{tpl.subject}</p>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => setEditTpl({ ...tpl })}
                    className="p-2 text-gray-400 hover:text-[#0071e3] hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-all cursor-pointer"
                    title={t('email.edit_template')}
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteTemplate(tpl.id)}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-all cursor-pointer"
                    title={t('common.delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Email Log Tab */}
      {tab === 'log' && (
        <div className="space-y-4">
          <h2 className="text-[18px] font-semibold text-black dark:text-white">{t('email.log_title')}</h2>
          {logs.length === 0 ? (
            <Card className="p-8 text-center text-gray-500">
              <Mail className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p>{t('email.no_logs')}</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {logs.map(log => (
                <Card key={log.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-lg ${
                          log.status === 'sent'
                            ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                            : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                        }`}>
                          {log.status === 'sent' ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                          {log.status === 'sent' ? t('email.status_sent') : t('email.status_failed')}
                        </span>
                        {log.template_name && (
                          <span className="text-[11px] text-gray-400 font-medium">
                            {log.template_name}
                          </span>
                        )}
                      </div>
                      <p className="text-[14px] font-medium text-black dark:text-white truncate">{log.subject}</p>
                      <p className="text-[13px] text-gray-500">
                        {t('email.to')}: {log.to_email}
                        {log.candidate_name && ` (${log.candidate_name})`}
                      </p>
                      {log.error_message && (
                        <p className="text-[12px] text-red-500 mt-1">{log.error_message}</p>
                      )}
                    </div>
                    <div className="text-right text-[12px] text-gray-400 whitespace-nowrap ml-4">
                      <p>{new Date(log.created_at).toLocaleDateString('de-DE')}</p>
                      <p>{new Date(log.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</p>
                      {log.sent_by && <p className="mt-1">{log.sent_by}</p>}
                    </div>
                  </div>
                </Card>
              ))}
              {/* Pagination */}
              {logPagination.total > 30 && (
                <div className="flex justify-center gap-2 mt-4">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={logPagination.page <= 1}
                    onClick={() => loadLog(logPagination.page - 1)}
                  >
                    {t('common.back')}
                  </Button>
                  <span className="px-3 py-2 text-[13px] text-gray-500">
                    {logPagination.page} / {Math.ceil(logPagination.total / 30)}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={logPagination.page >= Math.ceil(logPagination.total / 30)}
                    onClick={() => loadLog(logPagination.page + 1)}
                  >
                    {t('common.forward')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
