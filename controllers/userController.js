const { successResponse, errorResponse } = require('../utils/apiResponse');
const userService = require('../services/userService');

const handleError = (res, err) => {
  const status = err.statusCode || 500;
  return errorResponse(res, err.message, status);
};

const listUsers = async (req, res) => {
  try {
    const users = await userService.listUsers();
    return successResponse(res, users);
  } catch (err) {
    return handleError(res, err);
  }
};

const getUserById = async (req, res) => {
  try {
    const user = await userService.getUserById(req.params.id);
    return successResponse(res, user);
  } catch (err) {
    return handleError(res, err);
  }
};

const updateUser = async (req, res) => {
  try {
    const user = await userService.updateUser({
      id: req.params.id,
      role: req.body?.role,
      isActive: req.body?.isActive,
      name: req.body?.name,
      email: req.body?.email
    });
    return successResponse(res, user, 'User updated');
  } catch (err) {
    return handleError(res, err);
  }
};

const deleteUser = async (req, res) => {
  try {
    await userService.deleteUser(req.params.id);
    return successResponse(res, null, 'User deleted');
  } catch (err) {
    return handleError(res, err);
  }
};

module.exports = {
  listUsers,
  getUserById,
  updateUser,
  deleteUser
};
