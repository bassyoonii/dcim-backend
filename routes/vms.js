const express = require('express');
const axios = require('axios');
const router = express.Router();

/**
 * GET /api/vms/active
 * 
 * Fetches active VMs from Prometheus by querying the "up" metric.
 * Only returns VMs where up{job="vm-servers"} == 1
 * 
 * Response:
 * {
 *   "success": true,
 *   "vms": ["192.168.139.128:9100", "192.168.139.10:9100"],
 *   "count": 2
 * }
 */
router.get('/active', async (req, res) => {
  try {
    const prometheusUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';
    
    if (!prometheusUrl) {
      return res.status(500).json({
        success: false,
        message: 'PROMETHEUS_URL not configured',
        vms: []
      });
    }

    // Query Prometheus for active VMs (up metric with job="vm-servers")
    const query = 'up{job="vm-servers"}';
    const url = `${prometheusUrl}/api/v1/query`;
    
    console.log(`[vms/active] Querying Prometheus: ${url}?query=${encodeURIComponent(query)}`);
    
    const response = await axios.get(url, {
      params: { query },
      timeout: 5000, // 5 second timeout
    });

    // Parse Prometheus response
    const results = response.data?.data?.result || [];
    console.log(`[vms/active] Prometheus returned ${results.length} metric(s)`);

    // Filter only active VMs (up = 1)
    const activeVMs = results
      .filter(metric => {
        const value = metric.value?.[1];
        return value === '1' || value === 1;
      })
      .map(metric => {
        const instance = metric.metric?.instance;
        return instance;
      })
      .filter(Boolean); // Remove undefined values

    console.log(`[vms/active] Found ${activeVMs.length} active VM(s): ${activeVMs.join(', ') || 'none'}`);

    return res.json({
      success: true,
      vms: activeVMs,
      count: activeVMs.length,
    });
  } catch (err) {
    console.error('[vms/active] Error:', err.message);

    // Determine appropriate error status
    let statusCode = 500;
    let errorMessage = 'Failed to fetch active VMs';

    if (err.code === 'ECONNREFUSED') {
      statusCode = 503;
      errorMessage = 'Prometheus is unreachable';
    } else if (err.code === 'ENOTFOUND') {
      statusCode = 503;
      errorMessage = 'Prometheus host not found';
    } else if (err.code === 'ETIMEDOUT' || err.code === 'EHOSTUNREACH') {
      statusCode = 504;
      errorMessage = 'Prometheus request timed out';
    }

    return res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: err.message,
      vms: [], // Always return empty array on error (safe fallback)
    });
  }
});

/**
 * GET /api/vms/status
 * 
 * Check health of a specific VM by instance
 * Query parameter: instance (e.g., "192.168.139.128:9100")
 * 
 * Response:
 * {
 *   "success": true,
 *   "instance": "192.168.139.128:9100",
 *   "up": true,
 *   "value": 1
 * }
 */
router.get('/status', async (req, res) => {
  try {
    const { instance } = req.query;

    if (!instance) {
      return res.status(400).json({
        success: false,
        message: 'instance query parameter is required',
      });
    }

    const prometheusUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';

    if (!prometheusUrl) {
      return res.status(500).json({
        success: false,
        message: 'PROMETHEUS_URL not configured',
      });
    }

    // Query for specific instance
    const query = `up{job="vm-servers",instance="${instance}"}`;
    const url = `${prometheusUrl}/api/v1/query`;

    const response = await axios.get(url, {
      params: { query },
      timeout: 5000,
    });

    const results = response.data?.data?.result || [];
    const metric = results[0];

    if (!metric) {
      return res.status(404).json({
        success: false,
        message: 'Instance not found in Prometheus',
        instance,
      });
    }

    const value = metric.value?.[1];
    const isUp = value === '1' || value === 1;

    return res.json({
      success: true,
      instance,
      up: isUp,
      value: parseInt(value, 10),
    });
  } catch (err) {
    console.error('[vms/status] Error:', err.message);

    let statusCode = 500;
    let errorMessage = 'Failed to check VM status';

    if (err.code === 'ECONNREFUSED') {
      statusCode = 503;
      errorMessage = 'Prometheus is unreachable';
    } else if (err.code === 'ETIMEDOUT') {
      statusCode = 504;
      errorMessage = 'Prometheus request timed out';
    }

    return res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: err.message,
    });
  }
});

/**
 * GET /api/vms
 * 
 * Get all VMs (active and inactive) with their status
 * 
 * Response:
 * {
 *   "success": true,
 *   "vms": [
 *     { "instance": "192.168.139.128:9100", "up": true },
 *     { "instance": "192.168.139.10:9100", "up": false }
 *   ]
 * }
 */
router.get('/', async (req, res) => {
  try {
    const prometheusUrl = process.env.PROMETHEUS_URL || 'http://localhost:9090';

    if (!prometheusUrl) {
      return res.status(500).json({
        success: false,
        message: 'PROMETHEUS_URL not configured',
        vms: []
      });
    }

    const query = 'up{job="vm-servers"}';
    const url = `${prometheusUrl}/api/v1/query`;

    const response = await axios.get(url, {
      params: { query },
      timeout: 5000,
    });

    const results = response.data?.data?.result || [];

    const vms = results
      .map(metric => ({
        instance: metric.metric?.instance,
        up: metric.value?.[1] === '1' || metric.value?.[1] === 1,
        value: parseInt(metric.value?.[1] || 0, 10),
      }))
      .filter(vm => vm.instance); // Remove entries without instance label

    console.log(`[vms] Found ${vms.length} VM(s) (${vms.filter(v => v.up).length} active)`);

    return res.json({
      success: true,
      vms,
      count: vms.length,
      activeCount: vms.filter(v => v.up).length,
    });
  } catch (err) {
    console.error('[vms] Error:', err.message);

    let statusCode = 500;
    let errorMessage = 'Failed to fetch VMs';

    if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
      statusCode = 503;
      errorMessage = 'Prometheus is unreachable';
    } else if (err.code === 'ETIMEDOUT') {
      statusCode = 504;
      errorMessage = 'Prometheus request timed out';
    }

    return res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: err.message,
      vms: [],
    });
  }
});

module.exports = router;
