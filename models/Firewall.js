const mongoose = require('mongoose');

const firewallSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 64 },
  brand: { type: String, trim: true, maxlength: 64 },
  model: { type: String, trim: true, maxlength: 64 },
  role: { type: String, trim: true, maxlength: 64 }, // Edge/Internal/WAF/VPN...
  throughputGbps: { type: Number, min: 0 },
  vdomCount: { type: Number, min: 0 },
  portsSummary: { type: String, trim: true, maxlength: 300 },
  portGroups: {
    type: [
      {
        portType: { type: String, trim: true, maxlength: 64 },
        count: { type: Number, min: 0, default: 0 },
        switch: { type: mongoose.Schema.Types.ObjectId, ref: 'Switch' },
        switchPort: { type: String, trim: true, maxlength: 64 },
        vlanId: { type: Number, min: 1, max: 4094 },
        vlanName: { type: String, trim: true, maxlength: 64 },
        ipAddress: { type: String, trim: true, maxlength: 64 },
        subnetMask: { type: String, trim: true, maxlength: 64 },
        gateway: { type: String, trim: true, maxlength: 64 }
      }
    ],
    default: []
  },
  power: {
    count: { type: Number, default: 2, min: 0 },
    consumptionW: { type: Number, min: 0 }
  },
  management: {
    ip: { type: String, trim: true, maxlength: 64 },
    subnetMask: { type: String, trim: true, maxlength: 64 },
    gateway: { type: String, trim: true, maxlength: 64 }
  },
  licenses: {
    type: { type: String, trim: true, maxlength: 128 },
    expiry: { type: Date }
  },
  supportExpiry: { type: Date },
  // Physical location
  datacenter: { type: mongoose.Schema.Types.ObjectId, ref: 'Datacenter', index: true },
  rack: { type: mongoose.Schema.Types.ObjectId, ref: 'Rack', index: true },
  uStart: { type: Number, min: 0 },
  uEnd: { type: Number, min: 0 },
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

firewallSchema.pre('validate', function (next) {
  if (this.uStart && this.uEnd && this.uStart > this.uEnd) {
    return next(new Error('uStart cannot be greater than uEnd'));
  }
  return next();
});

firewallSchema.index({ name: 1 });
firewallSchema.index({ supportExpiry: 1 });

module.exports = mongoose.model('Firewall', firewallSchema);
