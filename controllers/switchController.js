const { successResponse, errorResponse } = require('../utils/apiResponse');
const switchService = require('../services/switchService');

const handleError = (res, err) => {
  const status = err.statusCode || 500;
  return errorResponse(res, err.message, status);
};

const getOverview = async (req, res) => {
  try {
    const payload = await switchService.getOverview(req.query);
    return successResponse(res, payload);
  } catch (err) {
    return handleError(res, err);
  }
};

const listSwitches = async (req, res) => {
  try {
    const payload = await switchService.listSwitches(req.query);
    return successResponse(res, payload);
  } catch (err) {
    return handleError(res, err);
  }
};

const getSwitchById = async (req, res) => {
  try {
    const sw = await switchService.getSwitchById(req.params.id);
    return successResponse(res, sw);
  } catch (err) {
    return handleError(res, err);
  }
};

const createSwitch = async (req, res) => {
  try {
    const sw = await switchService.createSwitch({
      body: req.body,
      userId: req.user.id,
      ip: req.ip
    });
    return successResponse(res, sw, 'Switch created', 201);
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    if (err.code === 11000) return errorResponse(res, 'Switch port mapping conflict', 409);
    return handleError(res, err);
  }
};

const updateSwitch = async (req, res) => {
  try {
    const sw = await switchService.updateSwitch({
      id: req.params.id,
      body: req.body,
      userId: req.user.id,
      ip: req.ip
    });
    return successResponse(res, sw, 'Switch updated');
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    return handleError(res, err);
  }
};

const deleteSwitch = async (req, res) => {
  try {
    await switchService.deleteSwitch({
      id: req.params.id,
      userId: req.user.id,
      ip: req.ip
    });
    return successResponse(res, null, 'Switch deleted');
  } catch (err) {
    return handleError(res, err);
  }
};

module.exports = {
  getOverview,
  listSwitches,
  getSwitchById,
  createSwitch,
  updateSwitch,
  deleteSwitch
};
