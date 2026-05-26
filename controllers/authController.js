const authService = require('../services/authService');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const handleError = (res, err) => {
  const status = err.statusCode || 500;
  return errorResponse(res, err.message, status);
};

// @POST /api/auth/register
const register = async (req, res) => {
  try {
    const payload = await authService.register({ body: req.body, file: req.file });
    return successResponse(res, payload, 'User registered successfully', 201);
  } catch (err) {
    return handleError(res, err);
  }
};

// @POST /api/auth/login
const login = async (req, res) => {
  try {
    const payload = await authService.login(req.body || {});
    return successResponse(res, payload, 'Login successful');
  } catch (err) {
    return handleError(res, err);
  }
};

// @GET /api/auth/me  — get currently logged-in user
const getMe = async (req, res) => {
  try {
    const user = await authService.getMe(req.user.id);
    return successResponse(res, user);
  } catch (err) {
    return handleError(res, err);
  }
};

// @PUT /api/auth/me — update current user profile (name only for now)
const updateMe = async (req, res) => {
  try {
    const user = await authService.updateMe({
      userId: req.user.id,
      name: req.body?.name
    });
    return successResponse(res, user, 'Profile updated');
  } catch (err) {
    return handleError(res, err);
  }
};

// @PUT /api/auth/me/avatar — update current user avatar
const updateMyAvatar = async (req, res) => {
  try {
    const user = await authService.updateMyAvatar({ userId: req.user.id, file: req.file });
    return successResponse(res, user, 'Avatar updated');
  } catch (err) {
    return handleError(res, err);
  }
};

// @PUT /api/auth/change-password
const changePassword = async (req, res) => {
  try {
    await authService.changePassword({
      userId: req.user.id,
      currentPassword: req.body?.currentPassword,
      newPassword: req.body?.newPassword
    });
    return successResponse(res, null, 'Password updated successfully');
  } catch (err) {
    return handleError(res, err);
  }
};

// @POST /api/auth/forgot-password
// Body: { email }
const forgotPassword = async (req, res) => {
  try {
    await authService.forgotPassword(req.body?.email);
    return successResponse(res, null, 'If the email exists, a reset link has been sent');
  } catch (err) {
    return handleError(res, err);
  }
};

// @POST /api/auth/reset-password
// Body: { token, password }
const resetPassword = async (req, res) => {
  try {
    await authService.resetPassword({ token: req.body?.token, password: req.body?.password });
    return successResponse(res, null, 'Password reset successful');
  } catch (err) {
    return handleError(res, err);
  }
};

module.exports = { register, login, getMe, updateMe, updateMyAvatar, changePassword, forgotPassword, resetPassword };