const mongoose = require('mongoose');

const certificationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true,
    default: ''
  }
}, { _id: false });

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
  certifications: {
    type: [certificationSchema],
    default: []
  },
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

datacenterSchema.pre('validate', function normalizeCertifications(next) {
  if (!Array.isArray(this.certifications)) {
    this.certifications = [];
    return next();
  }

  this.certifications = this.certifications
    .map((cert) => {
      if (typeof cert === 'string') {
        const name = cert.trim();
        return name ? { name, description: '' } : null;
      }

      if (cert && typeof cert === 'object') {
        const name = String(cert.name || '').trim();
        if (!name) return null;
        return {
          name,
          description: String(cert.description || '').trim()
        };
      }

      return null;
    })
    .filter(Boolean);

  next();
});

module.exports = mongoose.model('Datacenter', datacenterSchema);