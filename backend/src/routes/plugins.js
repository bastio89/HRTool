const express = require('express')
const db = require('../database')
const { logAudit } = require('./audit')

const router = express.Router()

const LINKEDIN_SETTING_KEY = 'plugin.linkedin.enabled'
const JOBS_CH_SETTING_KEY = 'plugin.jobs_ch.enabled'
const SKILL_MATCHING_TESTS_SETTING_KEY = 'plugin.skill_matching_tests.enabled'
const GRAPHRAG_BASE_URL = (process.env.GRAPHRAG_BASE_URL || 'http://graphrag:8000').replace(/\/+$/, '')
const GRAPHRAG_API_KEY = (process.env.GRAPHRAG_API_KEY || '').trim()

const LINKEDIN_MANIFEST = {
  id: 'linkedin',
  name: 'LinkedIn',
  description: 'LinkedIn profile search and PDF export',
  uiSlots: ['sidebar', 'tools', 'routes'],
  routes: ['/tools/linkedin'],
  apiRoutes: ['/api/plugins/linkedin/people-search.csv', '/api/plugins/linkedin/export-pdf', '/api/plugins/linkedin/profile'],
}

const JOBS_CH_MANIFEST = {
  id: 'jobs_ch',
  name: 'Jobs.ch',
  description: 'jobs.ch PDF export',
  uiSlots: ['sidebar', 'tools', 'routes'],
  routes: ['/tools/jobs-ch'],
  apiRoutes: ['/api/plugins/jobs_ch/export-pdf', '/api/plugins/jobs_ch/import-db', '/api/plugins/jobs_ch/search'],
}

const SKILL_MATCHING_TESTS_MANIFEST = {
  id: 'skill_matching_tests',
  name: 'Skill-Matching CSV-Test',
  description: 'Führt die CSV-Integrationstests für das Skill-Matching aus.',
  uiSlots: ['tools'],
  routes: [],
  apiRoutes: ['/api/plugins/skill_matching_tests/run'],
}

const isAdmin = (req) => req.user?.role === 'admin'

function readPluginEnabled(settingKey, defaultEnabled = true) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingKey)
  if (!row || typeof row.value !== 'string' || !row.value.trim()) {
    return defaultEnabled
  }
  return ['1', 'true', 'yes', 'on'].includes(row.value.trim().toLowerCase())
}

function setPluginEnabled(settingKey, enabled) {
  db.prepare(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`).run(
    settingKey,
    enabled ? '1' : '0',
  )
}

function manifestResponse(manifest, settingKey, defaultEnabled = true) {
  return {
    ...manifest,
    enabled: readPluginEnabled(settingKey, defaultEnabled),
  }
}

async function forwardToGraphRag(req, res, targetPath, enabled, disabledMessage) {
  if (!enabled) {
    return res.status(404).json({ error: disabledMessage || 'Plugin is disabled' })
  }

  const response = await fetch(`${GRAPHRAG_BASE_URL}${targetPath}`, {
    method: req.method,
    headers: {
      ...(req.headers.accept ? { Accept: req.headers.accept } : {}),
      ...(req.headers['content-type'] ? { 'Content-Type': req.headers['content-type'] } : {}),
      ...(GRAPHRAG_API_KEY ? { 'x-api-key': GRAPHRAG_API_KEY } : {}),
      ...(typeof req.headers.authorization === 'string' && req.headers.authorization.trim()
        ? { Authorization: req.headers.authorization.trim() }
        : {}),
    },
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : JSON.stringify(req.body ?? {}),
  })

  const body = Buffer.from(await response.arrayBuffer())
  res.status(response.status)

  const contentType = response.headers.get('content-type')
  if (contentType) res.setHeader('Content-Type', contentType)

  const disposition = response.headers.get('content-disposition')
  if (disposition) res.setHeader('Content-Disposition', disposition)

  const warning = response.headers.get('x-hrtool-linkedin-warning')
  if (warning) res.setHeader('X-HRTool-LinkedIn-Warning', warning)

  return res.send(body)
}

router.get('/', (req, res) => {
  res.json({ plugins: [
    manifestResponse(JOBS_CH_MANIFEST, JOBS_CH_SETTING_KEY),
    manifestResponse(LINKEDIN_MANIFEST, LINKEDIN_SETTING_KEY),
    manifestResponse(SKILL_MATCHING_TESTS_MANIFEST, SKILL_MATCHING_TESTS_SETTING_KEY, false),
  ] })
})

router.get('/linkedin', (req, res) => {
  res.json(manifestResponse(LINKEDIN_MANIFEST, LINKEDIN_SETTING_KEY))
})

router.put('/linkedin', (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Nur Administratoren duerfen Plugin-Flags aendern' })
    }

    const enabled = Boolean(req.body?.enabled)
    setPluginEnabled(LINKEDIN_SETTING_KEY, enabled)

    logAudit(req, 'plugin-flag-geaendert', 'Setting', null, LINKEDIN_SETTING_KEY, {
      enabled,
    })

    return res.json({ success: true, plugin: { ...LINKEDIN_MANIFEST, enabled } })
  } catch (error) {
    console.error('Error updating LinkedIn plugin flag:', error)
    return res.status(500).json({ error: 'Plugin-Flag konnte nicht gespeichert werden' })
  }
})

router.use('/linkedin', async (req, res) => {
  try {
    const suffix = req.url && req.url !== '/' ? req.url : ''
    await forwardToGraphRag(req, res, `/plugins/linkedin${suffix}`, readPluginEnabled(LINKEDIN_SETTING_KEY), 'LinkedIn plugin is disabled')
  } catch (error) {
    console.error('Error proxying LinkedIn plugin request:', error)
    if (!res.headersSent) {
      res.status(502).json({ error: 'LinkedIn-Plugin konnte nicht erreicht werden' })
    }
  }
})

router.get('/jobs_ch', (req, res) => {
  res.json(manifestResponse(JOBS_CH_MANIFEST, JOBS_CH_SETTING_KEY))
})

router.put('/jobs_ch', (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Nur Administratoren duerfen Plugin-Flags aendern' })
    }

    const enabled = Boolean(req.body?.enabled)
    setPluginEnabled(JOBS_CH_SETTING_KEY, enabled)

    logAudit(req, 'plugin-flag-geaendert', 'Setting', null, JOBS_CH_SETTING_KEY, {
      enabled,
    })

    return res.json({ success: true, plugin: { ...JOBS_CH_MANIFEST, enabled } })
  } catch (error) {
    console.error('Error updating jobs.ch plugin flag:', error)
    return res.status(500).json({ error: 'Plugin-Flag konnte nicht gespeichert werden' })
  }
})

router.use('/jobs_ch', async (req, res) => {
  try {
    const suffix = req.url && req.url !== '/' ? req.url : ''
    await forwardToGraphRag(req, res, `/plugins/jobs_ch${suffix}`, readPluginEnabled(JOBS_CH_SETTING_KEY), 'jobs.ch-Plugin ist deaktiviert')
  } catch (error) {
    console.error('Error proxying jobs.ch plugin request:', error)
    if (!res.headersSent) {
      res.status(502).json({ error: 'jobs.ch-Plugin konnte nicht erreicht werden' })
    }
  }
})

router.get('/skill_matching_tests', (req, res) => {
  res.json(manifestResponse(SKILL_MATCHING_TESTS_MANIFEST, SKILL_MATCHING_TESTS_SETTING_KEY, false))
})

router.put('/skill_matching_tests', (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Nur Administratoren duerfen Plugin-Flags aendern' })
    }

    const enabled = Boolean(req.body?.enabled)
    setPluginEnabled(SKILL_MATCHING_TESTS_SETTING_KEY, enabled)

    logAudit(req, 'plugin-flag-geaendert', 'Setting', null, SKILL_MATCHING_TESTS_SETTING_KEY, {
      enabled,
    })

    return res.json({ success: true, plugin: { ...SKILL_MATCHING_TESTS_MANIFEST, enabled } })
  } catch (error) {
    console.error('Error updating skill matching tests plugin flag:', error)
    return res.status(500).json({ error: 'Plugin-Flag konnte nicht gespeichert werden' })
  }
})

router.use('/skill_matching_tests/cases', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Nur Administratoren duerfen Testfaelle verwalten' })
    }

    const enabled = readPluginEnabled(SKILL_MATCHING_TESTS_SETTING_KEY, false)
    if (!enabled) {
      return res.status(404).json({ error: 'Das Skill-Matching-Test-Plugin ist deaktiviert' })
    }

    const suffix = req.url && req.url !== '/' ? req.url : ''
    await forwardToGraphRag(
      req,
      res,
      `/plugins/skill_matching_tests/cases${suffix}`,
      true,
      'Das Skill-Matching-Test-Plugin ist deaktiviert',
    )
  } catch (error) {
    console.error('Error proxying skill matching test cases:', error)
    if (!res.headersSent) {
      res.status(502).json({ error: 'Testfaelle konnten nicht geladen oder gespeichert werden' })
    }
  }
})

router.post('/skill_matching_tests/run', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Nur Administratoren duerfen CSV-Tests starten' })
    }
    if (!readPluginEnabled(SKILL_MATCHING_TESTS_SETTING_KEY, false)) {
      return res.status(404).json({ error: 'Das Skill-Matching-Test-Plugin ist deaktiviert' })
    }

    await forwardToGraphRag(
      req,
      res,
      '/plugins/skill_matching_tests/run',
      true,
      'Das Skill-Matching-Test-Plugin ist deaktiviert',
    )
  } catch (error) {
    console.error('Error running skill matching CSV tests:', error)
    if (!res.headersSent) {
      res.status(502).json({ error: 'CSV-Integrationstest konnte nicht gestartet werden' })
    }
  }
})

module.exports = router
module.exports.forwardLinkedInPluginRequest = forwardToGraphRag
module.exports.forwardJobsChPluginRequest = forwardToGraphRag
module.exports.readLinkedInEnabled = () => readPluginEnabled(LINKEDIN_SETTING_KEY)
module.exports.readJobsChEnabled = () => readPluginEnabled(JOBS_CH_SETTING_KEY)
module.exports.readSkillMatchingTestsEnabled = () => readPluginEnabled(SKILL_MATCHING_TESTS_SETTING_KEY, false)
module.exports.LINKEDIN_MANIFEST = LINKEDIN_MANIFEST
module.exports.JOBS_CH_MANIFEST = JOBS_CH_MANIFEST
module.exports.SKILL_MATCHING_TESTS_MANIFEST = SKILL_MATCHING_TESTS_MANIFEST