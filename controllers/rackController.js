const rackService = require('../services/rackService');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const handleError = (res, err) => {
  const status = err.statusCode || 500;
  return errorResponse(res, err.message, status);
};

// GET /api/racks
const getRacks = async (req, res) => {
  try {
    const payload = await rackService.getRacks(req.query);
    return successResponse(res, payload);
  } catch (err) {
    console.error('[Rack:getRacks] Failed', {
      message: err.message,
      query: req.query,
      stack: err.stack,
    });
    return handleError(res, err);
  }
};

// GET /api/racks/:id
const getRack = async (req, res) => {
  try {
    const rack = await rackService.getRackById(req.params.id);
    return successResponse(res, rack);
  } catch (err) {
    return handleError(res, err);
  }
};

// POST /api/racks
const createRack = async (req, res) => {
  try {
    const rack = await rackService.createRack({
      body: req.body,
      userId: req.user.id,
      ip: req.ip
    });
    return successResponse(res, rack, 'Rack created', 201);
  } catch (err) {
    console.error('[Rack:create] Failed to save rack', {
      message: err.message,
      body: req.body,
      stack: err.stack,
    });

    if (err.name === 'ValidationError') {
      return errorResponse(res, err.message, 400);
    }
    if (err.code === 11000) {
      return errorResponse(res, 'Rack name already exists in this datacenter', 409);
    }
    return handleError(res, err);
  }
};

// PUT /api/racks/:id
const updateRack = async (req, res) => {
  try {
    const rack = await rackService.updateRack({
      id: req.params.id,
      body: req.body,
      userId: req.user.id,
      ip: req.ip
    });
    return successResponse(res, rack, 'Rack updated');
  } catch (err) {
    console.error('[Rack:update] Failed to update rack', {
      message: err.message,
      rackId: req.params.id,
      body: req.body,
      stack: err.stack,
    });

    if (err.name === 'ValidationError') {
      return errorResponse(res, err.message, 400);
    }
    if (err.code === 11000) {
      return errorResponse(res, 'Rack name already exists in this datacenter', 409);
    }
    return handleError(res, err);
  }
};

// DELETE /api/racks/:id
const deleteRack = async (req, res) => {
  try {
    await rackService.deleteRack({
      id: req.params.id,
      userId: req.user.id,
      ip: req.ip
    });
    return successResponse(res, null, 'Rack deleted');
  } catch (err) {
    return handleError(res, err);
  }
};

// GET /api/racks/:id/occupancy
const getRackOccupancy = async (req, res) => {
  try {
    const payload = await rackService.getRackOccupancy(req.params.id);
    return successResponse(res, payload);
  } catch (err) {
    return handleError(res, err);
  }
};

// GET /api/racks/:id/topology
const getRackTopology = async (req, res) => {
  try {
    const payload = await rackService.getRackTopology(req.params.id);
    return successResponse(res, payload);
  } catch (err) {
    return handleError(res, err);
  }
};

// GET /api/racks/:id/3d
const getRack3DData = async (req, res) => {
  try {
    const payload = await rackService.getRack3DData(req.params.id);
    return successResponse(res, payload);
  } catch (err) {
    return handleError(res, err);
  }
};

module.exports = {
  getRacks,
  getRack,
  createRack,
  updateRack,
  deleteRack,
  getRackOccupancy,
  getRackTopology,
  getRack3DData,
};
