const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  actorName: { type: String },
  action: { type: String, enum: ['CREATE', 'UPDATE', 'DELETE'], required: true },
  entity: { type: String, required: true },   // e.g. 'Server', 'Rack'
  entityId: mongoose.Schema.Types.ObjectId,
  changes: mongoose.Schema.Types.Mixed,       // what changed
  ip: String
}, { timestamps: true });

module.exports = mongoose.model('AuditLog', auditLogSchema);