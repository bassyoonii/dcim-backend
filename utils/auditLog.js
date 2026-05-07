const AuditLog = require('../models/AuditLog');
const User = require('../models/User');

const logAction = async (userId, action, entity, entityId, changes, ip) => {
  try {
    let actorName = undefined;
    if (userId) {
      try {
        const u = await User.findById(userId).select('name email');
        if (u) actorName = u.name || u.email;
      } catch (e) {
        // ignore user lookup failures
      }
    }

    await AuditLog.create({
      user: userId || undefined,
      actorName,
      action,
      entity,
      entityId,
      changes,
      ip
    });
  } catch (err) {
    // Audit failure should never crash the main request
    console.error('Audit log error:', err.message);
  }
};

module.exports = { logAction };