const Datacenter = require('../models/Datacenter');
const Rack = require('../models/Rack');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { logAction } = require('../utils/auditLog');
const { parsePagination, parseSort, buildPaginatedPayload } = require('../utils/queryHelpers');

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
    const dc = await Datacenter.create({
      ...req.body,
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
    const dc = await Datacenter.findByIdAndUpdate(
      req.params.id,
      req.body,
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

module.exports = {
  getDatacenters, getDatacenter,
  createDatacenter, updateDatacenter, deleteDatacenter
};