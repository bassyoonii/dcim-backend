const jwt = require('jsonwebtoken');
const User = require('../models/User');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

const register = async ({ body, file }) => {
  const { name, email, password, role } = body || {};

  const normalizedEmail = String(email || '').toLowerCase().trim();
  const uploadedAvatarPath = file?.path;
  const avatar = file ? `/uploads/avatars/${file.filename}` : undefined;

  if (!name || !normalizedEmail || !password) {
    await safeUnlink(uploadedAvatarPath);
    const err = new Error('Missing required fields (name, email, password)');
    err.statusCode = 400;
    throw err;
  }

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    await safeUnlink(uploadedAvatarPath);
    const err = new Error('Email already in use');
    err.statusCode = 400;
    throw err;
  }

  const user = await User.create({ name, email: normalizedEmail, password, role, avatar });
  const token = generateToken(user._id);

  return {
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar
    }
  };
};

const login = async ({ email, password }) => {
  const normalizedEmail = String(email || '').toLowerCase().trim();
  if (!normalizedEmail || !password) {
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    throw err;
  }

  const user = await User.findOne({ email: normalizedEmail }).select('+password');

  if (!user || !user.isActive) {
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    throw err;
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    const err = new Error('Invalid credentials');
    err.statusCode = 401;
    throw err;
  }

  const token = generateToken(user._id);

  return {
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar
    }
  };
};

const getMe = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  return sanitizeUser(user);
};

const updateMe = async ({ userId, name }) => {
  const payload = {};

  if (name !== undefined) {
    const nextName = String(name || '').trim();
    if (nextName.length < 2) {
      const err = new Error('Name must be at least 2 characters');
      err.statusCode = 400;
      throw err;
    }
    payload.name = nextName;
  }

  if (Object.keys(payload).length === 0) {
    const user = await User.findById(userId);
    if (!user) {
      const err = new Error('User not found');
      err.statusCode = 404;
      throw err;
    }
    return sanitizeUser(user);
  }

  const user = await User.findByIdAndUpdate(userId, payload, { new: true, runValidators: true });
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  return sanitizeUser(user);
};

const updateMyAvatar = async ({ userId, file }) => {
  const uploadedAvatarPath = file?.path;
  try {
    if (!file) {
      const err = new Error('Avatar file is required');
      err.statusCode = 400;
      throw err;
    }

    const user = await User.findById(userId);
    if (!user) {
      await safeUnlink(uploadedAvatarPath);
      const err = new Error('User not found');
      err.statusCode = 404;
      throw err;
    }

    const previousAvatar = user.avatar;
    user.avatar = `/uploads/avatars/${file.filename}`;
    await user.save();

    const previousFsPath = avatarUrlToFsPath(previousAvatar);
    if (previousFsPath) {
      await safeUnlink(previousFsPath);
    }

    return sanitizeUser(user);
  } catch (err) {
    await safeUnlink(uploadedAvatarPath);
    throw err;
  }
};

const changePassword = async ({ userId, currentPassword, newPassword }) => {
  const user = await User.findById(userId).select('+password');

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    const err = new Error('Current password is incorrect');
    err.statusCode = 400;
    throw err;
  }

  user.password = newPassword;
  await user.save();

  return null;
};

const forgotPassword = async (email) => {
  const rawEmail = String(email || '');
  const normalizedEmail = rawEmail.trim().toLowerCase();

  console.log('[forgot-password] Email reçu:', rawEmail);
  console.log('[forgot-password] Email normalisé:', normalizedEmail);

  if (!normalizedEmail) {
    const err = new Error('Email is required');
    err.statusCode = 400;
    throw err;
  }

  const user = await User.findOne({ email: normalizedEmail })
    .select('+resetPasswordToken +resetPasswordExpires');
  console.log('[forgot-password] User trouvé:', user ? { id: user._id, email: user.email, isActive: user.isActive } : null);

  if (!user || !user.isActive) {
    return null;
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  user.resetPasswordToken = hashedToken;
  user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
  await user.save({ validateBeforeSave: false });

  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  const resetUrl = `${clientUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(rawToken)}`;

  const subject = 'DCIM Platform — Reset your password';
  const text = [
    'You requested a password reset.',
    '',
    'Reset your password using this link (valid for 1 hour):',
    resetUrl,
    '',
    'If you did not request this, you can ignore this email.'
  ].join('\n');

  try {
    console.log('[forgot-password] sendMail() start');
    console.log('[forgot-password] Tentative d\'envoi à:', user.email);
    const mailResult = await sendMail({ to: user.email, subject, text });

    if (!mailResult.delivered) {
      console.error('[forgot-password] ÉCHEC envoi email:', mailResult.error);
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save({ validateBeforeSave: false });

      const err = new Error('Unable to send reset email');
      err.statusCode = 500;
      throw err;
    }

    console.log('[forgot-password] ✅ Email envoyé avec succès à:', user.email, 'MessageId:', mailResult.messageId);
  } catch (mailErr) {
    console.error('[forgot-password] EXCEPTION lors de l\'envoi:', mailErr.message);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save({ validateBeforeSave: false });

    const err = new Error('Unable to send reset email');
    err.statusCode = 500;
    throw err;
  }

  return null;
};

const resetPassword = async ({ token, password }) => {
  if (!token || !password) {
    const err = new Error('Token and password are required');
    err.statusCode = 400;
    throw err;
  }

  const hashedToken = crypto.createHash('sha256').update(String(token)).digest('hex');

  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: new Date() }
  }).select('+password +resetPasswordToken +resetPasswordExpires');

  if (!user || !user.isActive) {
    const err = new Error('Invalid or expired reset token');
    err.statusCode = 400;
    throw err;
  }

  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  return null;
};

module.exports = {
  register,
  login,
  getMe,
  updateMe,
  updateMyAvatar,
  changePassword,
  forgotPassword,
  resetPassword
};
