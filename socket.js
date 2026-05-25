const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('./models/User');

let io = null;

const extractToken = (socket) => {
  const authToken = socket.handshake?.auth?.token;
  if (authToken) return authToken;

  const header = socket.handshake?.headers?.authorization;
  if (!header) return null;

  const m = String(header).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
};

const initSocket = (httpServer, { corsOrigins = [] } = {}) => {
  io = new Server(httpServer, {
    cors: {
      origin: corsOrigins.length ? corsOrigins : true,
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  io.use(async (socket, next) => {
    try {
      const token = extractToken(socket);
      if (!token) return next(new Error('Unauthorized'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('_id name role isActive');
      if (!user || !user.isActive) return next(new Error('Unauthorized'));

      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    try {
      const userId = socket.user?._id?.toString();
      if (userId) socket.join(`user:${userId}`);
    } catch (e) {
      // ignore
    }
  });

  return io;
};

const getIO = () => io;

module.exports = { initSocket, getIO };
