const mongoose = require('mongoose');

const vlanSchema = new mongoose.Schema({
  vlanId: { type: Number, required: true, min: 1, max: 4094 },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  network: { type: String, trim: true, maxlength: 64 }, // e.g. 10.10.0.0
  subnetMask: { type: String, trim: true, maxlength: 64 }, // e.g. 255.255.255.0 or /24
  gateway: { type: String, trim: true, maxlength: 64 },
  notes: { type: String, trim: true, maxlength: 1000, default: '' },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

vlanSchema.index({ vlanId: 1 }, { unique: true });
vlanSchema.index({ name: 1 });

module.exports = mongoose.model('Vlan', vlanSchema);
