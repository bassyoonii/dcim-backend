const mongoose = require('mongoose');

const connectDB = async () => {
  mongoose.set('bufferCommands', false);

  while (true) {
    try {
      await mongoose.connect(process.env.MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
      });
      console.log('MongoDB connected');
      return;
    } catch (err) {
      console.error('MongoDB connection error:', err.message);

      // Retry until DB becomes reachable; API startup awaits this.
      await new Promise((resolve) => setTimeout(resolve, 10000));
    }
  }
};

module.exports = connectDB;