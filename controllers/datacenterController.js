const datacenterService = require('../services/datacenterService');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const mapMongooseError = datacenterService.mapMongooseError;

// GET /api/datacenters
const getDatacenters = async (req, res) => {
  try {
    const payload = await datacenterService.getDatacenters(req.query);
    return successResponse(res, payload);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// GET /api/datacenters/:id
const getDatacenter = async (req, res) => {
  try {
    const dc = await datacenterService.getDatacenterById(req.params.id);
    return successResponse(res, dc);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// POST /api/datacenters
const createDatacenter = async (req, res) => {
  try {
    const dc = await datacenterService.createDatacenter({
      body: req.body,
      userId: req.user?.id,
      ip: req.ip
    });
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
    const dc = await datacenterService.updateDatacenter({
      id: req.params.id,
      body: req.body,
      userId: req.user?.id,
      ip: req.ip
    });
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
    await datacenterService.deleteDatacenter({
      id: req.params.id,
      userId: req.user?.id,
      ip: req.ip
    });
    return successResponse(res, null, 'Datacenter deleted');
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// GET /api/datacenters/locations
const getDatacenterLocations = async (req, res) => {
  try {
    const payload = await datacenterService.getDatacenterLocations(req.query);
    if (req.query.format === 'geojson') {
      return successResponse(res, payload);
    }
    return successResponse(res, payload);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// GET /api/datacenters/geocode?q=...  (proxy to backend geocode helper)
const geocodeProxy = async (req, res) => {
  try {
    const coords = await datacenterService.geocodeProxy(req.query);
    return successResponse(res, coords);
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// GET /api/datacenters/geocode/reverse?lat=...&lng=... (proxy to backend reverse geocode helper)
const geocodeReverse = async (req, res) => {
  try {
    const payload = await datacenterService.geocodeReverse(req.query);
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