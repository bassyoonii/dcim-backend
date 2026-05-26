const { successResponse, errorResponse } = require('../utils/apiResponse');
const storageService = require('../services/storageService');

const handleError = (res, err) => {
  const status = err.statusCode || 500;
  return errorResponse(res, err.message, status);
};

const listStorage = async (req, res) => {
  try {
    const payload = await storageService.listStorage(req.query);
    return successResponse(res, payload);
  } catch (err) {
    return handleError(res, err);
  }
};

const getStorageById = async (req, res) => {
  try {
    const item = await storageService.getStorageById(req.params.id);
    return successResponse(res, item);
  } catch (err) {
    return handleError(res, err);
  }
};

const createStorage = async (req, res) => {
  try {
    const item = await storageService.createStorage({
      body: req.body,
      userId: req.user.id
    });
    return successResponse(res, item, 'Storage created', 201);
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    return handleError(res, err);
  }
};

const updateStorage = async (req, res) => {
  try {
    const item = await storageService.updateStorage({
      id: req.params.id,
      body: req.body
    });
    return successResponse(res, item, 'Storage updated');
  } catch (err) {
    if (err.name === 'ValidationError') return errorResponse(res, err.message, 400);
    return handleError(res, err);
  }
};

const deleteStorage = async (req, res) => {
  try {
    await storageService.deleteStorage(req.params.id);
    return successResponse(res, null, 'Storage deleted');
  } catch (err) {
    return handleError(res, err);
  }
};

module.exports = {
  listStorage,
  getStorageById,
  createStorage,
  updateStorage,
  deleteStorage
};
