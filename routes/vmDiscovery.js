const express = require('express');
const router = express.Router();
const { discoverVMs } = require('../utils/vmDiscovery');

/**
 * POST /api/vm-discovery/discover
 * Manually trigger a VM discovery scan
 * Returns: { activeCount, filePath, targets, activeIPs }
 */
router.post('/discover', async (req, res) => {
  try {
    console.log('[vm-discovery API] Manual discovery triggered');
    const result = await discoverVMs();
    res.json({
      success: true,
      message: 'Discovery completed',
      data: result,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Discovery failed',
      error: err.message,
    });
  }
});

/**
 * GET /api/vm-discovery/status
 * Quick health check / status endpoint
 * Returns: { running: true, message }
 */
router.get('/status', (req, res) => {
  res.json({
    success: true,
    data: {
      running: true,
      message: 'VM discovery service is active',
    },
  });
});

module.exports = router;
