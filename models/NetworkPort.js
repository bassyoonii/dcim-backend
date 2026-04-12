const mongoose = require('mongoose');

const networkPortSchema = new mongoose.Schema({
  portNumber: { type: String, required: true, trim: true },
  switch: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Switch',
    required: true,
    index: true
  },
  speedGbps: { type: Number, min: 0 },
  ipAddress: { type: String, trim: true },
  vlanId: { type: Number, min: 1, max: 4094 },
  vlanTag: { type: String, trim: true, maxlength: 64 },
  portType: { type: String, enum: ['Access', 'Trunk'], default: 'Access' },
  portProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'PortType' },
  // What is connected to this port
  connectedDevice: {
    deviceType: { type: String, enum: ['Server', 'Switch', 'StorageBay', 'DataDomain', 'Firewall', 'Other'] },
    deviceId: mongoose.Schema.Types.ObjectId,
    deviceName: String
  },
  networkCard: { type: String, trim: true },      // which NIC on the connected device
  status: { type: String, enum: ['Up', 'Down'], default: 'Down' },
  description: { type: String, trim: true, maxlength: 500, default: '' },
  notes: { type: String, trim: true, maxlength: 1000, default: '' }
}, { timestamps: true });

networkPortSchema.index({ switch: 1, portNumber: 1 }, { unique: true });
networkPortSchema.index({ ipAddress: 1 });
networkPortSchema.index({ vlanId: 1 });
networkPortSchema.index({ vlanTag: 1 });
networkPortSchema.index({ networkCard: 1 });
networkPortSchema.index({ status: 1 });

networkPortSchema.pre('validate', function (next) {
  if (this.portType === 'Access' && this.vlanTag && this.vlanTag.toLowerCase() === 'trunk') {
    return next(new Error('Access port cannot have TRUNK vlan tag'));
  }
  return next();
});

module.exports = mongoose.model('NetworkPort', networkPortSchema);