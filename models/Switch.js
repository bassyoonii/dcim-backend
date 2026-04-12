const mongoose = require('mongoose');

const switchSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 64 },
  brand: { type: String, trim: true, maxlength: 64 },
  model: { type: String, trim: true, maxlength: 64 },
  ipAddress: { type: String, trim: true, maxlength: 64 },
  subnetMask: { type: String, trim: true, maxlength: 64 },
  gateway: { type: String, trim: true, maxlength: 64 },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  type: {
    type: String,
    enum: ['Core', 'Distribution', 'Access', 'TOR'],
    required: true
  },
  serialNumber: { type: String, trim: true, maxlength: 128 },
  hardwareVersion: { type: String, trim: true, maxlength: 64 },
  osVersion: { type: String, trim: true, maxlength: 128 },
  acquisitionDate: { type: Date },
  supportExpiry: { type: Date },
  totalPorts: { type: Number, default: 24, min: 1 },
  portTypes: [{ type: String, trim: true, maxlength: 64 }],
  usedPorts: { type: Number, default: 0, min: 0 },
  reservedPorts: { type: Number, default: 0, min: 0 },
  portSpeed: { type: String, trim: true },     // e.g. '10G', '25G'
  firmware: { type: String, trim: true },
  redundantPower: { type: Boolean, default: true },
  consumptionW: { type: Number, default: 0, min: 0 },
  // Physical location
  datacenter: { type: mongoose.Schema.Types.ObjectId, ref: 'Datacenter', index: true },
  rack: { type: mongoose.Schema.Types.ObjectId, ref: 'Rack', index: true },
  uStart: { type: Number, min: 0 },
  uEnd: { type: Number, min: 0 },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

switchSchema.pre('validate', function (next) {
  if (this.usedPorts + this.reservedPorts > this.totalPorts) {
    return next(new Error('Used + reserved ports cannot exceed total ports'));
  }
  if (this.uStart && this.uEnd && this.uStart > this.uEnd) {
    return next(new Error('uStart cannot be greater than uEnd'));
  }
  return next();
});

// Virtual: free ports
switchSchema.virtual('freePorts').get(function () {
  return this.totalPorts - this.usedPorts - this.reservedPorts;
});

switchSchema.index({ name: 1 });
switchSchema.index({ type: 1 });
switchSchema.index({ datacenter: 1, rack: 1 });
switchSchema.index({ supportExpiry: 1 });
switchSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Switch', switchSchema);