const mongoose = require('mongoose');

const supportNotificationSchema = new mongoose.Schema({
  assetType: {
    type: String,
    enum: ['Server', 'StorageBay', 'DataDomain', 'Switch', 'Firewall'],
    required: true,
    index: true
  },
  assetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  supportExpiry: { type: Date, required: true },
  firstAlertSentAt: { type: Date },
  lastReminderSentAt: { type: Date },
  lastError: { type: String, trim: true, maxlength: 1000, default: '' }
}, { timestamps: true });

supportNotificationSchema.index({ assetType: 1, assetId: 1 }, { unique: true });
supportNotificationSchema.index({ supportExpiry: 1 });

module.exports = mongoose.model('SupportNotification', supportNotificationSchema);
