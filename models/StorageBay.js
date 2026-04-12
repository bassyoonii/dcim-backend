const mongoose = require('mongoose');

const normalizeEquipmentFamily = (value) => {
  const v = typeof value === 'string' ? value.trim() : value;
  return v === 'Othe' ? 'Other' : v;
};

const storageBaySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 64 },
  brand: { type: String, trim: true, maxlength: 64 },
  model: { type: String, trim: true, maxlength: 64 },
  equipmentFamily: {
    type: String,
    enum: ['PowerVault', 'PowerStore', 'DataDomain', 'Other'],
    default: 'Other',
    set: normalizeEquipmentFamily
  },
  parentStorageBay: { type: mongoose.Schema.Types.ObjectId, ref: 'StorageBay' },
  serviceTag: { type: String, trim: true, maxlength: 128 },
  firmwareVersion: { type: String, trim: true, maxlength: 128 },
  acquisitionDate: { type: Date },
  storageType: { type: String, enum: ['Block', 'File', 'Object'] },
  diskCount: { type: Number, min: 0, default: 0 },
  totalCapacityTB: { type: Number, min: 0, default: 0 },
  diskType: { type: String, enum: ['NVMe', 'SSD', 'SAS', 'NL-SAS'] },
  diskBreakdown: {
    type: [
      {
        mediaType: { type: String, trim: true, maxlength: 32 },
        quantity: { type: Number, min: 0, default: 0 }
      }
    ],
    default: []
  },
  allocatedCapacityTB: { type: Number, default: 0, min: 0 },
  supportExpiry: Date,
  datacenter: { type: mongoose.Schema.Types.ObjectId, ref: 'Datacenter', index: true },
  rack: { type: mongoose.Schema.Types.ObjectId, ref: 'Rack', index: true },
  uStart: { type: Number, min: 0 },
  uEnd: { type: Number, min: 0 },
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

storageBaySchema.pre('validate', function (next) {
  if (this.allocatedCapacityTB > this.totalCapacityTB) {
    return next(new Error('Allocated capacity cannot exceed total capacity'));
  }
  if (this.uStart && this.uEnd && this.uStart > this.uEnd) {
    return next(new Error('uStart cannot be greater than uEnd'));
  }
  if (this.model === 'ME412' && !this.parentStorageBay) {
    return next(new Error('ME412 must be linked to a parent ME4024 storage bay'));
  }
  return next();
});

storageBaySchema.virtual('freeCapacityTB').get(function () {
  return Math.max((this.totalCapacityTB || 0) - (this.allocatedCapacityTB || 0), 0);
});

storageBaySchema.index({ name: 1 });
storageBaySchema.index({ storageType: 1 });
storageBaySchema.index({ datacenter: 1, rack: 1 });
storageBaySchema.index({ supportExpiry: 1 });
storageBaySchema.index({ networkConnections: 1 });

module.exports = mongoose.model('StorageBay', storageBaySchema);