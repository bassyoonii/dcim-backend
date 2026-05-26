const { successResponse, errorResponse } = require('../utils/apiResponse');
const networkPortService = require('../services/networkPortService');

const handleError = (res, err) => {
  const status = err.statusCode || 500;
  return errorResponse(res, err.message, status);
};

const listPorts = async (req, res) => {
  try {
    const payload = await networkPortService.listPorts(req.query);
    return successResponse(res, payload);
  } catch (err) {
    return handleError(res, err);
  }
};

const getPortById = async (req, res) => {
  try {
    const port = await networkPortService.getPortById(req.params.id);
    return successResponse(res, port);
  } catch (err) {
    return handleError(res, err);
  }
};

const updateStatus = async (req, res) => {
  try {
    const { data, message } = await networkPortService.updateStatus({
      id: req.params.id,
      status: req.body?.status,
      userId: req.user.id,
      ip: req.ip,
    });
    return successResponse(res, data, message);
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    return handleError(res, err);
  }
};

const updateSpeed = async (req, res) => {
  try {
    const { data, message } = await networkPortService.updateSpeed({
      id: req.params.id,
      speedGbps: req.body?.speedGbps,
      userId: req.user.id,
      ip: req.ip,
    });
    return successResponse(res, data, message);
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    return handleError(res, err);
  }
};

const updateConnection = async (req, res) => {
  try {
    const { data, message } = await networkPortService.updateConnection({
      id: req.params.id,
      deviceType: req.body?.deviceType,
      deviceName: req.body?.deviceName,
      userId: req.user.id,
      ip: req.ip,
    });
    return successResponse(res, data, message);
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    return handleError(res, err);
  }
};

const updateNotes = async (req, res) => {
  try {
    const { data, message } = await networkPortService.updateNotes({
      id: req.params.id,
      notes: req.body?.notes,
      userId: req.user.id,
      ip: req.ip,
    });
    return successResponse(res, data, message);
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    return handleError(res, err);
  }
};

const createPort = async (req, res) => {
  try {
    const created = await networkPortService.createPort({
      body: req.body,
      userId: req.user.id,
      ip: req.ip,
    });
    return successResponse(res, created, 'Network port created', 201);
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    if (err.code === 11000) return errorResponse(res, 'Port already exists on this switch', 409);
    return handleError(res, err);
  }
};

const updatePort = async (req, res) => {
  try {
    const updated = await networkPortService.updatePort({
      id: req.params.id,
      body: req.body,
      userId: req.user.id,
      ip: req.ip,
    });
    return successResponse(res, updated, 'Network port updated');
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    if (err.code === 11000) return errorResponse(res, 'Port already exists on this switch', 409);
    return handleError(res, err);
  }
};

const deletePort = async (req, res) => {
  try {
    await networkPortService.deletePort({
      id: req.params.id,
      userId: req.user.id,
      ip: req.ip,
    });
    return successResponse(res, null, 'Network port deleted');
  } catch (err) {
    return handleError(res, err);
  }
};

module.exports = {
  listPorts,
  getPortById,
  updateStatus,
  updateSpeed,
  updateConnection,
  updateNotes,
  createPort,
  updatePort,
  deletePort,
};
