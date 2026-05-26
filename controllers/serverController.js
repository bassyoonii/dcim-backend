const serverService = require('../services/serverService');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const handleError = (res, err) => {
  const status = err.statusCode || 500;
  return errorResponse(res, err.message, status);
};

// GET /api/servers  — supports filters: datacenter, rack, role, brand
const getServers = async (req, res) => {
  try {
    const payload = await serverService.listServers(req.query);
    return successResponse(res, payload);
  } catch (err) {
    return handleError(res, err);
  }
};

// GET /api/servers/:id
const getServer = async (req, res) => {
  try {
    const server = await serverService.getServerById(req.params.id);
    return successResponse(res, server);
  } catch (err) {
    return handleError(res, err);
  }
};

// POST /api/servers
const createServer = async (req, res) => {
  try {
    const server = await serverService.createServer({
      body: req.body,
      userId: req.user.id,
      ip: req.ip
    });
    return successResponse(res, server, 'Server created', 201);
  } catch (err) {
    return handleError(res, err);
  }
};

// PUT /api/servers/:id
const updateServer = async (req, res) => {
  try {
    const server = await serverService.updateServer({
      id: req.params.id,
      body: req.body,
      userId: req.user.id,
      ip: req.ip
    });
    return successResponse(res, server, 'Server updated');
  } catch (err) {
    return handleError(res, err);
  }
};

// DELETE /api/servers/:id
const deleteServer = async (req, res) => {
  try {
    await serverService.deleteServer({
      id: req.params.id,
      userId: req.user.id,
      ip: req.ip
    });
    return successResponse(res, null, 'Server deleted');
  } catch (err) {
    return handleError(res, err);
  }
};

module.exports = {
  getServers, getServer,
  createServer, updateServer, deleteServer
};