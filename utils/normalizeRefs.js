const mongoose = require('mongoose');

const normalizeObjectId = (value) => {
  if (!value) return undefined;

  if (typeof value === 'object' && value?._id) {
    return mongoose.Types.ObjectId.isValid(value._id) ? String(value._id) : undefined;
  }

  if (typeof value === 'string') {
    if (value === '[object Object]') return undefined;
    if (value.startsWith('{') && value.endsWith('}')) {
      try {
        const parsed = JSON.parse(value);
        const candidate = parsed?._id;
        return mongoose.Types.ObjectId.isValid(candidate) ? String(candidate) : undefined;
      } catch (_) {
        return undefined;
      }
    }

    return mongoose.Types.ObjectId.isValid(value) ? value : undefined;
  }

  return undefined;
};

const normalizeStringArray = (value) => {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value.split(',').map((v) => v.trim()).filter(Boolean);
  }
  return [];
};

module.exports = {
  normalizeObjectId,
  normalizeStringArray,
};
