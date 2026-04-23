const Datacenter = require('../models/Datacenter');
const Rack = require('../models/Rack');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { logAction } = require('../utils/auditLog');
const { parsePagination, parseSort, buildPaginatedPayload } = require('../utils/queryHelpers');
const { geocodeAddress } = require('../utils/geocode');

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
    const body = { ...req.body };
    const location = body.location || {};

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
    return errorResponse(res, err.message, 500);
  }
};

// PUT /api/datacenters/:id
const updateDatacenter = async (req, res) => {
  try {
    const updateData = { ...req.body };
    const loc = updateData.location;
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
    return errorResponse(res, err.message, 500);
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

module.exports = {
  getDatacenters, getDatacenter,
  getDatacenterLocations,
  geocodeProxy,
  createDatacenter, updateDatacenter, deleteDatacenter
};