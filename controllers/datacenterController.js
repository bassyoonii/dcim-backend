const Datacenter = require('../models/Datacenter');
const Rack = require('../models/Rack');
const { successResponse, errorResponse } = require('../utils/apiResponse');
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

// GET /api/datacenters
const getDatacenters = async (req, res) => {
  try {
    const { search, country } = req.query;
    const filter = {};

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } }
      ];
    }
    if (country) filter['location.country'] = country;

    const { page, limit, skip } = parsePagination(req.query);
    const { sortBy, order, sort } = parseSort(req.query, ['name', 'code', 'createdAt']);

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

    return successResponse(res, {
      ...payload,
      filters: {
        search: search || null,
        country: country || null
      },
      sorting: { sortBy, order: order === 1 ? 'asc' : 'desc' }
    });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// GET /api/datacenters/:id
const getDatacenter = async (req, res) => {
  try {
    const dc = await Datacenter.findById(req.params.id)
      .populate('createdBy', 'name email');
    if (!dc) return errorResponse(res, 'Datacenter not found', 404);
    return successResponse(res, dc);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// POST /api/datacenters
const createDatacenter = async (req, res) => {
  try {
    if (!req.user?.id) {
      return errorResponse(res, 'Not authorized, user not found', 401);
    }
    const body = { ...req.body };
    const location = body.location || {};
    const normalizedCoords = extractCoordinates(location);

    if ((location.coordinates || location.latitude != null || location.longitude != null) && !normalizedCoords) {
      return errorResponse(res, 'Invalid coordinates (lat/lng required)', 400);
    }

    if (normalizedCoords) location.coordinates = normalizedCoords;

    if (location.address && (!location.coordinates || !location.coordinates.lat || !location.coordinates.lng)) {
      try {
        const coords = await geocodeAddress([location.address, location.city, location.country].filter(Boolean).join(', '));
        if (coords) location.coordinates = coords;
      } catch (gerr) {
        // ignore geocode failure, continue without coordinates
      }
    }

    const dc = await Datacenter.create({
      ...body,
      location,
      createdBy: req.user.id
    });

    await logAction(req.user.id, 'CREATE', 'Datacenter', dc._id, req.body, req.ip);

    return successResponse(res, dc, 'Datacenter created', 201);
  } catch (err) {
    console.error('[datacenters] create error:', err);
    const mapped = mapMongooseError(err);
    return errorResponse(res, mapped.message, mapped.status);
  }
};

// PUT /api/datacenters/:id
const updateDatacenter = async (req, res) => {
  try {
    const updateData = { ...req.body };
    const loc = updateData.location;
    const normalizedCoords = extractCoordinates(loc);

    if ((loc?.coordinates || loc?.latitude != null || loc?.longitude != null) && !normalizedCoords) {
      return errorResponse(res, 'Invalid coordinates (lat/lng required)', 400);
    }

    if (loc && normalizedCoords) {
      updateData.location = { ...loc, coordinates: normalizedCoords };
    }
    if (loc && loc.address && (!loc.coordinates || !loc.coordinates.lat || !loc.coordinates.lng)) {
      try {
        const coords = await geocodeAddress([loc.address, loc.city, loc.country].filter(Boolean).join(', '));
        if (coords) updateData.location = { ...loc, coordinates: coords };
      } catch (gerr) {
        // ignore geocode failure
      }
    }

    const dc = await Datacenter.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );
    if (!dc) return errorResponse(res, 'Datacenter not found', 404);

    await logAction(req.user.id, 'UPDATE', 'Datacenter', dc._id, req.body, req.ip);

    return successResponse(res, dc, 'Datacenter updated');
  } catch (err) {
    console.error('[datacenters] update error:', err);
    const mapped = mapMongooseError(err);
    return errorResponse(res, mapped.message, mapped.status);
  }
};

// DELETE /api/datacenters/:id
const deleteDatacenter = async (req, res) => {
  try {
    const dc = await Datacenter.findByIdAndDelete(req.params.id);
    if (!dc) return errorResponse(res, 'Datacenter not found', 404);

    await logAction(req.user.id, 'DELETE', 'Datacenter', req.params.id, {}, req.ip);

    return successResponse(res, null, 'Datacenter deleted');
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// GET /api/datacenters/locations
const getDatacenterLocations = async (req, res) => {
  try {
    const { country } = req.query;
    const filter = {
      'location.coordinates.lat': { $exists: true },
      'location.coordinates.lng': { $exists: true }
    };
    if (country) filter['location.country'] = country;

    const dcs = await Datacenter.find(filter).select('name code location').lean();

      const format = (req.query.format || '').toLowerCase();
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
        return successResponse(res, { type: 'FeatureCollection', features });
      }

      return successResponse(res, simple);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// GET /api/datacenters/geocode?q=...  (proxy to backend geocode helper)
const geocodeProxy = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return successResponse(res, null);
    const coords = await geocodeAddress(q);
    return successResponse(res, coords);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// GET /api/datacenters/geocode/reverse?lat=...&lng=... (proxy to backend reverse geocode helper)
const geocodeReverse = async (req, res) => {
  try {
    const lat = req.query.lat;
    const lng = req.query.lng;
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
      return errorResponse(res, 'Invalid coordinates (lat/lng required)', 400);
    }
    const payload = await reverseGeocode(lat, lng);
    return successResponse(res, payload);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

module.exports = {
  getDatacenters, getDatacenter,
  getDatacenterLocations,
  geocodeProxy,
  geocodeReverse,
  createDatacenter, updateDatacenter, deleteDatacenter
};