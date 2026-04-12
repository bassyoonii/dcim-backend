const mongoose = require('mongoose');

const cableSchema = new mongoose.Schema({
  cableType: {
    type: String,
    enum: ['Network', 'Power'],
    required: true
  },
  // Network cable fields
  network: {
    sourceDevice: {
      deviceType: { type: String, enum: ['Server', 'Switch', 'StorageBay', 'DataDomain', 'Firewall', 'Other'] },
      deviceId: mongoose.Schema.Types.ObjectId,
      port: String
    },
    destDevice: {
      deviceType: { type: String, enum: ['Server', 'Switch', 'StorageBay', 'DataDomain', 'Firewall', 'Other'] },
      deviceId: mongoose.Schema.Types.ObjectId,
      port: String
    },
    medium: { type: String, enum: ['Copper', 'Fiber'] },
    speedGbps: { type: Number, min: 0 },
    vlanId: { type: Number, min: 1, max: 4094 },
    vlanTag: { type: String, trim: true, maxlength: 64 },
    color: { type: String, trim: true, maxlength: 32 }
  },
  // Power cable fields
  power: {
    pdu: { type: String, trim: true },
    pduPort: { type: String, trim: true },
    poweredDevice: {
      deviceType: { type: String, enum: ['Server', 'Switch', 'StorageBay', 'DataDomain', 'Firewall', 'Other'] },
      deviceId: mongoose.Schema.Types.ObjectId
    }
  },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

cableSchema.pre('validate', function (next) {
  if (this.cableType === 'Network') {
    if (!this.network?.sourceDevice?.deviceId || !this.network?.destDevice?.deviceId) {
      return next(new Error('Network cable requires source and destination device references'));
    }
  }

  if (this.cableType === 'Power') {
    if (!this.power?.pdu || !this.power?.pduPort || !this.power?.poweredDevice?.deviceId) {
      return next(new Error('Power cable requires PDU, PDU port, and powered device'));
    }
  }

  return next();
});

cableSchema.index({ cableType: 1, createdAt: -1 });
cableSchema.index({ 'network.medium': 1 });
cableSchema.index({ 'network.sourceDevice.deviceId': 1 });
cableSchema.index({ 'network.destDevice.deviceId': 1 });
cableSchema.index({ 'power.poweredDevice.deviceId': 1 });

module.exports = mongoose.model('Cable', cableSchema);