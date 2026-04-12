const User = require('../models/User');

/**
 * Ensure a default admin user exists for local/dev usage.
 *
 * Controlled via env:
 * - DEFAULT_ADMIN_NAME (default: Admin)
 * - DEFAULT_ADMIN_EMAIL (default: admin@dcim.local)
 * - DEFAULT_ADMIN_PASSWORD (default: admin123)
 * - DEFAULT_ADMIN_RESET_PASSWORD=true to reset password on startup (dev only)
 */
const ensureDefaultAdmin = async () => {
  if (process.env.NODE_ENV === 'production') return;

  const name = process.env.DEFAULT_ADMIN_NAME || 'Admin';
  const email = (process.env.DEFAULT_ADMIN_EMAIL || 'admin@dcim.local').toLowerCase();
  const password = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';
  const resetPassword = String(process.env.DEFAULT_ADMIN_RESET_PASSWORD || '').toLowerCase() === 'true';

  let user = await User.findOne({ email }).select('+password');

  if (!user) {
    user = await User.create({
      name,
      email,
      password,
      role: 'admin',
      isActive: true
    });

    console.log(`[bootstrap] Default admin ensured: ${email}`);
    return;
  }

  // Important: Do NOT modify existing accounts automatically.
  // If you need to reset credentials, do it explicitly via the admin fix script.
  if (resetPassword) {
    user.password = password;
    await user.save();
    console.log(`[bootstrap] Default admin password reset: ${email}`);
  }
};

module.exports = ensureDefaultAdmin;
