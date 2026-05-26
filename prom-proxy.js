const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const PROM = process.env.PROMETHEUS_URL || 'http://192.168.139.128:9090';

// Flexible instance matcher: allow exact match, endsWith, includes, or startsWith
function matchesInstance(metricInstance, requested) {
  if (!metricInstance || !requested) return false;
  try {
    const a = String(metricInstance);
    const b = String(requested);
    if (a === b) return true;
    if (a.endsWith(b)) return true;
    if (a.startsWith(b)) return true;
    if (a.includes(b)) return true;
    if (b.includes(a)) return true;
  } catch (e) {
    return false;
  }
  return false;
}

/*
API Monitoring - Endpoints

- GET /api/cpu?instance=<instance?>
  - Description: Retourne l'utilisation CPU en pourcentage. Si `instance` est fourni, retourne la valeur pour cette instance. Sinon retourne une averaged/global value.
  - Example response:
    {
      "instance": "host:9100",
      "cpu": "12.34",
      "metric": "<prometheus labels>",
      "series": "<optional series list>"
    }

- GET /api/ram?instance=<instance?>
  - Description: Retourne l'utilisation RAM en pourcentage (100 - MemAvailable/Total).
  - Example response:
    {
      "instance": "host:9100",
      "ram": "45.67",
      "metric": "<prometheus labels>"
    }

- GET /api/disk?instance=<instance?>
  - Description: Retourne l'utilisation du filesystem racine (mountpoint="/") en pourcentage.
    Filtre `fstype!=tmpfs` pour éviter les pseudo-filesystems.
  - Guarantees: lorsque `instance` est fourni, l'endpoint renvoie toujours une valeur numérique (float) dans `disk`.
  - Example response:
    {
      "instance": "host:9100",
      "disk": 73.21,
      "metric": "<prometheus labels>"
    }

- GET /api/disk/range?instance=<instance?>&start=...&end=...&step=...
  - Description: Retourne une ou plusieurs séries temporelles pour l'utilisation du disque (root filesystem).
  - Example response:
    {
      "series": [
        { "instance": "host:9100", "values": [[1630000000, 70.1], [1630000060, 70.2]] }
      ]
    }

Notes:
 - Ces routes existent aussi sans le préfixe `/api` (par ex. `/cpu`).
 - Les valeurs retournées sont arrondies côté proxy pour simplifier l'affichage dans le frontend.
*/

app.get(['/cpu', '/api/cpu'], async (req, res) => {
  try {
    const instance = req.query.instance;
    const requested = instance ? String(instance).trim() : null;
    // build promql: per-instance when provided, aggregated avg across instances when not
    let q;
    if (requested) {
      // per-instance (cores aggregated) for the given instance
      q = `100 - (avg by (instance) (rate(node_cpu_seconds_total{mode=\"idle\",instance=\"${requested}\"}[1m])) * 100)`;
    } else {
      // return one series per instance (cores aggregated); we'll average in JS for Global
      q = '100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)';
    }
    const response = await axios.get(`${PROM}/api/v1/query`, { params: { query: q } });
    const results = response.data.data.result || [];
    console.log('Requested instance:', requested);
    console.log('Results:', results);
    let val = null;
    let chosenMetric = null;
    const series = results.map(r => ({ metric: r.metric || null, value: r.value?.[1] ?? null }));
    if (requested) {
      // exact match first
      const match = results.find(r => r.metric?.instance === requested) || results.find(r => r.metric && matchesInstance(r.metric.instance, requested));
      if (match && match.value?.[1] != null && Number.isFinite(parseFloat(match.value[1]))) {
        val = parseFloat(match.value[1]);
        chosenMetric = match.metric || null;
      } else {
        // fallback to range query last 5 minutes
        console.log('Instant query returned no valid value, falling back to range for CPU');
        const now = Math.floor(Date.now() / 1000);
        const start = now - 5 * 60;
        const end = now;
        const step = 15;
        const params = { query: q, start, end, step };
        const rResp = await axios.get(`${PROM}/api/v1/query_range`, { params });
        const rangeResults = rResp.data?.data?.result || [];
        console.log('Range results (CPU):', rangeResults);
        // find matching series
        const matched = rangeResults.find(s => s.metric?.instance === requested) || rangeResults.find(s => s.metric && matchesInstance(s.metric.instance, requested));
        if (matched && matched.values && matched.values.length > 0) {
          for (let i = matched.values.length - 1; i >= 0; i--) {
            const raw = matched.values[i]?.[1];
            const n = raw != null ? parseFloat(raw) : NaN;
            if (Number.isFinite(n)) { val = Number(n.toFixed(2)); break; }
          }
        }
      }
      return res.json({ instance: requested, cpu: val != null ? Number(val.toFixed(2)) : null, metric: chosenMetric, series });
    }

    // Global: average across per-instance series
    const values = results.map(r => parseFloat(r.value?.[1])).filter(v => !Number.isNaN(v));
    if (values.length > 0) {
      const sum = values.reduce((a, b) => a + b, 0);
      val = sum / values.length;
    } else {
      val = null;
    }
    return res.json({ instance: null, cpu: val != null ? val.toFixed(2) : null, series });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

app.get(['/ram', '/api/ram'], async (req, res) => {
  try {
    const instance = req.query.instance;
    const requested = instance ? String(instance).trim() : null;
    let q;
    if (requested) {
      q = `100 * (1 - node_memory_MemAvailable_bytes{instance=\"${requested}\"} / node_memory_MemTotal_bytes{instance=\"${requested}\"})`;
    } else {
      // return per-instance series (no sum) so we can average in JS
      q = '100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)';
    }
    const response = await axios.get(`${PROM}/api/v1/query`, { params: { query: q } });
    const results = response.data.data.result || [];
    console.log('Requested instance:', requested);
    console.log('Results:', results);
    let val = null;
    let chosenMetric = null;
    if (requested) {
      const match = results.find(r => r.metric?.instance === requested) || results.find(r => r.metric && matchesInstance(r.metric.instance, requested));
      if (match && match.value?.[1] != null && Number.isFinite(parseFloat(match.value[1]))) {
        val = parseFloat(match.value[1]);
        chosenMetric = match.metric || null;
      } else {
        console.log('Instant query returned no valid value, falling back to range for RAM');
        const now = Math.floor(Date.now() / 1000);
        const start = now - 5 * 60;
        const end = now;
        const step = 15;
        const params = { query: q, start, end, step };
        const rResp = await axios.get(`${PROM}/api/v1/query_range`, { params });
        const rangeResults = rResp.data?.data?.result || [];
        console.log('Range results (RAM):', rangeResults);
        const matched = rangeResults.find(s => s.metric?.instance === requested) || rangeResults.find(s => s.metric && matchesInstance(s.metric.instance, requested));
        if (matched && matched.values && matched.values.length > 0) {
          for (let i = matched.values.length - 1; i >= 0; i--) {
            const raw = matched.values[i]?.[1];
            const n = raw != null ? parseFloat(raw) : NaN;
            if (Number.isFinite(n)) { val = Number(n.toFixed(2)); break; }
          }
        }
      }
    } else {
      const values = results.map(r => parseFloat(r.value?.[1])).filter(v => !Number.isNaN(v));
      if (values.length > 0) {
        const sum = values.reduce((a, b) => a + b, 0);
        val = sum / values.length;
      } else {
        val = null;
      }
    }
    return res.json({
      instance: requested,
      ram: val != null ? val.toFixed(2) : null,
      metric: chosenMetric
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

app.get(['/disk', '/api/disk'], async (req, res) => {
  try {
    const instance = req.query.instance;
    const requested = instance ? String(instance).trim() : null;

    // Use PromQL aligned with /api/disk/range: filter mountpoint="/" and exclude tmpfs
    let q;
    if (requested) {
      q = `100 - ( node_filesystem_avail_bytes{instance="${requested}",mountpoint="/",fstype!~"tmpfs"} / node_filesystem_size_bytes{instance="${requested}",mountpoint="/",fstype!~"tmpfs"} ) * 100`;
    } else {
      q = `100 - ( node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs"} / node_filesystem_size_bytes{mountpoint="/",fstype!~"tmpfs"} ) * 100`;
    }

    // Instant query
    const resp = await axios.get(`${PROM}/api/v1/query`, { params: { query: q } });
    const results = resp.data?.data?.result || [];
    console.debug('[DISK PROM RESULT instant]:', results);
    console.log('Requested instance:', requested);
    console.log('Results:', results);

    // Helper to parse a result value
    const parseValue = r => {
      try {
        const raw = r?.value?.[1];
        const n = raw != null ? parseFloat(raw) : NaN;
        return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
      } catch (e) {
        return null;
      }
    };

    // If instance provided: prefer exact match on instance+mountpoint, then instance only, then fuzzy
    let chosenVal = null;
    let disk_is_fallback = false;
    let rangeResults = [];
    if (requested) {
      const match = results.find(r => r.metric?.instance === requested && r.metric?.mountpoint === '/')
        || results.find(r => r.metric?.instance === requested)
        || results.find(r => r.metric && matchesInstance(r.metric.instance, requested));

      console.log('Selected metric for instance:', match?.metric || null);
      const mVal = match?.value?.[1] ?? null;
      const parsed = mVal != null ? parseFloat(mVal) : NaN;
      if (Number.isFinite(parsed)) {
        chosenVal = Number(parsed.toFixed(2));
      }

      // If no valid instant value for this instance, fallback to range and match series by labels
      if (chosenVal == null) {
        disk_is_fallback = true;
        const now = Math.floor(Date.now() / 1000);
        const start = now - 5 * 60; // last 5 minutes
        const end = now;
        const step = 15;
        const params = { query: q, start, end, step };
        const rResp = await axios.get(`${PROM}/api/v1/query_range`, { params });
        rangeResults = rResp.data?.data?.result || [];
        console.debug('[DISK PROM RESULT range]:', rangeResults);

        // try to find matching series by labels
        const matchedSeries = rangeResults.find(s => s.metric?.instance === requested && s.metric?.mountpoint === '/')
          || rangeResults.find(s => s.metric?.instance === requested)
          || rangeResults.find(s => s.metric && matchesInstance(s.metric.instance, requested))
          || rangeResults[0];

        if (matchedSeries) {
          const vals = matchedSeries.values || [];
          for (let i = vals.length - 1; i >= 0; i--) {
            const raw = vals[i]?.[1];
            const n = raw != null ? parseFloat(raw) : NaN;
            if (Number.isFinite(n)) {
              chosenVal = Number(n.toFixed(2));
              break;
            }
          }
        }
      }
    } else {
      // No instance: pick max across returned series
      if (results.length > 0) {
        for (const r of results) {
          const v = parseValue(r);
          if (v != null && (chosenVal == null || v > chosenVal)) chosenVal = v;
        }
      }
      if (chosenVal == null) {
        disk_is_fallback = true;
        const now = Math.floor(Date.now() / 1000);
        const start = now - 5 * 60;
        const end = now;
        const step = 15;
        const params = { query: q, start, end, step };
        const rResp = await axios.get(`${PROM}/api/v1/query_range`, { params });
        rangeResults = rResp.data?.data?.result || [];
        console.debug('[DISK PROM RESULT range]:', rangeResults);
        for (const series of rangeResults) {
          const vals = series.values || [];
          for (let i = vals.length - 1; i >= 0; i--) {
            const raw = vals[i]?.[1];
            const n = raw != null ? parseFloat(raw) : NaN;
            if (Number.isFinite(n)) {
              const v = Number(n.toFixed(2));
              if (chosenVal == null || v > chosenVal) chosenVal = v;
              break;
            }
          }
        }
      } else {
        console.debug('[DISK PROM RESULT range]:', rangeResults);
      }
    }

    const val = chosenVal != null ? Number(chosenVal.toFixed(2)) : null;
    console.debug('[DISK FINAL VALUE]:', val);

    return res.json({ instance: instance || null, disk: val, disk_is_fallback: Boolean(disk_is_fallback) });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

// Return only active instances from Prometheus using the up metric
app.get(['/instances', '/api/instances'], async (req, res) => {
  try {
    const query = 'up{job="vm-servers"} == 1';
    const response = await axios.get(`${PROM}/api/v1/query`, { params: { query } });
    const results = response.data?.data?.result || [];

    const instances = [...new Set(
      results
        .filter((metric) => {
          const value = metric.value?.[1];
          return value === '1' || value === 1;
        })
        .map((metric) => metric.metric?.instance)
        .filter(Boolean)
    )];

    return res.json({ instances });
  } catch (err) {
    return res.status(502).json({ error: err.message, instances: [] });
  }
});

// Range endpoints for sparklines: return raw series per instance (no JS averaging)
app.get(['/cpu/range', '/api/cpu/range'], async (req, res) => {
  try {
    const { instance, start, end, step } = req.query;
    let q;
    if (instance) {
      q = `100 - (avg by (instance) (rate(node_cpu_seconds_total{mode=\"idle\",instance=\"${instance}\"}[1m])) * 100)`;
    } else {
      q = '100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[1m])) * 100)';
    }
    const params = { query: q };
    if (start) params.start = start;
    if (end) params.end = end;
    if (step) params.step = step;
    const response = await axios.get(`${PROM}/api/v1/query_range`, { params });
    const results = response.data?.data?.result || [];
    const series = results.map(r => ({
      instance: r.metric?.instance || null,
      values: (r.values || []).map(v => [Number(v[0]), parseFloat(v[1])])
    }));
    return res.json({ series });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

app.get(['/ram/range', '/api/ram/range'], async (req, res) => {
  try {
    const { instance, start, end, step } = req.query;
    let q;
    if (instance) {
      q = `100 * (1 - node_memory_MemAvailable_bytes{instance=\"${instance}\"} / node_memory_MemTotal_bytes{instance=\"${instance}\"})`;
    } else {
      q = '100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)';
    }
    const params = { query: q };
    if (start) params.start = start;
    if (end) params.end = end;
    if (step) params.step = step;
    const response = await axios.get(`${PROM}/api/v1/query_range`, { params });
    const results = response.data?.data?.result || [];
    const series = results.map(r => ({
      instance: r.metric?.instance || null,
      values: (r.values || []).map(v => [Number(v[0]), parseFloat(v[1])])
    }));
    return res.json({ series });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

app.get(['/disk/range', '/api/disk/range'], async (req, res) => {
  try {
    const { instance, start, end, step } = req.query;
    let q;
    const fsFilter = 'fstype!~"tmpfs"';
    if (instance) {
      q = `100 - ((node_filesystem_avail_bytes{instance=\"${instance}\",mountpoint=\"/\",${fsFilter}} / node_filesystem_size_bytes{instance=\"${instance}\",mountpoint=\"/\",${fsFilter}}) * 100)`;
    } else {
      q = `100 - ((node_filesystem_avail_bytes{mountpoint=\"/\",${fsFilter}} / node_filesystem_size_bytes{mountpoint=\"/\",${fsFilter}}) * 100)`;
    }
    const params = { query: q };
    if (start) params.start = start;
    if (end) params.end = end;
    if (step) params.step = step;
    const response = await axios.get(`${PROM}/api/v1/query_range`, { params });
    const results = response.data?.data?.result || [];
    const series = results.map(r => ({
      instance: r.metric?.instance || null,
      values: (r.values || []).map(v => [Number(v[0]), parseFloat(v[1])])
    }));
    // If instance provided, prefer matching series and return only that series
    if (instance) {
      const match = series.find(s => s.instance && matchesInstance(s.instance, instance)) || series[0] || { instance: instance, values: [] };
      return res.json({ series: [match] });
    }
    return res.json({ series });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

// Diagnostic endpoint: return raw Prometheus responses for size and avail, parsed values and computed disk usage
app.get(['/disk/check', '/api/disk/check'], async (req, res) => {
  try {
    const instance = req.query.instance;
    const fsFilter = 'fstype!~"tmpfs"';

    const sizeQ = instance
      ? `node_filesystem_size_bytes{instance=\"${instance}\",mountpoint=\"/\",${fsFilter}}`
      : `node_filesystem_size_bytes{mountpoint=\"/\",${fsFilter}}`;
    const availQ = instance
      ? `node_filesystem_avail_bytes{instance=\"${instance}\",mountpoint=\"/\",${fsFilter}}`
      : `node_filesystem_avail_bytes{mountpoint=\"/\",${fsFilter}}`;

    const [sizeResp, availResp] = await Promise.all([
      axios.get(`${PROM}/api/v1/query`, { params: { query: sizeQ } }),
      axios.get(`${PROM}/api/v1/query`, { params: { query: availQ } })
    ]);

    console.debug('[prom-proxy] disk/check sizeResp:', JSON.stringify(sizeResp.data));
    console.debug('[prom-proxy] disk/check availResp:', JSON.stringify(availResp.data));

    const sizeResults = sizeResp.data?.data?.result || [];
    const availResults = availResp.data?.data?.result || [];

    // Prefer series matching the requested instance label when available
    const sizeMatch = instance ? (sizeResults.find(r => r.metric && matchesInstance(r.metric.instance, instance)) || sizeResults[0]) : sizeResults[0];
    const availMatch = instance ? (availResults.find(r => r.metric && matchesInstance(r.metric.instance, instance)) || availResults[0]) : availResults[0];

    const rawSize = sizeMatch?.value?.[1] ?? null;
    const rawAvail = availMatch?.value?.[1] ?? null;
    const parsedSize = rawSize != null ? parseFloat(rawSize) : 0;
    const parsedAvail = rawAvail != null ? parseFloat(rawAvail) : 0;

    let diskPct = 0;
    if (parsedSize > 0) {
      diskPct = 100 - (parsedAvail / parsedSize) * 100;
      if (!Number.isFinite(diskPct) || Number.isNaN(diskPct)) diskPct = 0;
    }
    diskPct = Number(diskPct.toFixed(2));

    return res.json({
      instance: instance || null,
      raw: { size: sizeResp.data, avail: availResp.data },
      parsed: { size: parsedSize, avail: parsedAvail },
      disk: diskPct,
      chosen: { sizeMetric: sizeMatch?.metric || null, availMetric: availMatch?.metric || null }
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`prom-proxy running on http://localhost:${PORT}`));
