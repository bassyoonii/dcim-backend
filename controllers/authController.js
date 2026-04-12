const jwt = require('jsonwebtoken');
const User = require('../models/User');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { successResponse, errorResponse } = require('../utils/apiResponse');
const { sendMail } = require('../utils/mailer');

const safeUnlink = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (_) {
    // ignore cleanup errors
  }
};

const sanitizeUser = (user) => {
  if (!user) return null;
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar || null,
  };
};

const avatarUrlToFsPath = (avatarUrl) => {
  if (!avatarUrl) return null;
  const raw = String(avatarUrl);
  if (!raw.startsWith('/uploads/')) return null;
  return path.join(__dirname, '..', raw.replace(/^\//, ''));
};

// Helper: generate a signed JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

// @POST /api/auth/register
const register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body || {};

    const normalizedEmail = String(email || '').toLowerCase().trim();

    const uploadedAvatarPath = req.file?.path;
    const avatar = req.file ? `/uploads/avatars/${req.file.filename}` : undefined;

    if (!name || !normalizedEmail || !password) {
      await safeUnlink(uploadedAvatarPath);
      return errorResponse(res, 'Missing required fields (name, email, password)', 400);
    }

    // Check if email already exists
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      await safeUnlink(uploadedAvatarPath);
      return errorResponse(res, 'Email already in use', 400);
    }

    const user = await User.create({ name, email: normalizedEmail, password, role, avatar });

    const token = generateToken(user._id);

    return successResponse(res, {
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar
      }
    }, 'User registered successfully', 201);

  } catch (err) {
    await safeUnlink(req.file?.path);
    return errorResponse(res, err.message, 500);
  }
};

// @POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const normalizedEmail = String(email || '').toLowerCase().trim();
    if (!normalizedEmail || !password) {
      return errorResponse(res, 'Invalid credentials', 401);
    }

    // Explicitly select password since it has select: false in the model
    const user = await User.findOne({ email: normalizedEmail }).select('+password');

    if (!user || !user.isActive) {
      return errorResponse(res, 'Invalid credentials', 401);
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return errorResponse(res, 'Invalid credentials', 401);
    }

    const token = generateToken(user._id);

    return successResponse(res, {
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar
      }
    }, 'Login successful');

  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// @GET /api/auth/me  — get currently logged-in user
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return errorResponse(res, 'User not found', 404);
    return successResponse(res, sanitizeUser(user));
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// @PUT /api/auth/me — update current user profile (name only for now)
const updateMe = async (req, res) => {
  try {
    const rawName = req.body?.name;
    const payload = {};

    if (rawName !== undefined) {
      const nextName = String(rawName || '').trim();
      if (nextName.length < 2) return errorResponse(res, 'Name must be at least 2 characters', 400);
      payload.name = nextName;
    }

    if (Object.keys(payload).length === 0) {
      const user = await User.findById(req.user.id);
      if (!user) return errorResponse(res, 'User not found', 404);
      return successResponse(res, sanitizeUser(user));
    }

    const user = await User.findByIdAndUpdate(req.user.id, payload, { new: true, runValidators: true });
    if (!user) return errorResponse(res, 'User not found', 404);
    return successResponse(res, sanitizeUser(user), 'Profile updated');
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// @PUT /api/auth/me/avatar — update current user avatar
const updateMyAvatar = async (req, res) => {
  const uploadedAvatarPath = req.file?.path;
  try {
    if (!req.file) return errorResponse(res, 'Avatar file is required', 400);

    const user = await User.findById(req.user.id);
    if (!user) {
      await safeUnlink(uploadedAvatarPath);
      return errorResponse(res, 'User not found', 404);
    }

    const previousAvatar = user.avatar;
    user.avatar = `/uploads/avatars/${req.file.filename}`;
    await user.save();

    const previousFsPath = avatarUrlToFsPath(previousAvatar);
    if (previousFsPath) {
      await safeUnlink(previousFsPath);
    }

    return successResponse(res, sanitizeUser(user), 'Avatar updated');
  } catch (err) {
    await safeUnlink(uploadedAvatarPath);
    return errorResponse(res, err.message, 500);
  }
};

// @PUT /api/auth/change-password
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.id).select('+password');

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return errorResponse(res, 'Current password is incorrect', 400);
    }

    user.password = newPassword;
    await user.save();  // triggers the pre-save hash hook

    return successResponse(res, null, 'Password updated successfully');

  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// @POST /api/auth/forgot-password
// Body: { email }
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return errorResponse(res, 'Email is required', 400);

    const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select('+resetPasswordToken +resetPasswordExpires');

    // Always return success to avoid user enumeration.
    if (!user || !user.isActive) {
      return successResponse(res, null, 'If the email exists, a reset link has been sent');
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save({ validateBeforeSave: false });

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
    const resetUrl = `${clientUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(rawToken)}`;

    const subject = 'DCIM Platform — Reset your password';
    const text = [
      'You requested a password reset.',
      '',
      `Reset your password using this link (valid for 1 hour):`,
      resetUrl,
      '',
      'If you did not request this, you can ignore this email.'
    ].join('\n');

    try {
      await sendMail({ to: user.email, subject, text });
    } catch (mailErr) {
      // Cleanup token so we don't leave a reset token that the user never received.
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save({ validateBeforeSave: false });
      console.error('[forgot-password] mail error:', mailErr.message);

      // Still avoid enumeration; but surface a generic operational error.
      return errorResponse(res, 'Unable to send reset email', 500);
    }

    return successResponse(res, null, 'If the email exists, a reset link has been sent');
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

// @POST /api/auth/reset-password
// Body: { token, password }
const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password) {
      return errorResponse(res, 'Token and password are required', 400);
    }

    const hashedToken = crypto.createHash('sha256').update(String(token)).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() }
    }).select('+password +resetPasswordToken +resetPasswordExpires');

    if (!user || !user.isActive) {
      return errorResponse(res, 'Invalid or expired reset token', 400);
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    return successResponse(res, null, 'Password reset successful');
  } catch (err) {
    return errorResponse(res, err.message, 500);
  }
};

module.exports = { register, login, getMe, updateMe, updateMyAvatar, changePassword, forgotPassword, resetPassword };