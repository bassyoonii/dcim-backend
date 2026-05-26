const User = require('../models/User');

const listUsers = async () => {
  return User.find().select('-password');
};

const getUserById = async (id) => {
  const user = await User.findById(id).select('-password');
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  return user;
};

const updateUser = async ({ id, role, isActive, name, email }) => {
  const updates = {
    ...(typeof role !== 'undefined' ? { role } : {}),
    ...(typeof isActive !== 'undefined' ? { isActive } : {}),
    ...(typeof name !== 'undefined' ? { name } : {}),
    ...(typeof email !== 'undefined' ? { email } : {}),
  };

  if (Object.keys(updates).length === 0) {
    const err = new Error('No fields to update');
    err.statusCode = 400;
    throw err;
  }

  if (typeof email !== 'undefined') {
    const existing = await User.findOne({ email, _id: { $ne: id } });
    if (existing) {
      const err = new Error('Email already in use');
      err.statusCode = 409;
      throw err;
    }
  }

  const user = await User.findByIdAndUpdate(
    id,
    { $set: updates },
    { new: true, runValidators: true, context: 'query' }
  ).select('-password');

  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }

  return user;
};

const deleteUser = async (id) => {
  const user = await User.findByIdAndDelete(id);
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  return null;
};

module.exports = {
  listUsers,
  getUserById,
  updateUser,
  deleteUser
};
