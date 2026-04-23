const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const PROM = process.env.PROMETHEUS_URL || 'http://192.168.139.128:9090';

app.get('/cpu', async (req, res) => {
  try {
    const response = await axios.get(`${PROM}/api/v1/query`, {
      params: { query: '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)' }
    });
    const val = response.data.data.result?.[0]?.value?.[1];
    return res.json({ cpu: val != null ? parseFloat(val).toFixed(2) : null });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

app.get('/ram', async (req, res) => {
  try {
    const q = '(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100';
    const response = await axios.get(`${PROM}/api/v1/query`, { params: { query: q } });
    const val = response.data.data.result?.[0]?.value?.[1];
    return res.json({ ram: val != null ? parseFloat(val).toFixed(2) : null });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

app.get('/disk', async (req, res) => {
  try {
    const q = '(node_filesystem_size_bytes - node_filesystem_free_bytes) / node_filesystem_size_bytes * 100';
    const response = await axios.get(`${PROM}/api/v1/query`, { params: { query: q } });
    const val = response.data.data.result?.[0]?.value?.[1];
    return res.json({ disk: val != null ? parseFloat(val).toFixed(2) : null });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`prom-proxy running on http://localhost:${PORT}`));
