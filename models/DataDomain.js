const mongoose = require('mongoose');

const dataDomainSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 64 },
  model: { type: String, trim: true, maxlength: 64 },
  serviceTag: { type: String, trim: true, maxlength: 128 },
  firmwareVersion: { type: String, trim: true, maxlength: 128 },
  acquisitionDate: { type: Date },
  totalCapacityTB: { type: Number, min: 0, default: 0 },
  usedCapacityTB: { type: Number, default: 0, min: 0 },
  type: { type: String, enum: ['Backup', 'Archive'], default: 'Backup' },
  supportExpiry: Date,
  datacenter: { type: mongoose.Schema.Types.ObjectId, ref: 'Datacenter', index: true },
  rack: { type: mongoose.Schema.Types.ObjectId, ref: 'Rack', index: true },
  uStart: { type: Number, min: 0 },
  uEnd: { type: Number, min: 0 },
  diskCount: { type: Number, min: 0, default: 0 },
  diskBreakdown: {
    type: [
      {
        mediaType: { type: String, trim: true, maxlength: 32 },
        quantity: { type: Number, min: 0, default: 0 }
      }
    ],
    default: []
  },
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
  networkConnections: [String],
  description: { type: String, trim: true, maxlength: 2000, default: '' },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

dataDomainSchema.pre('validate', function (next) {
  if (this.usedCapacityTB > this.totalCapacityTB) {
    return next(new Error('Used capacity cannot exceed total capacity'));
  }
  if (this.uStart && this.uEnd && this.uStart > this.uEnd) {
    return next(new Error('uStart cannot be greater than uEnd'));
  }
  return next();
});

dataDomainSchema.virtual('freeCapacityTB').get(function () {
  return Math.max((this.totalCapacityTB || 0) - (this.usedCapacityTB || 0), 0);
});

dataDomainSchema.index({ name: 1 });
dataDomainSchema.index({ type: 1 });
dataDomainSchema.index({ datacenter: 1, rack: 1 });
dataDomainSchema.index({ supportExpiry: 1 });
dataDomainSchema.index({ networkConnections: 1 });

module.exports = mongoose.model('DataDomain', dataDomainSchema);