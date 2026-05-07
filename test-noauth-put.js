require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');

const API_BASE = 'http://localhost:5000/api';

async function simplePutTest() {
  console.log('🧪 TEST SIMPLE PUT (sans auth)\n');

  try {
    await mongoose.connect(process.env.MONGO_URI);
    const User = require('./models/User');

    // Test user
    const users = await User.find().limit(1);
    const user = users[0];
    const userId = user._id.toString();

    const newEmail = 'unique-test-' + Date.now() + '@example.com';

    console.log('PUT data:', {
      name: user.name,
      email: newEmail,
      role: user.role,
      isActive: user.isActive
    });

    const response = await axios.put(`${API_BASE}/test-update/${userId}`, {
      name: user.name,
      email: newEmail,
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