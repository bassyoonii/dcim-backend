const mongoose = require('mongoose');

const datacenterSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Datacenter name is required'],
    trim: true
  },
  code: {
    type: String,
    required: [true, 'Datacenter code is required'],
    uppercase: true,
    unique: true,
    trim: true   // e.g. DX, TT, EO
  },
  location: {
    address: String,
    city: String,
    country: String,
    coordinates: {
      lat: Number,
      lng: Number
    }
  },
  certifications: [String],  // e.g. ['ISO 27001', 'TIER III']
  totalRacks: { type: Number, default: 0 },
  reservedRacks: { type: Number, default: 0 },
  contacts: {
    technical: { name: String, email: String, phone: String },
    security: { name: String, email: String, phone: String },
    commercial: { name: String, email: String, phone: String }
  },
  sla: String,
  description: String,
  notes: String,
  documents: [{ name: String, url: String }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

datacenterSchema.index({ name: 1 });
datacenterSchema.index({ 'location.country': 1 });

module.exports = mongoose.model('Datacenter', datacenterSchema);