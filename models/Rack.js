const mongoose = require('mongoose');

const rackSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Rack name is required'],
    trim: true,
    minlength: [2, 'Rack name must be at least 2 characters'],
    maxlength: [64, 'Rack name cannot exceed 64 characters']
  },
  datacenter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Datacenter',
    required: [true, 'Datacenter is required'],
    index: true
  },
  location: {
    type: String,
    required: [true, 'Rack location is required'],
    trim: true,
    maxlength: [120, 'Location cannot exceed 120 characters']
  },
  totalU: {
    type: Number,
    required: [true, 'Rack capacity (U) is required'],
    default: 42,
    min: [1, 'Rack capacity must be at least 1U'],
    max: [60, 'Rack capacity cannot exceed 60U'],
    alias: 'capacity'
  },
  occupiedU: {
    type: Number,
    default: 0,
    min: [0, 'Occupied U cannot be negative']
  },
  status: {
    type: String,
    enum: ['active', 'maintenance', 'retired'],
    default: 'active',
    index: true
  },
  uNumberingScheme: {
    type: String,
    enum: ['bottom-to-top', 'top-to-bottom'],
    default: 'bottom-to-top'
  },
  powerType: {
    type: String,
    enum: ['AC', 'DC'],
    default: 'AC'
  },
  pduCount: {
    type: Number,
    default: 2,
    min: [0, 'PDU count cannot be negative']
  },
  pduPorts: {
    type: Number,
    default: 16,
    min: [0, 'PDU ports cannot be negative']
  },
  maxPowerConsumption: {
    type: Number,
    default: 0,
    min: [0, 'Max power consumption cannot be negative']
  },
  currentPowerConsumption: {
    type: Number,
    default: 0,
    min: [0, 'Current power consumption cannot be negative']
  },
  temperature: {
    type: Number,
    min: [-20, 'Temperature seems too low'],
    max: [80, 'Temperature seems too high']
  },
  notes: {
    type: String,
    default: '',
    trim: true,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Creator is required']
  }
}, {
  timestamps: true,
  strict: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

rackSchema.index({ datacenter: 1, name: 1 }, { unique: true });

rackSchema.pre('validate', function (next) {
  if (this.occupiedU > this.totalU) {
    return next(new Error('Occupied U cannot exceed total rack capacity'));
  }

  if (this.maxPowerConsumption > 0 && this.currentPowerConsumption > this.maxPowerConsumption) {
    return next(new Error('Current power consumption cannot exceed max power consumption'));
  }

  return next();
});

// Virtual: remaining U slots
rackSchema.virtual('remainingU').get(function () {
  return Math.max(this.totalU - (this.occupiedU || 0), 0);
});

module.exports = mongoose.model('Rack', rackSchema);