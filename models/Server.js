const mongoose = require('mongoose');

const networkCardSchema = new mongoose.Schema({
  count: Number,
  speed: { type: String, enum: ['1G', '10G', '25G', '40G', '100G'] },
  tag: {
    type: String,
    enum: ['MGMT', 'iDRAC', 'BACKUP', 'ISCSI', 'TRUNK']
  }
}, { _id: false });

const diskSchema = new mongoose.Schema({
  count: Number,
  sizeGB: Number,
  type: { type: String, enum: ['NVMe', 'SSD', 'SAS', 'NL-SAS'] }
}, { _id: false });

const serverInterfaceSchema = new mongoose.Schema({
  name: { type: String, trim: true },
  ipAddress: { type: String, trim: true },
  portType: { type: String, trim: true, maxlength: 64 },
}, { _id: false });

const serverSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['Rack', 'Blade'], default: 'Rack' },
  brand: String,
  model: String,
  role: {
    type: String,
    enum: ['Compute', 'Storage', 'Backup', 'Management', 'Other'],
    default: 'Compute'
  },
  cpu: {
    count: Number,
    model: String
  },
  ramGB: Number,
  disks: [diskSchema],
  networkCards: [networkCardSchema],
  portTypes: [{ type: String, trim: true, maxlength: 64 }],
  interfaces: [serverInterfaceSchema],
  power: {
    count: { type: Number, default: 2 },
    consumptionW: Number
  },
  idrac: {
    ip: String,
    username: String
  },
  serialNumber: String,
  supportExpiry: Date,
  // Physical location
  datacenter: { type: mongoose.Schema.Types.ObjectId, ref: 'Datacenter' },
  rack: { type: mongoose.Schema.Types.ObjectId, ref: 'Rack' },
  uStart: Number,   // e.g. 10
  uEnd: Number,     // e.g. 12  (occupies U10, U11, U12)
  description: String,
  notes: String,
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

serverSchema.index({ name: 1 });
serverSchema.index({ serialNumber: 1 });
serverSchema.index({ 'idrac.ip': 1 });
serverSchema.index({ datacenter: 1, rack: 1 });
serverSchema.index({ supportExpiry: 1 });

module.exports = mongoose.model('Server', serverSchema);