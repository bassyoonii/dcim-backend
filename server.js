const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const ensureDefaultAdmin = require('./utils/ensureDefaultAdmin');
const { startSupportNotificationJob } = require('./jobs/supportNotifications');
const { initSocket } = require('./socket');
const { startPeriodicDiscovery } = require('./utils/vmDiscovery');
const fs = require('fs');
const axios = require('axios');
dotenv.config({ path: './.env' });

const PROM_URL = process.env.PROMETHEUS_URL || process.env.PROM_URL || 'http://192.168.139.128:9090';

async function fetchActiveInstancesFromPrometheus() {
  const query = 'up{job="vm-servers"} == 1';
  const url = `${PROM_URL.replace(/\/+$/g, '')}/api/v1/query`;

  const response = await axios.get(url, {
    params: { query },
    timeout: 5000,
  });

  const results = response.data?.data?.result || [];

  return results
    .filter((metric) => {
      const value = metric.value?.[1];
      return value === '1' || value === 1;
    })
    .map((metric) => metric.metric?.instance)
    .filter(Boolean);
}

const app = express();

// Avoid caching API JSON responses (prevents 304 Not Modified with empty bodies in some clients)
app.set('etag', false);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
const allowedOrigins = (process.env.CLIENT_URLS || process.env.CLIENT_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  allowedOrigins.push('http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000');
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow tools and same-origin requests that do not send an Origin header.
    if (!origin) return callback(null, true);

    // In development, accept localhost/127.0.0.1 on any port.
    if (
      process.env.NODE_ENV !== 'production' &&
      /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
    ) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) return callback(null, true);

    // Never throw here: returning false avoids 500 on preflight.
    return callback(null, false);
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204
}));
app.use(morgan('dev'));
app.use(express.json());

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Serve uploaded files (e.g., user avatars)
app.use(
  '/uploads',
  (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  },
  express.static(path.join(__dirname, 'uploads'))
);

app.use('/api/auth',        require('./routes/auth'));
app.use('/api/users',       require('./routes/users'));
app.use('/api/audit-logs',  require('./routes/auditLogs'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/datacenters-map', require('./routes/datacentersMap'));
app.use('/api/datacenters', require('./routes/datacenters'));
app.use('/api/racks',       require('./routes/racks'));
app.use('/api/servers',     require('./routes/servers'));
app.use('/api/switches',    require('./routes/switches'));
app.use('/api/storage',      require('./routes/storage'));
app.use('/api/network-ports', require('./routes/networkPorts'));
app.use('/api/cables',       require('./routes/cables'));
app.use('/api/vlans',        require('./routes/vlans'));
app.use('/api/port-types',   require('./routes/portTypes'));
app.use('/api/certifications', require('./routes/certifications'));
app.use('/api/firewalls',    require('./routes/firewalls'));
app.use('/api/reporting',    require('./routes/reporting'));
app.use('/api/search',       require('./routes/search'));
app.use('/api/dashboard',    require('./routes/dashboard'));
app.use('/api/prometheus',   require('./routes/prometheus'));
app.use('/api/vm-discovery', require('./routes/vmDiscovery'));
app.use('/api/vms',          require('./routes/vms'));

app.get(['/api/instances', '/instances'], async (req, res) => {
  try {
    const instances = await fetchActiveInstancesFromPrometheus();
    return res.json({ success: true, instances, count: instances.length });
  } catch (err) {
    console.error('[api/instances] Error:', err.message || err);
    return res.status(503).json({ success: false, message: 'Prometheus is unreachable', instances: [] });
  }
});

// quick check route to verify prometheus proxy is reachable
app.get('/api/prometheus/check', (req, res) => res.json({ success: true, message: 'prometheus proxy registered' }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();

  try {
    await ensureDefaultAdmin();
  } catch (err) {
    console.warn('[bootstrap] ensureDefaultAdmin failed:', err.message);
  }

  try {
    console.log('[bootstrap] starting supportNotifications job');
    startSupportNotificationJob();
    console.log('[bootstrap] supportNotifications job initialized');
  } catch (err) {
    console.warn('[bootstrap] supportNotifications failed:', err.message);
  }

  const server = http.createServer(app);

  try {
    initSocket(server, { corsOrigins: allowedOrigins });
    console.log('[bootstrap] Socket.IO initialized');
  } catch (err) {
    console.warn('[bootstrap] Socket.IO init failed:', err.message);
  }

  try {
    const discoveryInterval = parseInt(process.env.VM_DISCOVERY_INTERVAL || '30000', 10);
    startPeriodicDiscovery(discoveryInterval);
    console.log('[bootstrap] VM discovery service started');
  } catch (err) {
    console.warn('[bootstrap] VM discovery init failed:', err.message);
  }

  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
};

startServer();