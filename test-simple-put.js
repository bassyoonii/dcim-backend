require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');

const API_BASE = 'http://localhost:5000/api';

async function simplePutTest() {
  console.log('🧪 TEST SIMPLE PUT\n');

  try {
    await mongoose.connect(process.env.MONGO_URI);
    const User = require('./models/User');

    // Auth
    const adminUser = await User.findOne({ role: 'admin' });
    const authResponse = await axios.post(`${API_BASE}/auth/login`, {
      email: adminUser.email,
      password: 'admin123'
    });
    const token = authResponse.data.data.token;
    const headers = { Authorization: `Bearer ${token}` };

    // Test user
    const users = await User.find({ _id: { $ne: adminUser._id } }).limit(1);
    const user = users[0];
    const userId = user._id.toString();

    console.log('PUT data:', {
      name: user.name,
      email: 'unique-test-' + Date.now() + '@example.com',
      role: user.role,
      isActive: user.isActive
    });

    const response = await axios.put(`${API_BASE}/users/test-update/${userId}`, {
      name: user.name,
      email: 'unique-test-' + Date.now() + '@example.com',
      role: user.role,
      isActive: user.isActive
    });

    console.log('Response:', response.data);

    // Vérifier directement en DB
    const updatedUser = await User.findById(userId);
    console.log('DB after update:', { id: updatedUser._id, email: updatedUser.email, name: updatedUser.name });

  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  } finally {
    await mongoose.disconnect();
  }
}

simplePutTest();