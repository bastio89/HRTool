const express = require('express')
const { forwardLinkedInPluginRequest } = require('./plugins')

const router = express.Router()

router.use(async (req, res) => {
  try {
    const suffix = req.url && req.url !== '/' ? req.url : '/export-pdf'
    await forwardLinkedInPluginRequest(req, res, `/plugins/linkedin${suffix}`)
  } catch (error) {
    console.error('Error proxying legacy LinkedIn route:', error)
    if (!res.headersSent) {
      res.status(502).json({ error: 'LinkedIn-Export konnte nicht erreicht werden' })
    }
  }
})

module.exports = router