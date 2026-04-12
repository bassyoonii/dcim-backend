const AuditLog = require('../models/AuditLog');

const logAction = async (userId, action, entity, entityId, changes, ip) => {
  try {
    await AuditLog.create({
      user: userId,
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