const mongoose = require('mongoose');

const portTypeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  equipmentType: {
    type: String,
    required: true,
    enum: ['Server', 'Switch', 'Firewall', 'Storage', 'Other'],
    default: 'Other'
  },
  speedGbps: { type: Number, min: 0 },
  connector: {
    type: String,
    enum: ['RJ45', 'SFP', 'SFP+', 'QSFP', 'QSFP28', 'Other'],
    default: 'Other'
  },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

portTypeSchema.index({ name: 1, equipmentType: 1 }, { unique: true });

module.exports = mongoose.model('PortType', portTypeSchema);
