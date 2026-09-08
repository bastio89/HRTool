const express = require('express')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const db = require('../database')

const router = express.Router()

const repoRoot = path.resolve(__dirname, '..', '..')
const pythonScript = path.join(repoRoot, 'batch_tools', 'linkedin_profile_to_pdf.py')

function readApifyToken() {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('apify_token')
  const stored = typeof row?.value === 'string' ? row.value.trim() : ''
  return stored || (typeof process.env.APIFY_TOKEN === 'string' ? process.env.APIFY_TOKEN.trim() : '') || ''
}

function normalizeLinks(body) {
  if (Array.isArray(body?.profiles)) {
    return body.profiles
      .filter((profile) => profile && typeof profile === 'object')
      .map((profile) => {
        if (profile.linkedinUrl || profile.linkedin_url || profile.profileUrl || profile.profile_url || profile.url) {
          return profile
        }

        return profile
      })
  }

  if (Array.isArray(body?.links)) {
    return body.links
      .map((link) => (typeof link === 'string' ? link.trim() : ''))
      .filter(Boolean)
      .map((link) => ({ linkedinUrl: link }))
  }

  return []
}

router.post('/export-pdf', (req, res) => {
  const profiles = normalizeLinks(req.body)
  if (profiles.length === 0) {
    return res.status(400).json({ error: 'Mindestens ein LinkedIn-Profil ist erforderlich.' })
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hrtool-linkedin-'))
  const profilesFile = path.join(tempDir, 'linkedin-profiles.json')
  fs.writeFileSync(profilesFile, `${JSON.stringify(profiles, null, 2)}\n`, 'utf8')
  const apifyToken = readApifyToken()

  try {
    const result = spawnSync('python3', [pythonScript, '--profiles-json', profilesFile], {
      cwd: tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...(apifyToken ? { APIFY_TOKEN: apifyToken } : {}),
      },
      maxBuffer: 10 * 1024 * 1024,
    })

    const stdout = (result.stdout || '').trim()
    const stderr = (result.stderr || '').trim()

    if (result.error) {
      return res.status(502).json({ error: `PDF-Export fehlgeschlagen: ${result.error.message}` })
    }
    if (result.status !== 0) {
      return res.status(502).json({
        error: 'PDF-Export fehlgeschlagen.',
        details: stderr || stdout || `Exit code ${result.status}`,
      })
    }

    const files = [...stdout.matchAll(/^PDF erstellt:\s*(.+)$/gm)].map((match) => match[1].trim())
    if (files.length === 0) {
      return res.status(502).json({
        error: 'PDF-Export fehlgeschlagen.',
        details: stdout || 'Keine PDF-Dateien wurden erstellt.',
      })
    }

    const enrichmentWarning = stderr.match(/Warnung:\s*LinkedIn-Anreicherung nicht verfügbar:\s*(.+)/i)?.[1]?.trim() || null

    const zipName = `linkedin-profiles-${Date.now()}.zip`
    const zipPath = path.join(tempDir, zipName)
    const zipScript = [
      'import pathlib, sys, zipfile',
      'zip_path = pathlib.Path(sys.argv[1])',
      'files = [pathlib.Path(path) for path in sys.argv[2:]]',
      'with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:',
      '    for file_path in files:',
      '        archive.write(file_path, arcname=file_path.name)',
    ].join('\n')

    const zipResult = spawnSync('python3', ['-c', zipScript, zipPath, ...files], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    })

    if (zipResult.error) {
      return res.status(502).json({ error: `ZIP-Erstellung fehlgeschlagen: ${zipResult.error.message}` })
    }
    if (zipResult.status !== 0) {
      return res.status(502).json({
        error: 'ZIP-Erstellung fehlgeschlagen.',
        details: (zipResult.stderr || '').trim() || (zipResult.stdout || '').trim() || `Exit code ${zipResult.status}`,
      })
    }

    if (enrichmentWarning) {
      res.setHeader('X-HRTool-LinkedIn-Warning', enrichmentWarning)
    }

    return res.download(zipPath, zipName, (downloadError) => {
      if (downloadError && !res.headersSent) {
        res.status(502).json({ error: `Download fehlgeschlagen: ${downloadError.message}` })
      }
    })
  } finally {
    setTimeout(() => {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }, 30_000)
  }
})

module.exports = router