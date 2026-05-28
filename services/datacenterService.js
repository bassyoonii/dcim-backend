const Datacenter = require('../models/Datacenter');
const Rack = require('../models/Rack');
const { logAction } = require('../utils/auditLog');
const { parsePagination, parseSort, buildPaginatedPayload } = require('../utils/queryHelpers');
const { geocodeAddress, reverseGeocode } = require('../utils/geocode');

const normalizeCoordinates = (coords) => {
  if (!coords) return null;
  const lat = Number(coords.lat);
  const lng = Number(coords.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

const extractCoordinates = (location) => {
  if (!location) return null;
  const direct = normalizeCoordinates(location.coordinates);
  if (direct) return direct;
  if (location.latitude != null || location.longitude != null) {
    return normalizeCoordinates({ lat: location.latitude, lng: location.longitude });
  }
  return null;
};

const mapMongooseError = (err) => {
  if (err?.name === 'ValidationError') {
    const messages = Object.values(err.errors || {}).map((e) => e.message).filter(Boolean);
    return { status: 400, message: messages.length ? messages.join(', ') : 'Validation failed' };
  }
  if (err?.code === 11000) {
    const fields = Object.keys(err.keyPattern || err.keyValue || {});
    const field = fields[0] || 'code';
    return { status: 409, message: `Duplicate ${field}` };
  }
  if (err?.name === 'CastError') {
    return { status: 400, message: `Invalid ${err.path || 'field'}` };
  }
  return { status: 500, message: err?.message || 'Internal server error' };
};

const getDatacenters = async (query) => {
  const { search, country } = query;
  const filter = {};

  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { code: { $regex: search, $options: 'i' } }
    ];
  }
  if (country) filter['location.country'] = country;

  const { page, limit, skip } = parsePagination(query);
  const { sortBy, order, sort } = parseSort(query, ['name', 'code', 'createdAt']);

  const payload = await buildPaginatedPayload({
    model: Datacenter,
    filter,
    populate: [{ path: 'createdBy', select: 'name email' }],
    sort,
    page,
    limit,
    skip
  });

  const datacenterIds = (payload.items || []).map((dc) => dc?._id).filter(Boolean);
  if (datacenterIds.length > 0) {
    const rackCounts = await Rack.aggregate([
      { $match: { datacenter: { $in: datacenterIds } } },
      { $group: { _id: '$datacenter', count: { $sum: 1 } } }
    ]);

    const rackCountByDatacenterId = new Map(
      rackCounts.map((row) => [String(row._id), row.count])
    );

    payload.items.forEach((dc) => {
      dc.totalRacks = rackCountByDatacenterId.get(String(dc._id)) || 0;
    });
  }

  return {
    ...payload,
    filters: {
      search: search || null,
      country: country || null
    },
    sorting: { sortBy, order: order === 1 ? 'asc' : 'desc' }
  };
};

const getDatacenterById = async (id) => {
  const dc = await Datacenter.findById(id)
    .populate('createdBy', 'name email');

  if (!dc) {
    const err = new Error('Datacenter not found');
    err.statusCode = 404;
    throw err;
  }

  return dc;
};

const createDatacenter = async ({ body, userId, ip }) => {
  if (!userId) {
    const err = new Error('Not authorized, user not found');
    err.statusCode = 401;
    throw err;
  }

  const data = { ...body };
  const location = data.location || {};
  const normalizedCoords = extractCoordinates(location);

  if ((location.coordinates || location.latitude != null || location.longitude != null) && !normalizedCoords) {
    const err = new Error('Invalid coordinates (lat/lng required)');
    err.statusCode = 400;
    throw err;
  }

  if (normalizedCoords) location.coordinates = normalizedCoords;

  if (location.address && (!location.coordinates || !location.coordinates.lat || !location.coordinates.lng)) {
    try {
      const coords = await geocodeAddress([location.address, location.city, location.country].filter(Boolean).join(', '));
      if (coords) location.coordinates = coords;
    } catch {
      // ignore geocode failure, continue without coordinates
    }
  }

  const dc = await Datacenter.create({
    ...data,
    location,
    createdBy: userId
  });

  await logAction(userId, 'CREATE', 'Datacenter', dc._id, body, ip);

  return dc;
};

const updateDatacenter = async ({ id, body, userId, ip }) => {
  const updateData = { ...body };
  const loc = updateData.location;
  const normalizedCoords = extractCoordinates(loc);

  if ((loc?.coordinates || loc?.latitude != null || loc?.longitude != null) && !normalizedCoords) {
    const err = new Error('Invalid coordinates (lat/lng required)');
    err.statusCode = 400;
    throw err;
  }

  if (loc && normalizedCoords) {
    updateData.location = { ...loc, coordinates: normalizedCoords };
  }
  if (loc && loc.address && (!loc.coordinates || !loc.coordinates.lat || !loc.coordinates.lng)) {
    try {
      const coords = await geocodeAddress([loc.address, loc.city, loc.country].filter(Boolean).join(', '));
      if (coords) updateData.location = { ...loc, coordinates: coords };
    } catch {
      // ignore geocode failure
    }
  }

  const dc = await Datacenter.findByIdAndUpdate(
    id,
    updateData,
    { new: true, runValidators: true }
  );
  if (!dc) {
    const err = new Error('Datacenter not found');
    err.statusCode = 404;
    throw err;
  }

  await logAction(userId, 'UPDATE', 'Datacenter', dc._id, body, ip);

  return dc;
};

const deleteDatacenter = async ({ id, userId, ip }) => {
  const dc = await Datacenter.findByIdAndDelete(id);
  if (!dc) {
    const err = new Error('Datacenter not found');
    err.statusCode = 404;
    throw err;
  }

  await logAction(userId, 'DELETE', 'Datacenter', id, {}, ip);

  return null;
};

const getDatacenterLocations = async (query) => {
  const { country } = query;
  const filter = {
    'location.coordinates.lat': { $exists: true },
    'location.coordinates.lng': { $exists: true }
  };
  if (country) filter['location.country'] = country;

  const dcs = await Datacenter.find(filter).select('name code location').lean();

  const format = (query.format || '').toLowerCase();
  const simple = (dcs || []).map((dc) => ({
    id: String(dc._id),
    name: dc.name || null,
    code: dc.code || null,
    address: dc.location?.address || null,
    city: dc.location?.city || null,
    country: dc.location?.country || null,
    coordinates: dc.location?.coordinates || null
  }));

  if (format === 'geojson') {
    const features = simple.map((s) => {
      const coords = s.coordinates;
      return {
        type: 'Feature',
        id: s.id,
        properties: {
          name: s.name,
          code: s.code,
          address: s.address,
          city: s.city,
          country: s.country
        },
        geometry: coords && typeof coords.lat === 'number' && typeof coords.lng === 'number'
          ? { type: 'Point', coordinates: [coords.lng, coords.lat] }
          : null
      };
    });
    return { type: 'FeatureCollection', features };
  }

  return simple;
};

const getDatacentersMap = async () => {
  const filter = {
    'location.coordinates.lat': { $exists: true },
    'location.coordinates.lng': { $exists: true }
  };

  const dcs = await Datacenter.find(filter)
    .select('name location.coordinates')
    .lean();

  return (dcs || [])
    .map((dc) => ({
      id: String(dc._id),
      name: dc.name || null,
      lat: dc.location?.coordinates?.lat ?? null,
      lng: dc.location?.coordinates?.lng ?? null
    }))
    .filter((dc) => Number.isFinite(dc.lat) && Number.isFinite(dc.lng));
};

const geocodeProxy = async (query) => {
  const q = (query.q || '').trim();
  if (!q) return null;
  return geocodeAddress(q);
};

const geocodeReverse = async (query) => {
  const lat = query.lat;
  const lng = query.lng;
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
    const err = new Error('Invalid coordinates (lat/lng required)');
    err.statusCode = 400;
    throw err;
  }
  return reverseGeocode(lat, lng);
};

module.exports = {
  getDatacenters,
  getDatacenterById,
  createDatacenter,
  updateDatacenter,
  deleteDatacenter,
  getDatacenterLocations,
  getDatacentersMap,
  geocodeProxy,
  geocodeReverse,
  mapMongooseError
};
