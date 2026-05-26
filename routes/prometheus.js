const express = require('express');
const router = express.Router();

const axios = require('axios');
const PROM_URL = process.env.PROMETHEUS_URL || process.env.PROM_URL || 'http://192.168.139.128:9090';

async function fetchProm(query) {
  const base = PROM_URL.replace(/\/+$/g, '');
  const url = `${base}/api/v1/query`;
  const res = await axios.get(url, { params: { query } });
  return res.data;
}

router.get('/query', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ success: false, message: 'query required' });
  try {
    const data = await fetchProm(query);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(502).json({ success: false, message: err.message });
  }
});

async function singleValueQuery(q) {
  const js = await fetchProm(q);
  if (js?.status === 'success' && Array.isArray(js.data?.result) && js.data.result.length > 0) {
    const v = js.data.result[0].value; // [timestamp, value]
    return { value: Number(v[1]), ts: Number(v[0]) };
  }
  return { value: null, ts: null };
}

router.get('/cpu', async (req, res) => {
  const q = '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)';
  try {
    const v = await singleValueQuery(q);
    res.json({ success: true, query: q, value: v });
  } catch (err) {
    res.status(502).json({ success: false, message: err.message });
  }
});

router.get('/ram', async (req, res) => {
  const q = '(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100';
  try {
    const v = await singleValueQuery(q);
    res.json({ success: true, query: q, value: v });
  } catch (err) {
    res.status(502).json({ success: false, message: err.message });
  }
});

router.get('/disk', async (req, res) => {
  const q = '(node_filesystem_size_bytes - node_filesystem_free_bytes) / node_filesystem_size_bytes * 100';
  try {
    const v = await singleValueQuery(q);
    res.json({ success: true, query: q, value: v });
  } catch (err) {
    res.status(502).json({ success: false, message: err.message });
  }
});

/**
 * GET /api/prometheus/active-vms
 * Returns array of active VMs discovered via Prometheus `up{job="vm-servers"}`
 * Response:
 * {
 *   vms: [ { ip: "192.168.139.128", instance: "192.168.139.128:9100" } ]
 * }
 */
router.get('/active-vms', async (req, res) => {
  try {
    const query = 'up{job="vm-servers"}';
    const base = PROM_URL.replace(/\/+$/g, '');
    const url = `${base}/api/v1/query`;

    const response = await axios.get(url, {
      params: { query },
      timeout: 5000,
    });

    const results = response.data?.data?.result || [];

    const vms = results
      .filter((metric) => {
        const value = metric.value?.[1];
        return value === '1' || value === 1;
      })
      .map((metric) => {
        const instance = metric.metric?.instance;
        const ip = instance ? instance.split(':')[0] : null;
        return instance ? { ip, instance } : null;
      })
      .filter(Boolean);

    return res.json({ success: true, vms });
  } catch (err) {
    console.error('[prometheus/active-vms] Error:', err.message || err);
    // On error, return empty list as required
    return res.status(503).json({ success: false, message: 'Prometheus is unreachable', vms: [] });
  }
});

module.exports = router;
