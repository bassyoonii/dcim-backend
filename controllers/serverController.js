const Server = require('../models/Server');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { logAction } = require('../utils/auditLog');
const { parsePagination, parseSort, buildPaginatedPayload } = require('../utils/queryHelpers');

// GET /api/servers  — supports filters: datacenter, rack, role, brand
const getServers = async (req, res) => {
  try {
    const {
      datacenter,
      rack,
      datacenterId,
      rackId,
      role,
      type,
      brand,
      search
    } = req.query;
    const filter = {};

    if (datacenterId || datacenter) filter.datacenter = datacenterId || datacenter;
    if (rackId || rack) filter.rack = rackId || rack;
    if (role) filter.role = role;
    if (type) filter.type = type;
    if (brand) filter.brand = { $regex: brand, $options: 'i' };
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { serialNumber: { $regex: search, $options: 'i' } },
        { 'idrac.ip': { $regex: search, $options: 'i' } }
      ];
    }

    const { page, limit, skip } = parsePagination(req.query);
    const { sortBy, order, sort } = parseSort(req.query, ['name', 'supportExpiry', 'ramGB', 'createdAt']);

    const payload = await buildPaginatedPayload({
      model: Server,
      filter,
      populate: ['datacenter', 'rack'],
      sort,
      page,
      limit,
      skip
    });

    return successResponse(res, {
      ...payload,
      filters: {
        datacenterId: datacenterId || datacenter || null,
        rackId: rackId || rack || null,
        role: role || null,
        type: type || null,
        brand: brand || null,
        search: search || null
      },
      sorting: { sortBy, order: order === 1 ? 'asc' : 'desc' }
    });
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// GET /api/servers/:id
const getServer = async (req, res) => {
  try {
    const server = await Server.findById(req.params.id)
      .populate('datacenter', 'name code')
      .populate('rack', 'name totalU');

    if (!server) return errorResponse(res, 'Server not found', 404);
    return successResponse(res, server);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// POST /api/servers
const createServer = async (req, res) => {
  try {
    const datacenter = typeof req.body.datacenter === 'object'
      ? req.body.datacenter?._id
      : req.body.datacenter;
    const rack = typeof req.body.rack === 'object'
      ? req.body.rack?._id
      : req.body.rack;

    const payload = {
      ...req.body,
      ...(datacenter ? { datacenter } : {}),
      ...(rack ? { rack } : {}),
      createdBy: req.user.id
    };

    const server = await Server.create(payload);
    await logAction(req.user.id, 'CREATE', 'Server', server._id, req.body, req.ip);
    return successResponse(res, server, 'Server created', 201);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// PUT /api/servers/:id
const updateServer = async (req, res) => {
  try {
    const datacenter = typeof req.body.datacenter === 'object'
      ? req.body.datacenter?._id
      : req.body.datacenter;
    const rack = typeof req.body.rack === 'object'
      ? req.body.rack?._id
      : req.body.rack;

    const payload = {
      ...req.body,
      ...(datacenter ? { datacenter } : {}),
      ...(rack ? { rack } : {}),
    };

    const server = await Server.findByIdAndUpdate(
      req.params.id, payload,
      { new: true, runValidators: true }
    );
    if (!server) return errorResponse(res, 'Server not found', 404);
    await logAction(req.user.id, 'UPDATE', 'Server', server._id, req.body, req.ip);
    return successResponse(res, server, 'Server updated');
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// DELETE /api/servers/:id
const deleteServer = async (req, res) => {
  try {
    const server = await Server.findByIdAndDelete(req.params.id);
    if (!server) return errorResponse(res, 'Server not found', 404);
    await logAction(req.user.id, 'DELETE', 'Server', req.params.id, {}, req.ip);
    return successResponse(res, null, 'Server deleted');
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

module.exports = {
  getServers, getServer,
  createServer, updateServer, deleteServer
};