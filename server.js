const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const dotenv = require('dotenv');
const connectDB = require('./config/db');
const ensureDefaultAdmin = require('./utils/ensureDefaultAdmin');
const { startSupportNotificationJob } = require('./jobs/supportNotifications');

dotenv.config();

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

// Never cache API responses
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
    startSupportNotificationJob();
  } catch (err) {
    console.warn('[bootstrap] supportNotifications failed:', err.message);
  }

  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
};

startServer();